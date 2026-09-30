/**
 * End-to-end tests against a real PostgreSQL test database and a running server
 * (HTTP + Socket.IO). Run with: npm test   (uses TEST_DATABASE_URL or the default test DB).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { io as ioc, Socket } from 'socket.io-client';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://cq:cqpass@localhost:5432/character_quest_test';
process.env.ADMIN_PASSWORD = 'admin-test-pw';
process.env.TEACHER_SIGNUP_CODE = 'teach-code';

const { pool, migrate } = await import('../src/db.js');
const { ensureAdmin, seedDemo } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { attachRealtime } = await import('../src/realtime.js');
const { invalidateWorld } = await import('../src/services/world.js');
const shared = await import('@cq/shared');
const http = await import('node:http');

let base = '';
let server: import('node:http').Server;

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await r.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b?: unknown) { return this.req('POST', p, b ?? {}); }
  async login(username: string, password: string) { const r = await this.post('/api/auth/login', { username, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.user; }
  socket(auth: Record<string, unknown> = {}): Promise<{ s: Socket; welcome: any }> {
    return new Promise((resolve, reject) => {
      const s = ioc(base, { extraHeaders: { cookie: this.cookie }, auth, transports: ['websocket'], forceNew: true });
      const t = setTimeout(() => reject(new Error('no welcome')), 5000);
      s.on('welcome', (w) => { clearTimeout(t); resolve({ s, welcome: w }); });
      s.on('connect_error', reject);
    });
  }
}
const emitAck = (s: Socket, ev: string, d: unknown) => new Promise<any>((r, j) => { const t = setTimeout(() => j(new Error(`no ack for ${ev}`)), 4000); s.emit(ev, d, (x: any) => { clearTimeout(t); r(x); }); });
const waitFor = (s: Socket, ev: string, pred: (d: any) => boolean = () => true, ms = 3000) => new Promise<any>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
  const f = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(ev, f); resolve(d); } };
  s.on(ev, f);
});

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(false);
  await ensureAdmin();
  await seedDemo({ quiet: true });
  server = http.createServer(createApp());
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); await pool.end(); setTimeout(() => process.exit(0), 200).unref(); });

test('health check and login errors', async () => {
  const c = new Client();
  assert.equal((await c.get('/api/health')).data.ok, true);
  const bad = await c.post('/api/auth/login', { username: 'teacher', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
});

test('teacher creates a question, student answers it, rewards are server-side and one-time', async () => {
  const t = new Client();
  await t.login('teacher', 'teacher123');
  const classes = (await t.get('/api/teacher/classes')).data;
  const cls = classes[0];
  assert.equal(cls.name, 'Grade 5 Adventure Class');
  const skills = (await t.get(`/api/teacher/classes/${cls.id}/skills`)).data;
  const math = skills.find((s: any) => s.name === 'Mathematics');
  const diamond = shared.BLOCK_BY_KEY.diamond_brick.id;
  const created = await t.post(`/api/teacher/classes/${cls.id}/questions`, {
    type: 'numeric', prompt: 'What is 11 × 11?', subject: 'Math', topic: 'Multiplication', difficulty: 3,
    xp_reward: 100, skill_id: math.id, skill_amount: 5, block_id: diamond, block_qty: 10, coin_reward: 7,
    answers: [{ text: '121', is_correct: true }]
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const qid = created.data.id;

  const s = new Client();
  await s.login('taylor', 'quest123');
  const before = (await s.get('/api/student/me')).data;
  const list = (await s.get('/api/student/questions')).data;
  const pub = list.questions.find((x: any) => x.id === qid);
  assert.ok(pub, 'teacher question is visible to the student');
  assert.equal(JSON.stringify(pub).includes('is_correct'), false, 'correct flag is not leaked');

  const wrong = await s.post(`/api/student/questions/${qid}/answer`, { answer: '120' });
  assert.equal(wrong.data.correct, false);
  assert.equal(wrong.data.reward, undefined);
  const right = await s.post(`/api/student/questions/${qid}/answer`, { answer: ' 121 ' });
  assert.equal(right.data.correct, true);
  assert.equal(right.data.reward.gained.xp, 100);
  const after = (await s.get('/api/student/me')).data;
  assert.ok(after.xp >= before.xp + 100);
  assert.equal(after.inventory[diamond], 10, 'blocks land in the inventory');
  assert.equal(after.coins, before.coins + 7);
  assert.equal(after.skills.find((x: any) => x.name === 'Mathematics').points, 5);
  const again = await s.post(`/api/student/questions/${qid}/answer`, { answer: '121' });
  assert.equal(again.data.correct, true);
  assert.equal(again.data.alreadyEarned, true);
  assert.equal((await s.get('/api/student/me')).data.inventory[diamond], 10, 'no double reward');

  // Teacher sees the progress.
  const detail = (await t.get(`/api/teacher/students/${after.id}`)).data;
  assert.ok(detail.recent.length >= 2);
  assert.ok(detail.topics.some((x: any) => x.topic === 'Multiplication'));
});

test('students cannot use teacher tools or answer other classes questions', async () => {
  const s = new Client();
  await s.login('sam', 'quest123');
  assert.equal((await s.get('/api/teacher/classes')).status, 403);
  assert.equal((await s.get('/api/admin/backup')).status, 403);
  // A second teacher's class question.
  const t2 = new Client();
  assert.equal((await t2.post('/api/auth/teacher-signup', { username: 'ms_lee', password: 'password123', displayName: 'Ms Lee', signupCode: 'teach-code' })).status, 200);
  const cls = (await t2.post('/api/teacher/classes', { name: 'Lee Class', grade: '6' })).data;
  const qq = (await t2.post(`/api/teacher/classes/${cls.id}/questions`, { type: 'true_false', prompt: '2+2=4', subject: 'Math', difficulty: 1, answers: [{ text: 'True', is_correct: true }, { text: 'False', is_correct: false }] })).data;
  assert.equal((await s.post(`/api/student/questions/${qq.id}/answer`, { answer: 'True' })).status, 404);
  // Teacher 2 cannot read teacher 1's class.
  const t1 = new Client(); await t1.login('teacher', 'teacher123');
  const c1 = (await t1.get('/api/teacher/classes')).data[0];
  assert.equal((await t2.get(`/api/teacher/classes/${c1.id}/students`)).status, 403);
});

test('student joins with class code, builds in own plot, edits sync and persist', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = (await t.get('/api/teacher/classes')).data.find((c: any) => c.name === 'Grade 5 Adventure Class');
  const s = new Client();
  const j = await s.post('/api/auth/join', { joinCode: 'demo5a', username: 'riley', password: 'riley123', displayName: 'Riley' });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  const me = (await s.get('/api/student/me')).data;
  assert.equal(me.inventory[shared.BLOCK_BY_KEY.planks.id], 10, 'starter inventory');
  const plot = me.plot;
  const px = plot.x0 + 3, pz = plot.z0 + 3;
  const ground = shared.surfaceHeight(20260927, px, pz);
  await pool.query('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [me.id, px + 0.5, ground + 1, pz + 1.5]);

  const tSock = await t.socket({ classId: cls.id });
  const { s: sock, welcome } = await s.socket();
  assert.equal(welcome.seed, 20260927);
  assert.ok(welcome.edits.length > 50, 'demo buildings are in the world');

  const seen = waitFor(tSock.s, 'blockChanged', (d) => d.x === px && d.z === pz && d.b === shared.BLOCK_BY_KEY.planks.id);
  const invMsg = waitFor(sock, 'inventory');
  const ok = await emitAck(sock, 'place', { x: px, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.planks.id });
  assert.deepEqual(ok, { ok: true });
  await seen; // the teacher's client sees the new block in real time
  assert.equal((await invMsg).items[shared.BLOCK_BY_KEY.planks.id], 9, 'inventory decremented');

  const noGold = await emitAck(sock, 'place', { x: px + 1, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.gold_block.id });
  assert.equal(noGold.ok, false);
  const outside = await emitAck(sock, 'place', { x: plot.x0 - 1, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.planks.id });
  assert.equal(outside.ok, false, 'personal-area mode blocks building outside the plot');
  const far = await emitAck(sock, 'place', { x: px + 40, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.planks.id });
  assert.equal(far.ok, false, 'reach is checked on the server');
  const bogus = await emitAck(sock, 'place', { x: px, y: ground + 2, z: pz, b: shared.BLOCK_BY_KEY.bedrock.id });
  assert.equal(bogus.ok, false);

  // Persisted: survives a cache flush (like a server restart) and a reconnect.
  sock.disconnect();
  invalidateWorld(welcome.worldId);
  const row = await pool.query('SELECT block_id FROM world_blocks WHERE world_id=$1 AND x=$2 AND y=$3 AND z=$4', [welcome.worldId, px, ground + 1, pz]);
  assert.equal(row.rows[0].block_id, shared.BLOCK_BY_KEY.planks.id);
  const again = await s.socket();
  assert.ok(again.welcome.edits.some((e: any) => e.x === px && e.y === ground + 1 && e.z === pz && e.b === shared.BLOCK_BY_KEY.planks.id));

  // Removing your own block gives it back.
  const rm = await emitAck(again.s, 'remove', { x: px, y: ground + 1, z: pz });
  assert.deepEqual(rm, { ok: true });
  assert.equal((await s.get('/api/student/me')).data.inventory[shared.BLOCK_BY_KEY.planks.id], 10);

  // Read-only mode stops building.
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'read_only' });
  const ro = await emitAck(again.s, 'place', { x: px, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.planks.id });
  assert.equal(ro.ok, false);
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'personal_area' });

  // Locked region: a level 1 student walking into the mountains is sent back.
  const tp = waitFor(again.s, 'teleport');
  again.s.emit('move', { x: px + 0.5, y: 60, z: 10, yaw: 0 });
  await tp;
  again.s.disconnect(); tSock.s.disconnect();
});

test('assignments award their bonus once all questions are solved', async () => {
  const s = new Client(); await s.login('sam', 'quest123');
  const data = (await s.get('/api/student/questions')).data;
  const fr = data.assignments.find((a: any) => a.title === 'Fractions Challenge');
  assert.ok(fr);
  const answers: Record<string, string> = { 'What is 3/4 + 1/8?': '7/8', 'Which fraction is equal to 2/3?': '4/6', 'What is 1/2 of 3/5?': '3/10' };
  let last: any;
  for (const qid of fr.question_ids) {
    const qq = data.questions.find((x: any) => x.id === qid);
    last = (await s.post(`/api/student/questions/${qid}/answer`, { answer: answers[qq.prompt] })).data;
    assert.equal(last.correct, true);
  }
  assert.equal(last.assignmentsCompleted[0]?.title, 'Fractions Challenge');
  const me = (await s.get('/api/student/me')).data;
  assert.equal(me.inventory[shared.BLOCK_BY_KEY.stone_bricks.id], 25);
});

test('CSV export and import round-trip', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = (await t.get('/api/teacher/classes')).data[0];
  const csv = (await t.get(`/api/teacher/classes/${cls.id}/questions.csv`)).data as string;
  assert.ok(csv.startsWith('Type,Question,Answer'));
  const count = (await t.get(`/api/teacher/classes/${cls.id}/questions`)).data.length;
  const imp = await t.post(`/api/teacher/classes/${cls.id}/questions/import`, {
    csv: 'Question,Answer,Option A,Option B,Option C,Option D,Subject,Topic,Difficulty,XP,Reward Block\n"What is 6 × 7?",42,,,,,Math,Multiplication,1,30,Stone Bricks\n"Pick the noun",dog,run,dog,blue,fast,Writing,Grammar,2,,\nBad row with no answer,,,,,,Math,,1,,\n'
  });
  assert.equal(imp.data.imported, 2, JSON.stringify(imp.data));
  assert.equal(imp.data.results[2].ok, false);
  const all = (await t.get(`/api/teacher/classes/${cls.id}/questions`)).data;
  assert.equal(all.length, count + 2);
  const six = all.find((x: any) => x.prompt === 'What is 6 × 7?');
  assert.equal(six.type, 'numeric'); assert.equal(six.xp_reward, 30); assert.equal(six.block_id, shared.BLOCK_BY_KEY.stone_bricks.id);
  const noun = all.find((x: any) => x.prompt === 'Pick the noun');
  assert.equal(noun.type, 'multiple_choice');
  assert.equal(noun.answers.find((a: any) => a.is_correct).text, 'dog');
});

test('admin backup contains the world and students', async () => {
  const a = new Client(); await a.login('admin', 'admin-test-pw');
  const b = (await a.get('/api/admin/backup')).data;
  assert.equal(b.format, 'character-quest-backup');
  assert.ok(b.tables.world_blocks.length > 50);
  assert.ok(b.tables.students.length >= 5);
});

/* ---------------- quests, events, shop, chat, matching, approval building ---------------- */
const classOf = async (t: Client) => (await t.get('/api/teacher/classes')).data[0];

test('matching questions: shuffled public view, JSON answer checked on the server', async () => {
  const s = new Client(); await s.login('taylor', 'quest123');
  const qs = (await s.get('/api/student/questions')).data.questions;
  const m = qs.find((x: any) => x.type === 'matching' && x.prompt.startsWith('Match each planet'));
  assert.ok(m && m.left.length === 4 && m.right.length === 4);
  assert.deepEqual([...m.right].sort(), ['Closest to the Sun', 'Famous for its rings', 'Largest planet', 'The Red Planet']);
  assert.equal(m.answers, undefined, 'correct pairs are never sent to the browser');
  const wrong = await s.post(`/api/student/questions/${m.id}/answer`, { answer: JSON.stringify({ Mercury: 'The Red Planet', Mars: 'Closest to the Sun', Jupiter: 'Largest planet', Saturn: 'Famous for its rings' }) });
  assert.equal(wrong.data.correct, false);
  const right = await s.post(`/api/student/questions/${m.id}/answer`, { answer: JSON.stringify({ Mercury: 'Closest to the Sun', Mars: 'The Red Planet', Jupiter: 'Largest planet', Saturn: 'Famous for its rings' }) });
  assert.equal(right.data.correct, true);
  assert.ok(right.data.reward.gained.xp > 0);
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  const bad = await t.post(`/api/teacher/classes/${cls.id}/questions`, { type: 'matching', prompt: 'x', subject: 'Math', answers: [{ text: 'a', match_text: 'b', is_correct: true }] });
  assert.equal(bad.status, 400);
});

test('multi-step quests, daily challenges and class events progress from real actions', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  const r = await t.post(`/api/teacher/classes/${cls.id}/quests`, { title: 'Two-step test', repeat: 'daily', xp_reward: 10, coin_reward: 3, item_key: 'title_helper',
    steps: [{ kind: 'subject_correct', subject: 'Math', amount: 1 }, { kind: 'correct_answers', amount: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ev = await t.post(`/api/teacher/classes/${cls.id}/events`, { title: 'Test Arch', goal_kind: 'correct_answers', goal_amount: 2, reward_coins: 5, unlock_structure: 'arch', structure_x: 100, structure_z: 128 });
  assert.equal(ev.status, 200, JSON.stringify(ev.data));
  const s = new Client(); await s.login('taylor', 'quest123');
  const start = (await s.get('/api/student/quests')).data;
  const mine = () => s.get('/api/student/quests').then((x) => x.data.quests.find((q: any) => q.title === 'Two-step test'));
  assert.equal((await mine()).stepIndex, 0);
  assert.ok(start.events.some((e: any) => e.title === 'Test Arch'));
  const qs = (await s.get('/api/student/questions')).data.questions;
  // A Science answer does not advance a Math step.
  const sci = qs.find((x: any) => x.subject === 'Science' && x.type === 'true_false');
  const a1 = await s.post(`/api/student/questions/${sci.id}/answer`, { answer: 'True' });
  assert.equal(a1.data.correct, true);
  assert.equal((await mine()).stepIndex, 0);
  const math = qs.find((x: any) => x.prompt === 'What is 12 × 8?');
  const a2 = await s.post(`/api/student/questions/${math.id}/answer`, { answer: '96' });
  assert.ok(a2.data.notices.some((n: any) => /step 1 of 2/.test(n.text)), JSON.stringify(a2.data.notices));
  const coinsBefore = (await s.get('/api/student/me')).data.coins;
  const math2 = qs.find((x: any) => x.prompt === 'What is 7 × 8?');
  const a3 = await s.post(`/api/student/questions/${math2.id}/answer`, { answer: '56' });
  assert.ok(a3.data.notices.some((n: any) => /Daily challenge complete/.test(n.text)));
  const q = await mine();
  assert.equal(q.completed, true);
  // Event goal of 2 was reached by these answers: structure placed and helpers rewarded.
  const evs = (await s.get('/api/student/quests')).data.events;
  assert.equal(evs.find((e: any) => e.title === 'Test Arch').completed, true);
  const blocks = await pool.query('SELECT count(*)::int n FROM world_blocks WHERE world_id=$1 AND placed_by IS NULL AND x BETWEEN 98 AND 102 AND z=128', [cls.world_id]);
  assert.ok(blocks.rows[0].n >= 10, 'arch structure was built');
  const me = (await s.get('/api/student/me')).data;
  assert.ok(me.coins >= coinsBefore + 3 + 5);
  const shop = (await s.get('/api/student/shop')).data;
  assert.ok(shop.items.some((i: any) => i.key === 'title_helper' && i.owned), 'quest item reward is owned');
  // Manual event points from the teacher.
  const events = (await t.get(`/api/teacher/classes/${cls.id}/events`)).data;
  const reading = events.find((e: any) => e.title === 'Reading Week');
  const pts = await t.post(`/api/teacher/classes/${cls.id}/events/${reading.id}/points`, { points: 4 });
  assert.equal(pts.data.completed, false);
  assert.equal((await t.get(`/api/teacher/classes/${cls.id}/events`)).data.find((e: any) => e.id === reading.id).progress, 4);
});

test('cosmetics shop: coins spent on the server, levels and ownership enforced, look broadcast', async () => {
  const s = new Client(); await s.login('jordan', 'quest123');
  const before = (await s.get('/api/student/shop')).data;
  const cheap = before.items.find((i: any) => i.key === 'shirt_red');
  assert.equal(cheap.owned, false);
  await pool.query('UPDATE students SET coins=25 WHERE user_id=(SELECT id FROM users WHERE username=$1)', ['jordan']);
  const buy = await s.post('/api/student/shop/shirt_red/buy');
  assert.equal(buy.status, 200, JSON.stringify(buy.data));
  assert.equal(buy.data.coins, 5);
  assert.equal((await s.post('/api/student/shop/shirt_red/buy')).status, 400, 'cannot buy twice');
  assert.equal((await s.post('/api/student/shop/hat_cap/buy')).status, 400, 'not enough coins');
  assert.equal((await s.post('/api/student/shop/hat_crown_legend/buy')).status, 400, 'reward-only items cannot be bought');
  await pool.query('UPDATE students SET coins=1000 WHERE user_id=(SELECT id FROM users WHERE username=$1)', ['jordan']);
  assert.equal((await s.post('/api/student/shop/hat_crown/buy')).status, 400, 'level requirement');
  assert.equal((await s.post('/api/student/shop/hat_cap/equip', { on: true })).status, 400, 'must own to equip');
  const me = (await s.get('/api/student/me')).data;
  assert.equal(me.look.shirt, '#c8453c');
  // Buying never changes XP / level (no pay-to-win).
  const xpBefore = me.xp;
  await s.post('/api/student/shop/shirt_green/buy');
  assert.equal((await s.get('/api/student/me')).data.xp, xpBefore);
});

test('chat: off / preset / free modes, filter, mute and teacher hiding', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  const s = new Client(); await s.login('sam', 'quest123');
  const { s: sock } = await s.socket();
  const tSock = await t.socket({ classId: cls.id });
  assert.equal((await emitAck(sock, 'chat', { text: 'hello there my friend' })).ok, false, 'preset mode rejects typed text');
  const got = waitFor(tSock.s, 'chat', (m) => m.text === 'Good job!');
  assert.equal((await emitAck(sock, 'chat', { text: 'Good job!' })).ok, true);
  const msg = await got;
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { chat_mode: 'free' });
  await new Promise((r) => setTimeout(r, 3100));
  const filtered = waitFor(tSock.s, 'chat', (m) => m.userId === msg.userId && m.text !== 'Good job!');
  assert.equal((await emitAck(sock, 'chat', { text: 'you are stupid see www.bad.com' })).ok, true);
  const f = await filtered;
  assert.ok(!/stupid|www/.test(f.text), f.text);
  const hidden = waitFor(sock, 'chatHidden', (d) => d.id === f.id);
  await t.req('PATCH', `/api/teacher/classes/${cls.id}/chat/${f.id}`, { hidden: true });
  await hidden;
  assert.ok(!(await s.get('/api/student/chat')).data.messages.some((m: any) => m.id === f.id));
  const log = (await t.get(`/api/teacher/classes/${cls.id}/chat`)).data;
  assert.ok(log.find((m: any) => m.id === f.id).original.includes('stupid'), 'teacher sees the original text');
  await t.req('PATCH', `/api/teacher/students/${msg.userId}`, { muted: true });
  await new Promise((r) => setTimeout(r, 3100));
  assert.equal((await emitAck(sock, 'chat', { text: 'Hi!' })).ok, false, 'muted');
  await t.req('PATCH', `/api/teacher/students/${msg.userId}`, { muted: false });
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { chat_mode: 'off' });
  await new Promise((r) => setTimeout(r, 3100));
  assert.equal((await emitAck(sock, 'chat', { text: 'Hi!' })).ok, false, 'off');
  sock.disconnect(); tSock.s.disconnect();
});

test('teacher-approval building: pending blocks are hidden from classmates until approved', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'teacher_approval' });
  const a = new Client(); const alex = await a.login('alex', 'quest123');
  const b = new Client(); await b.login('sam', 'quest123');
  const me = (await a.get('/api/student/me')).data;
  const px = me.plot.x0 + 6, pz = me.plot.z0 + 6;
  const ground = shared.surfaceHeight(20260927, px, pz);
  await pool.query('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [alex.id, px + 0.5, ground + 1, pz + 2.5]);
  const { s: sa } = await a.socket();
  const ok = await emitAck(sa, 'place', { x: px, y: ground + 1, z: pz, b: shared.BLOCK_BY_KEY.planks.id });
  assert.deepEqual(ok, { ok: true });
  const other = await b.socket();
  assert.ok(!other.welcome.edits.some((e: any) => e.x === px && e.y === ground + 1 && e.z === pz), 'classmate does not see pending block');
  const own = await a.socket();
  assert.ok(own.welcome.edits.some((e: any) => e.x === px && e.y === ground + 1 && e.z === pz && e.pending), 'builder sees their pending block');
  own.s.disconnect();
  const sub = await a.post('/api/student/submissions', { note: 'My first wall' });
  assert.equal(sub.data.blocks, 1);
  const ap = (await t.get(`/api/teacher/classes/${cls.id}/approvals`)).data;
  assert.ok(ap.pending.some((p: any) => p.studentId === alex.id && p.submitted));
  const shown = waitFor(other.s, 'blockBatch', (d) => d.edits.some((e: any) => e.x === px && e.z === pz));
  assert.equal((await t.post(`/api/teacher/students/${alex.id}/approve`, { feedback: 'Great' })).data.approved, 1);
  await shown;
  const after = await b.socket();
  assert.ok(after.welcome.edits.some((e: any) => e.x === px && e.y === ground + 1 && e.z === pz && !e.pending));
  // Rejected builds come back to the inventory.
  const inv0 = (await a.get('/api/student/me')).data.inventory[shared.BLOCK_BY_KEY.planks.id] ?? 0;
  assert.deepEqual(await emitAck(sa, 'place', { x: px, y: ground + 2, z: pz, b: shared.BLOCK_BY_KEY.planks.id }), { ok: true });
  assert.equal((await t.post(`/api/teacher/students/${alex.id}/reject`, {})).data.removed, 1);
  assert.equal((await a.get('/api/student/me')).data.inventory[shared.BLOCK_BY_KEY.planks.id], inv0);
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'personal_area' });
  sa.disconnect(); other.s.disconnect(); after.s.disconnect();
});

/* ---------------- regressions from the QA run-through ---------------- */
test('class event completes cleanly when several students answer at the same moment', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  const ev = await t.post(`/api/teacher/classes/${cls.id}/events`, { title: 'Race', goal_kind: 'correct_answers', goal_amount: 3, reward_coins: 7, reward_item: 'cape_event', unlock_structure: 'statue', structure_x: 110, structure_z: 110 });
  assert.equal(ev.status, 200);
  const students = await Promise.all(['alex', 'jordan', 'sam', 'taylor'].map(async (u) => { const c = new Client(); await c.login(u, 'quest123'); return c; }));
  const q = (await pool.query(`INSERT INTO questions (class_id, type, prompt, subject, difficulty, xp_reward) VALUES ($1,'numeric','2+2?','Math',1,5) RETURNING id`, [cls.id])).rows[0].id;
  await pool.query(`INSERT INTO question_answers (question_id, text, is_correct, sort) VALUES ($1,'4',true,0)`, [q]);
  const res = await Promise.all(students.map((c) => c.post(`/api/student/questions/${q}/answer`, { answer: '4' })));
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200], JSON.stringify(res.map((r) => r.data)));
  const e = (await t.get(`/api/teacher/classes/${cls.id}/events`)).data.find((x: any) => x.title === 'Race');
  assert.ok(e.completed_at, 'event completed');
  const statue = await pool.query('SELECT count(*)::int n FROM world_blocks WHERE world_id=$1 AND placed_by IS NULL AND x BETWEEN 109 AND 111 AND z BETWEEN 109 AND 111', [cls.world_id]);
  assert.ok(statue.rows[0].n >= 9);
  const capes = await pool.query(`SELECT count(*)::int n FROM student_items WHERE item_key='cape_event'`);
  assert.ok(capes.rows[0].n >= 3);
});

test('no progress from placing and removing the same block; structures and speed are protected', async () => {
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'class_project' });
  const s = new Client(); const me0 = await s.login('jordan', 'quest123');
  const zone = (await t.get(`/api/teacher/classes/${cls.id}/zones`)).data[0];
  const px = zone.x0 + 2, pz = zone.z0 + 2;
  const ground = shared.surfaceHeight(20260927, px, pz);
  await pool.query('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [me0.id, px + 0.5, ground + 1, pz + 2.5]);
  await pool.query(`UPDATE inventory SET quantity=50 WHERE student_id=$1 AND block_id=$2`, [me0.id, shared.BLOCK_BY_KEY.dirt.id]);
  const { s: sock } = await s.socket();
  const xp0 = (await s.get('/api/student/me')).data.xp;
  const dirt = shared.BLOCK_BY_KEY.dirt.id;
  assert.deepEqual(await emitAck(sock, 'place', { x: px, y: ground + 1, z: pz, b: dirt }), { ok: true });
  const xp1 = (await s.get('/api/student/me')).data.xp;
  assert.ok(xp1 > xp0, 'first placement in the zone earns the bonus');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await emitAck(sock, 'remove', { x: px, y: ground + 1, z: pz }), { ok: true });
    assert.deepEqual(await emitAck(sock, 'place', { x: px, y: ground + 1, z: pz, b: dirt }), { ok: true });
  }
  assert.equal((await s.get('/api/student/me')).data.xp, xp1, 'no XP from re-placing the same block');
  // Class reward structures can't be broken by students.
  const st = (await pool.query('SELECT x, y, z FROM world_blocks WHERE world_id=$1 AND placed_by IS NULL LIMIT 1', [cls.world_id])).rows[0];
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'anywhere' });
  sock.disconnect();
  await new Promise((r) => setTimeout(r, 300)); // disconnect saves the old position first
  await pool.query('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [me0.id, st.x + 0.5, st.y, st.z + 2.5]);
  const again = await s.socket();
  const rm = await emitAck(again.s, 'remove', { x: st.x, y: st.y, z: st.z });
  assert.equal(rm.ok, false); assert.match(rm.error, /protected/);
  // Speed hack: many far moves in a burst are rejected with a teleport.
  const tp = waitFor(again.s, 'teleport');
  for (let i = 1; i <= 6; i++) again.s.emit('move', { x: st.x + 0.5 + i * 4.5, y: st.y, z: st.z + 2.5, yaw: 0 });
  await tp;
  again.s.disconnect();
  await t.req('PATCH', `/api/teacher/classes/${cls.id}`, { build_mode: 'personal_area' });
});

test('input edge cases return clear 400s', async () => {
  const s = new Client(); await s.login('sam', 'quest123');
  assert.equal((await s.post('/api/student/shop/__proto__/buy')).status, 400);
  assert.equal((await s.post('/api/student/shop/toString/buy')).status, 400);
  const qs = (await s.get('/api/student/questions')).data.questions;
  const n = qs.find((x: any) => x.prompt === 'What is 9 × 6?');
  assert.equal((await s.post(`/api/student/questions/${n.id}/answer`, { answer: '0x36' })).data.correct, false);
  assert.equal((await s.post(`/api/student/questions/${n.id}/answer`, { answer: '5.4e1' })).data.correct, false);
  const m = qs.find((x: any) => x.type === 'matching' && x.prompt.startsWith('Match each word'));
  const partial = await s.post(`/api/student/questions/${m.id}/answer`, { answer: JSON.stringify({ Happy: 'Joyful', Big: 'Rapid', Quick: 'Enormous' }) });
  assert.match(partial.data.message, /1 of 3 pairs/);
  const t = new Client(); await t.login('teacher', 'teacher123');
  const cls = await classOf(t);
  assert.equal((await t.post(`/api/teacher/classes/${cls.id}/reset-area`, { x0: -5, z0: 0, x1: 99999, z1: 3 })).status, 400);
  const badEv = await t.post(`/api/teacher/classes/${cls.id}/events`, { title: 'x', goal_kind: 'manual', goal_amount: 2, ends_at: 'not a date' });
  assert.equal(badEv.status, 400); assert.match(badEv.data.error, /date/);
  const badX = await t.post(`/api/teacher/classes/${cls.id}/events`, { title: 'x', goal_kind: 'manual', goal_amount: 2, unlock_structure: 'arch', structure_x: 1, structure_z: 100 });
  assert.match(badX.data.error, /Structure x/);
});
