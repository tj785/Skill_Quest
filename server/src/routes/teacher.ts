import { Router } from 'express';
import { z } from 'zod';
import { h, int, HttpError, parseCsv, toCsv } from '../http.js';
import { q, one, tx } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { createClass, addStudent, assertClassAccess, assertStudentAccess } from '../services/classes.js';
import { QuestionInput, saveQuestion, questionWithAnswers, weakTopics } from '../services/questions.js';
import { grantReward, awardAchievement, inventoryOf } from '../services/rewards.js';
import { logActivity } from '../services/log.js';
import { removeStudentBuilds, resetArea, buildingsOf, editsList, loadWorld } from '../services/world.js';
import { hub } from '../services/hub.js';
import { studentProfile } from './student.js';
import { BUILD_MODES, BLOCK_BY_KEY, BLOCK_BY_ID, isRewardable, plotBounds, SPAWN, QUESTION_TYPES, levelProgress, CHAT_MODES, COSMETIC_BY_KEY, COSMETICS,
  QUEST_STEP_KINDS, QUEST_REPEATS, EVENT_GOALS, STRUCTURE_BY_KEY, describeStep, REGIONS, WORLD_SIZE } from '@cq/shared';
import { giveItem, addEventPoints } from '../services/progress.js';
import { announceEvent } from '../services/questions.js';
import { pendingCounts, approvePending, rejectPending, invalidateWorld } from '../services/world.js';

export const teacherRouter = Router();
teacherRouter.use(requireRole('teacher', 'admin'));

const cid = (req: any) => int(req.params.classId);
/** A real calendar date (YYYY-MM-DD, optionally with a time) in a sensible range. */
function realDate(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(d.trim());
  if (!m) return false;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, da));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === da && !Number.isNaN(Date.parse(d));
}
const nameOf = async (userId: number, c?: import('pg').PoolClient) => (await one('SELECT display_name FROM users WHERE id=$1', [userId], c))?.display_name ?? 'a student';

/* ---------- classes ---------- */
teacherRouter.get('/classes', h(async (req, res) => {
  const rows = await q(`SELECT c.*, (SELECT count(*) FROM students s WHERE s.class_id=c.id) students
    FROM classes c WHERE c.teacher_id=$1 OR $2 ORDER BY c.id`, [req.user!.id, req.user!.role === 'admin']);
  res.json(rows);
}));

const ClassInput = z.object({ name: z.string().trim().min(1, 'Name the class.').max(80), grade: z.string().trim().max(20).optional().nullable() });
teacherRouter.post('/classes', h(async (req, res) => {
  const v = ClassInput.parse(req.body);
  const cls = await tx(async (c) => {
    const k = await createClass(c, req.user!.id, v.name, v.grade ?? null);
    await logActivity(req.user!.id, k.id, 'class_created', { name: v.name }, c);
    return k;
  });
  res.json(cls);
}));

const ClassSettings = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  grade: z.string().trim().max(20).nullable().optional(),
  build_mode: z.enum(BUILD_MODES).optional(),
  harvest_enabled: z.boolean().optional(),
  harvest_daily_cap: z.number().int().min(0).max(1000).optional(),
  unlock_all_regions: z.boolean().optional(),
  adaptive_enabled: z.boolean().optional(),
  chat_mode: z.enum(CHAT_MODES).optional(),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone.').optional()
});
teacherRouter.patch('/classes/:classId', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = ClassSettings.parse(req.body);
  const entries = Object.entries(v).filter(([, val]) => val !== undefined);
  if (entries.length) {
    const sets = entries.map(([k], i) => `${k}=$${i + 2}`).join(', ');
    await q(`UPDATE classes SET ${sets} WHERE id=$1`, [cid(req), ...entries.map(([, val]) => val)]);
    await logActivity(req.user!.id, cid(req), 'class_settings', v);
    hub.toClass(cid(req), 'toast', { kind: 'info', text: 'Your teacher updated the world settings.' });
    if (v.chat_mode) hub.chatConfig(cid(req));
    if (v.build_mode) hub.toClass(cid(req), 'progress', {});
  }
  res.json(await one('SELECT * FROM classes WHERE id=$1', [cid(req)]));
}));

teacherRouter.get('/classes/:classId/overview', h(async (req, res) => {
  const cls = await assertClassAccess(undefined, req.user!, cid(req));
  const s = await one(`SELECT
      (SELECT count(*) FROM students WHERE class_id=$1) students,
      (SELECT count(*) FROM student_answers a JOIN students s ON s.user_id=a.student_id WHERE s.class_id=$1) attempts,
      (SELECT count(*) FROM student_answers a JOIN students s ON s.user_id=a.student_id WHERE s.class_id=$1 AND a.correct) correct,
      (SELECT count(*) FROM student_answers a JOIN students s ON s.user_id=a.student_id WHERE s.class_id=$1 AND a.rewarded) completed,
      (SELECT coalesce(sum(xp),0) FROM students WHERE class_id=$1) xp,
      (SELECT count(*) FROM student_achievements sa JOIN students s ON s.user_id=sa.student_id WHERE s.class_id=$1) achievements,
      (SELECT count(*) FROM questions WHERE class_id=$1) questions,
      (SELECT coalesce(sum(blocks_placed),0) FROM students WHERE class_id=$1) blocks_placed`, [cid(req)]);
  const buildings = await buildingsOf(cls.world_id);
  res.json({
    class: cls,
    students: Number(s.students), questionsCompleted: Number(s.completed), attempts: Number(s.attempts),
    accuracy: Number(s.attempts) ? Math.round((100 * Number(s.correct)) / Number(s.attempts)) : null,
    xpEarned: Number(s.xp), buildings: buildings.length, achievements: Number(s.achievements), questions: Number(s.questions), blocksPlaced: Number(s.blocks_placed)
  });
}));

teacherRouter.get('/classes/:classId/activity', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q(`SELECT l.*, u.display_name actor FROM activity_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE l.class_id=$1 ORDER BY l.id DESC LIMIT 200`, [cid(req)]));
}));

/* ---------- students ---------- */
teacherRouter.get('/classes/:classId/students', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const rows = await q(`SELECT u.id, u.username, u.display_name, u.last_login_at, u.disabled, s.xp, s.level, s.coins, s.blocks_placed, s.can_build, s.frozen, s.muted, s.plot_index,
      (SELECT count(*) FROM student_answers a WHERE a.student_id=s.user_id) attempts,
      (SELECT count(*) FROM student_answers a WHERE a.student_id=s.user_id AND a.correct) correct,
      (SELECT count(*) FROM student_achievements a WHERE a.student_id=s.user_id) achievements
    FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=$1 ORDER BY u.display_name`, [cid(req)]);
  res.json(rows.map((r) => ({ ...r, attempts: Number(r.attempts), correct: Number(r.correct), achievements: Number(r.achievements),
    accuracy: Number(r.attempts) ? Math.round((100 * Number(r.correct)) / Number(r.attempts)) : null })));
}));

const NewStudent = z.object({ username: z.string().trim(), password: z.string().min(4, 'Passwords need at least 4 characters.'), displayName: z.string().trim().max(40).optional() });
teacherRouter.post('/classes/:classId/students', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = NewStudent.parse(req.body);
  const id = await tx(async (c) => {
    const uid = await addStudent(c, cid(req), v.username, v.password, v.displayName);
    await logActivity(req.user!.id, cid(req), 'student_added', { username: v.username }, c);
    return uid;
  }).catch((e) => { throw new HttpError(400, e.message); });
  res.json({ id });
}));

/** Bulk add: one student per line, "username, password, display name". */
teacherRouter.post('/classes/:classId/students/bulk', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const text = z.object({ text: z.string().max(100_000) }).parse(req.body).text;
  const results: { line: number; username: string; ok: boolean; error?: string }[] = [];
  // Accept comma-separated text or rows pasted straight from a spreadsheet (tab-separated).
  const rows = text.includes('\t') ? text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t')) : parseCsv(text);
  for (let i = 0; i < rows.length; i++) {
    const [username = '', password = '', display = ''] = rows[i].map((s) => s.trim());
    if (i === 0 && username.toLowerCase() === 'username') continue;
    try {
      await tx(async (c) => { await addStudent(c, cid(req), username, password, display); });
      results.push({ line: i + 1, username, ok: true });
    } catch (e: any) { results.push({ line: i + 1, username, ok: false, error: e.message }); }
  }
  await logActivity(req.user!.id, cid(req), 'students_bulk_added', { added: results.filter((r) => r.ok).length });
  res.json({ results });
}));

teacherRouter.get('/students/:id', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const profile = await studentProfile(s.user_id);
  const topics = await q(`SELECT qu.subject, coalesce(qu.topic, qu.subject) topic, count(*) attempts, count(*) FILTER (WHERE a.correct) correct,
      round(100.0 * count(*) FILTER (WHERE a.correct) / count(*)) accuracy, round(avg(a.time_spent_ms)/1000.0) avg_seconds
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE a.student_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [s.user_id]);
  const recent = await q(`SELECT a.created_at, a.correct, a.answer_text, a.attempt_no, qu.prompt, qu.subject, qu.topic, qu.difficulty
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE a.student_id=$1 ORDER BY a.id DESC LIMIT 25`, [s.user_id]);
  const assignments = await q(`SELECT a.title, sa.completed_at FROM student_assignments sa JOIN assignments a ON a.id=sa.assignment_id WHERE sa.student_id=$1 ORDER BY sa.completed_at DESC`, [s.user_id]);
  const activity = await q(`SELECT action, details, created_at FROM activity_logs WHERE actor_id=$1 ORDER BY id DESC LIMIT 25`, [s.user_id]);
  res.json({ profile, topics: topics.map((t) => ({ ...t, attempts: Number(t.attempts), correct: Number(t.correct), accuracy: Number(t.accuracy), avg_seconds: t.avg_seconds === null ? null : Number(t.avg_seconds) })),
    weakTopics: await weakTopics(s.user_id), recent, assignments, activity });
}));

const StudentPatch = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  password: z.string().min(4).optional(),
  can_build: z.boolean().optional(),
  frozen: z.boolean().optional(),
  disabled: z.boolean().optional(),
  muted: z.boolean().optional()
});
teacherRouter.patch('/students/:id', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const v = StudentPatch.parse(req.body);
  if (v.displayName) await q('UPDATE users SET display_name=$2 WHERE id=$1', [s.user_id, v.displayName]);
  if (v.password) { await q('UPDATE users SET password_hash=$2 WHERE id=$1', [s.user_id, await hashPassword(v.password)]); await q('DELETE FROM sessions WHERE user_id=$1', [s.user_id]); hub.kick(s.user_id); }
  if (v.disabled !== undefined) { await q('UPDATE users SET disabled=$2 WHERE id=$1', [s.user_id, v.disabled]); if (v.disabled) hub.kick(s.user_id); }
  if (v.can_build !== undefined) await q('UPDATE students SET can_build=$2 WHERE user_id=$1', [s.user_id, v.can_build]);
  if (v.muted !== undefined) { await q('UPDATE students SET muted=$2 WHERE user_id=$1', [s.user_id, v.muted]); hub.chatConfig(s.class_id); }
  if (v.frozen !== undefined) { await q('UPDATE students SET frozen=$2 WHERE user_id=$1', [s.user_id, v.frozen]); hub.toUser(s.user_id, 'frozen', { frozen: v.frozen }); }
  await logActivity(req.user!.id, s.class_id, 'student_updated', { student: s.user_id, name: await nameOf(s.user_id), ...v, password: v.password ? '(reset)' : undefined });
  res.json({ ok: true });
}));

teacherRouter.delete('/students/:id', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  hub.kick(s.user_id);
  const name = await nameOf(s.user_id);
  await q('DELETE FROM users WHERE id=$1', [s.user_id]);
  await logActivity(req.user!.id, s.class_id, 'student_deleted', { student: s.user_id, name });
  res.json({ ok: true });
}));

/** Teacher gives a bonus reward directly (XP, skill, blocks, coins). */
const Bonus = z.object({
  xp: z.number().int().min(0).max(100000).optional(), coins: z.number().int().min(0).max(100000).optional(),
  skill_id: z.number().int().optional().nullable(), skill_amount: z.number().int().min(0).max(1000).optional(),
  block_id: z.number().int().optional().nullable(), block_qty: z.number().int().min(0).max(1000).optional(), reason: z.string().max(200).optional(),
  item_key: z.string().optional().nullable()
});
teacherRouter.post('/students/:id/reward', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const v = Bonus.parse(req.body);
  if (v.block_id && !isRewardable(v.block_id)) throw new HttpError(400, 'That block cannot be given.');
  const r = await tx(async (c) => {
    const out = await grantReward(c, s.user_id, { xp: v.xp, coins: v.coins, skillId: v.skill_id, skillAmount: v.skill_amount, blockId: v.block_id, blockQty: v.block_qty }, `teacher_bonus:${v.reason ?? ''}`);
    if (v.item_key) { if (!COSMETIC_BY_KEY[v.item_key]) throw new HttpError(400, 'Unknown item.'); await giveItem(c, s.user_id, v.item_key); }
    await logActivity(req.user!.id, s.class_id, 'teacher_bonus', { student: s.user_id, name: await nameOf(s.user_id, c), ...v }, c);
    return out;
  });
  hub.toUser(s.user_id, 'progress', { xp: r.xp, level: r.level, coins: r.coins });
  hub.toUser(s.user_id, 'inventory', { items: await inventoryOf(undefined, s.user_id) });
  hub.toUser(s.user_id, 'toast', { kind: 'reward', text: `Your teacher sent you a reward${v.reason ? `: ${v.reason}` : ''}.` });
  res.json(r);
}));

/* ---------- moderation ---------- */
teacherRouter.post('/students/:id/remove-builds', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const cls = await one('SELECT world_id FROM classes WHERE id=$1', [s.class_id]);
  const n = await removeStudentBuilds(cls.world_id, s.user_id);
  await logActivity(req.user!.id, s.class_id, 'remove_student_builds', { student: s.user_id, name: await nameOf(s.user_id), blocks: n });
  hub.resetWorld(cls.world_id); // per-viewer: blocks awaiting approval stay hidden from classmates
  res.json({ removed: n });
}));

teacherRouter.post('/students/:id/teleport-home', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const p = plotBounds(s.plot_index);
  hub.toUser(s.user_id, 'teleport', { x: (p.x0 + p.x1) / 2 + 0.5, y: SPAWN.y + 1, z: (p.z0 + p.z1) / 2 + 0.5 });
  await logActivity(req.user!.id, s.class_id, 'teleport_student', { student: s.user_id, name: await nameOf(s.user_id) });
  res.json({ ok: true });
}));

const coord = z.number().int().min(0, 'Coordinates start at 0.').max(WORLD_SIZE - 1, `Coordinates go up to ${WORLD_SIZE - 1}.`);
const Area = z.object({ x0: coord, z0: coord, x1: coord, z1: coord });
teacherRouter.post('/classes/:classId/reset-area', h(async (req, res) => {
  const cls = await assertClassAccess(undefined, req.user!, cid(req));
  const v = Area.parse(req.body);
  const n = await resetArea(cls.world_id, v.x0, v.z0, v.x1, v.z1);
  await logActivity(req.user!.id, cls.id, 'reset_area', { ...v, blocks: n });
  hub.resetWorld(cls.world_id);
  res.json({ removed: n });
}));

teacherRouter.get('/classes/:classId/buildings', h(async (req, res) => {
  const cls = await assertClassAccess(undefined, req.user!, cid(req));
  const b = await buildingsOf(cls.world_id);
  const names = new Map((await q('SELECT id, display_name FROM users WHERE id = ANY($1)', [b.map((x) => x.owner)])).map((r) => [r.id, r.display_name]));
  res.json(b.map((x) => ({ ...x, ownerName: names.get(x.owner) ?? 'Unknown' })));
}));

/* ---------- project zones ---------- */
teacherRouter.get('/classes/:classId/zones', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q('SELECT * FROM project_zones WHERE class_id=$1 ORDER BY id', [cid(req)]));
}));
teacherRouter.post('/classes/:classId/zones', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = Area.extend({ name: z.string().trim().min(1).max(80), bonus_xp_per_block: z.number().int().min(0).max(100).default(0) }).parse(req.body);
  const r = await one('INSERT INTO project_zones (class_id, name, x0, z0, x1, z1, bonus_xp_per_block) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [cid(req), v.name, v.x0, v.z0, v.x1, v.z1, v.bonus_xp_per_block]);
  await logActivity(req.user!.id, cid(req), 'zone_created', v);
  res.json(r);
}));
teacherRouter.delete('/classes/:classId/zones/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  await q('DELETE FROM project_zones WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  await logActivity(req.user!.id, cid(req), 'zone_deleted', { id: req.params.id });
  res.json({ ok: true });
}));

/* ---------- skills ---------- */
teacherRouter.get('/classes/:classId/skills', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q('SELECT * FROM skills WHERE class_id=$1 ORDER BY id', [cid(req)]));
}));
teacherRouter.post('/classes/:classId/skills', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
  const r = await one('INSERT INTO skills (class_id, name) VALUES ($1,$2) ON CONFLICT (class_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING *', [cid(req), v.name]);
  res.json(r);
}));
teacherRouter.delete('/classes/:classId/skills/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  await q('DELETE FROM skills WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  res.json({ ok: true });
}));

/* ---------- questions ---------- */
teacherRouter.get('/classes/:classId/questions', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const rows = await q(`SELECT qu.*, sk.name skill_name,
      (SELECT count(*) FROM student_answers a WHERE a.question_id=qu.id) attempts,
      (SELECT count(*) FROM student_answers a WHERE a.question_id=qu.id AND a.correct) correct,
      (SELECT count(*) FROM student_answers a WHERE a.question_id=qu.id AND a.rewarded) solved_by
    FROM questions qu LEFT JOIN skills sk ON sk.id=qu.skill_id WHERE qu.class_id=$1 ORDER BY qu.id DESC`, [cid(req)]);
  const answers = await q('SELECT question_id, id, text, is_correct, match_text FROM question_answers WHERE question_id = ANY($1) ORDER BY sort, id', [rows.map((r) => r.id)]);
  res.json(rows.map((r) => ({ ...r, attempts: Number(r.attempts), correct: Number(r.correct), solved_by: Number(r.solved_by),
    accuracy: Number(r.attempts) ? Math.round((100 * Number(r.correct)) / Number(r.attempts)) : null,
    answers: answers.filter((a) => a.question_id === r.id) })));
}));
teacherRouter.post('/classes/:classId/questions', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = QuestionInput.parse(req.body);
  const id = await tx(async (c) => {
    const qid = await saveQuestion(c, cid(req), req.user!.id, v);
    await logActivity(req.user!.id, cid(req), 'question_created', { id: qid, prompt: v.prompt.slice(0, 80) }, c);
    return qid;
  });
  res.json(await questionWithAnswers(id));
}));
teacherRouter.put('/classes/:classId/questions/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = QuestionInput.parse(req.body);
  await tx(async (c) => {
    await saveQuestion(c, cid(req), req.user!.id, v, int(req.params.id));
    await logActivity(req.user!.id, cid(req), 'question_updated', { id: int(req.params.id) }, c);
  });
  res.json(await questionWithAnswers(int(req.params.id)));
}));
teacherRouter.patch('/classes/:classId/questions/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = z.object({ active: z.boolean() }).parse(req.body);
  const r = await q('UPDATE questions SET active=$3, updated_at=now() WHERE id=$1 AND class_id=$2 RETURNING prompt', [int(req.params.id), cid(req), v.active]);
  if (!r.length) throw new HttpError(404, 'Question not found.');
  await logActivity(req.user!.id, cid(req), v.active ? 'question_shown' : 'question_hidden', { prompt: r[0].prompt.slice(0, 80) });
  res.json({ ok: true });
}));
teacherRouter.delete('/classes/:classId/questions/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const r = await q('DELETE FROM questions WHERE id=$1 AND class_id=$2 RETURNING prompt', [int(req.params.id), cid(req)]);
  if (!r.length) throw new HttpError(404, 'Question not found.');
  await logActivity(req.user!.id, cid(req), 'question_deleted', { id: int(req.params.id), prompt: r[0].prompt.slice(0, 80) });
  res.json({ ok: true });
}));

const CSV_HEADER = ['Type', 'Question', 'Answer', 'Option A', 'Option B', 'Option C', 'Option D', 'Subject', 'Topic', 'Grade', 'Difficulty', 'XP', 'Skill', 'Skill Amount', 'Reward Block', 'Block Quantity', 'Coins', 'Explanation', 'Tolerance', 'Time Limit'];

teacherRouter.get('/classes/:classId/questions.csv', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const rows = await q(`SELECT qu.*, sk.name skill_name FROM questions qu LEFT JOIN skills sk ON sk.id=qu.skill_id WHERE qu.class_id=$1 ORDER BY qu.id`, [cid(req)]);
  const answers = await q('SELECT question_id, text, is_correct, match_text FROM question_answers WHERE question_id = ANY($1) ORDER BY sort, id', [rows.map((r) => r.id)]);
  const out: (string | number | null)[][] = [CSV_HEADER];
  for (const r of rows) {
    const a = answers.filter((x) => x.question_id === r.id);
    const correct = r.type === 'matching' ? a.map((x) => `${x.text}=${x.match_text}`).join(' | ') : a.filter((x) => x.is_correct).map((x) => x.text).join(' | ');
    const opts = r.type === 'multiple_choice' ? a.map((x) => x.text) : [];
    out.push([r.type, r.prompt, correct, opts[0] ?? '', opts[1] ?? '', opts[2] ?? '', opts[3] ?? '', r.subject, r.topic, r.grade_level, r.difficulty, r.xp_reward,
      r.skill_name, r.skill_amount, r.block_id ? BLOCK_BY_ID[r.block_id]?.name : '', r.block_qty, r.coin_reward, r.explanation, r.numeric_tolerance || '', r.time_limit_sec ?? '']);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="questions-class-${cid(req)}.csv"`);
  res.send(toCsv(out));
}));

/** Import questions from CSV (same columns as export; blank reward cells use the difficulty defaults). */
teacherRouter.post('/classes/:classId/questions/import', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const text = z.object({ csv: z.string().max(2_000_000) }).parse(req.body).csv;
  const rows = parseCsv(text);
  if (!rows.length) throw new HttpError(400, 'The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  if (col('question') < 0 || col('answer') < 0) throw new HttpError(400, 'The first row must include at least "Question" and "Answer" columns.');
  const skills = await q('SELECT id, name FROM skills WHERE class_id=$1', [cid(req)]);
  const blockByName = (s: string) => Object.values(BLOCK_BY_KEY).find((b) => b.name.toLowerCase() === s.toLowerCase() || b.key === s.toLowerCase());
  const results: { row: number; ok: boolean; error?: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    try {
      const opts = ['option a', 'option b', 'option c', 'option d'].map(g).filter(Boolean);
      const correct = g('answer').split('|').map((s) => s.trim()).filter(Boolean);
      let type = (g('type') || (opts.length ? 'multiple_choice' : /^-?\d+(\.\d+)?$/.test(correct[0] ?? '') ? 'numeric' : ['true', 'false'].includes((correct[0] ?? '').toLowerCase()) ? 'true_false' : 'short_answer')) as any;
      if (!QUESTION_TYPES.includes(type)) type = 'short_answer';
      let answers: { text: string; is_correct: boolean; match_text?: string }[];
      if (type === 'matching') {
        answers = correct.map((p) => { const i = p.indexOf('='); return { text: p.slice(0, i).trim(), match_text: p.slice(i + 1).trim(), is_correct: true }; });
        if (correct.some((p) => !p.includes('='))) throw new Error('Matching answers look like: cat=gato | dog=perro');
      } else if (type === 'multiple_choice') {
        answers = opts.map((o) => ({ text: o, is_correct: correct.some((c) => c.toLowerCase() === o.toLowerCase() || c.toUpperCase() === 'ABCD'[opts.indexOf(o)]) }));
      } else if (type === 'true_false') {
        const t = (correct[0] ?? '').toLowerCase() === 'true';
        answers = [{ text: 'True', is_correct: t }, { text: 'False', is_correct: !t }];
      } else answers = correct.map((c) => ({ text: c, is_correct: true }));
      const num = (s: string) => (s === '' ? undefined : Number(s));
      const skill = skills.find((s) => s.name.toLowerCase() === g('skill').toLowerCase());
      const block = g('reward block') ? blockByName(g('reward block')) : undefined;
      if (g('reward block') && !block) throw new Error(`Unknown block "${g('reward block')}".`);
      const input = QuestionInput.parse({
        type, prompt: g('question'), answers, subject: g('subject') || 'General', topic: g('topic') || null, grade_level: g('grade') || null,
        difficulty: num(g('difficulty')) ?? 1, xp_reward: num(g('xp')), skill_id: skill?.id ?? null, skill_amount: num(g('skill amount')),
        block_id: block ? block.id : undefined, block_qty: num(g('block quantity')), coin_reward: num(g('coins')), explanation: g('explanation') || null,
        numeric_tolerance: num(g('tolerance')), time_limit_sec: num(g('time limit')) ?? null
      });
      await tx((c) => saveQuestion(c, cid(req), req.user!.id, input));
      results.push({ row: i + 1, ok: true });
    } catch (e: any) {
      results.push({ row: i + 1, ok: false, error: e.issues ? e.issues.map((x: any) => x.message).join(' ') : e.message });
    }
  }
  await logActivity(req.user!.id, cid(req), 'questions_imported', { imported: results.filter((r) => r.ok).length });
  res.json({ results, imported: results.filter((r) => r.ok).length });
}));

/* ---------- assignments ---------- */
const AssignmentInput = z.object({
  title: z.string().trim().min(1, 'Give the assignment a title.').max(120), description: z.string().trim().max(1000).optional().nullable(),
  question_ids: z.array(z.number().int()).min(1, 'Pick at least one question.'),
  target: z.enum(['class', 'students']).default('class'), student_ids: z.array(z.number().int()).optional(),
  xp_reward: z.number().int().min(0).max(100000).default(0), block_id: z.number().int().nullable().optional(), block_qty: z.number().int().min(0).max(1000).default(0),
  coin_reward: z.number().int().min(0).max(100000).default(0),
  due_date: z.string().optional().nullable().refine((d) => !d || realDate(d), 'The due date is not a valid date.')
});
teacherRouter.get('/classes/:classId/assignments', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q(`SELECT a.*, (SELECT array_agg(question_id) FROM assignment_questions WHERE assignment_id=a.id) question_ids,
      (SELECT array_agg(student_id) FROM assignment_students WHERE assignment_id=a.id) student_ids,
      (SELECT count(*) FROM student_assignments WHERE assignment_id=a.id)::int completed
    FROM assignments a WHERE a.class_id=$1 ORDER BY a.id DESC`, [cid(req)]));
}));
teacherRouter.post('/classes/:classId/assignments', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = AssignmentInput.parse(req.body);
  if (v.block_id && !isRewardable(v.block_id)) throw new HttpError(400, 'That block cannot be given.');
  const id = await tx(async (c) => {
    const a = await one(`INSERT INTO assignments (class_id, title, description, target, xp_reward, block_id, block_qty, coin_reward, due_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [cid(req), v.title, v.description ?? null, v.target, v.xp_reward, v.block_id ?? null, v.block_qty, v.coin_reward, v.due_date || null], c);
    for (const qid of v.question_ids) {
      const ok = await one('SELECT 1 FROM questions WHERE id=$1 AND class_id=$2', [qid, cid(req)], c);
      if (!ok) throw new HttpError(400, 'One of the questions is not in this class.');
      await c.query('INSERT INTO assignment_questions VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, qid]);
    }
    if (v.target === 'students') for (const sid of v.student_ids ?? []) {
      const ok = await one('SELECT 1 FROM students WHERE user_id=$1 AND class_id=$2', [sid, cid(req)], c);
      if (ok) await c.query('INSERT INTO assignment_students VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, sid]);
    }
    await logActivity(req.user!.id, cid(req), 'assignment_created', { id: a.id, title: v.title }, c);
    return a.id;
  });
  hub.toClass(cid(req), 'toast', { kind: 'info', text: `New assignment: ${v.title}` });
  res.json({ id });
}));
teacherRouter.delete('/classes/:classId/assignments/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  await q('DELETE FROM assignments WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  res.json({ ok: true });
}));

/* ---------- achievements ---------- */
teacherRouter.get('/classes/:classId/achievements', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q(`SELECT a.*, (SELECT count(*) FROM student_achievements sa WHERE sa.achievement_id=a.id)::int earned_by FROM achievements a WHERE a.class_id=$1 ORDER BY a.id`, [cid(req)]));
}));
const AchInput = z.object({
  name: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200),
  criteria_type: z.enum(['questions_answered', 'correct_answers', 'correct_in_subject', 'hard_correct', 'blocks_placed', 'xp_total', 'assignments_completed', 'manual']),
  criteria_subject: z.string().trim().max(60).optional().nullable(), threshold: z.number().int().min(1).max(1_000_000).default(1),
  xp_reward: z.number().int().min(0).max(100000).default(0), coin_reward: z.number().int().min(0).max(100000).default(0)
});
teacherRouter.post('/classes/:classId/achievements', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = AchInput.parse(req.body);
  const key = 'custom_' + v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);
  const r = await one(`INSERT INTO achievements (class_id, key, name, description, criteria_type, criteria_subject, threshold, xp_reward, coin_reward)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [cid(req), key, v.name, v.description, v.criteria_type, v.criteria_subject ?? null, v.threshold, v.xp_reward, v.coin_reward]);
  await logActivity(req.user!.id, cid(req), 'achievement_created', { name: v.name });
  res.json(r);
}));
teacherRouter.delete('/classes/:classId/achievements/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  await q('DELETE FROM achievements WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  res.json({ ok: true });
}));
teacherRouter.post('/students/:id/achievements/:achId', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const a = await tx(async (c) => {
    const ok = await one('SELECT 1 FROM achievements WHERE id=$1 AND class_id=$2', [int(req.params.achId), s.class_id], c);
    if (!ok) throw new HttpError(404, 'Achievement not found.');
    return awardAchievement(c, s.user_id, int(req.params.achId));
  });
  await logActivity(req.user!.id, s.class_id, 'achievement_awarded', { student: s.user_id, achievement: a.name });
  hub.toUser(s.user_id, 'toast', { kind: 'reward', text: `Achievement unlocked: ${a.name}` });
  res.json({ ok: true });
}));

/* ---------- analytics ---------- */
teacherRouter.get('/classes/:classId/analytics', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const topics = await q(`SELECT qu.subject, coalesce(qu.topic, qu.subject) topic, count(*) attempts, count(*) FILTER (WHERE a.correct) correct,
      round(100.0 * count(*) FILTER (WHERE a.correct) / count(*)) accuracy, count(DISTINCT a.student_id) students
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE qu.class_id=$1 GROUP BY 1,2 ORDER BY accuracy ASC, attempts DESC`, [cid(req)]);
  const byDifficulty = await q(`SELECT qu.difficulty, count(*) attempts, round(100.0 * count(*) FILTER (WHERE a.correct) / count(*)) accuracy
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE qu.class_id=$1 GROUP BY 1 ORDER BY 1`, [cid(req)]);
  const daily = await q(`SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') AS day, count(*) AS attempts, count(*) FILTER (WHERE a.correct) correct
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE qu.class_id=$1 AND a.created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [cid(req)]);
  const struggling = await q(`SELECT u.id, u.display_name, qu.subject, coalesce(qu.topic, qu.subject) topic, count(*) attempts,
      round(100.0 * count(*) FILTER (WHERE a.correct) / count(*)) accuracy
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id JOIN users u ON u.id=a.student_id
    WHERE qu.class_id=$1 GROUP BY 1,2,3,4 HAVING count(*) >= 3 AND 100.0 * count(*) FILTER (WHERE a.correct) / count(*) < 60 ORDER BY accuracy ASC LIMIT 50`, [cid(req)]);
  const n = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) && k !== 'day' ? Number(v) : v])));
  res.json({ topics: n(topics), byDifficulty: n(byDifficulty), daily: n(daily), struggling: n(struggling) });
}));

/* ---------- students' levels summary for charts ---------- */
teacherRouter.get('/classes/:classId/levels', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const rows = await q('SELECT u.display_name, s.xp FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=$1 ORDER BY s.xp DESC', [cid(req)]);
  res.json(rows.map((r) => ({ name: r.display_name, ...levelProgress(r.xp) })));
}));

/* ---------- quests & daily challenges ---------- */
const StepInput = z.object({
  kind: z.enum(QUEST_STEP_KINDS), amount: z.coerce.number().int().min(1).max(1000).default(1),
  subject: z.string().trim().max(60).optional().nullable(), topic: z.string().trim().max(80).optional().nullable(),
  region: z.string().optional().nullable(), description: z.string().trim().max(200).optional().nullable()
}).superRefine((s, ctx) => {
  if (s.kind === 'subject_correct' && !s.subject) ctx.addIssue({ code: 'custom', message: 'Choose the subject for that step.' });
  if (s.kind === 'topic_correct' && !s.topic) ctx.addIssue({ code: 'custom', message: 'Type the topic for that step.' });
  if (s.kind === 'visit_region' && !(s.region && Object.hasOwn(REGIONS, s.region))) ctx.addIssue({ code: 'custom', message: 'Choose the region to visit.' });
});
const QuestInput = z.object({
  title: z.string().trim().min(1, 'Give the quest a title.').max(120), description: z.string().trim().max(1000).optional().nullable(),
  repeat: z.enum(QUEST_REPEATS).default('none'), active: z.boolean().default(true),
  xp_reward: z.coerce.number().int().min(0).max(100000).default(0), block_id: z.coerce.number().int().nullable().optional(),
  block_qty: z.coerce.number().int().min(0).max(1000).default(0), coin_reward: z.coerce.number().int().min(0).max(100000).default(0),
  item_key: z.string().nullable().optional(), steps: z.array(StepInput).min(1, 'Add at least one step.').max(10)
});
async function saveQuest(c: import('pg').PoolClient, classId: number, v: z.infer<typeof QuestInput>, id?: number) {
  if (v.block_id && !isRewardable(v.block_id)) throw new HttpError(400, 'That block cannot be given.');
  if (v.item_key && !COSMETIC_BY_KEY[v.item_key]) throw new HttpError(400, 'Unknown item.');
  const vals = [v.title, v.description ?? null, v.repeat, v.active, v.xp_reward, v.block_id ?? null, v.block_qty, v.coin_reward, v.item_key || null];
  let qid = id;
  if (id) {
    const r = await q(`UPDATE quests SET title=$1, description=$2, repeat=$3, active=$4, xp_reward=$5, block_id=$6, block_qty=$7, coin_reward=$8, item_key=$9 WHERE id=$10 AND class_id=$11 RETURNING id`, [...vals, id, classId], c);
    if (!r.length) throw new HttpError(404, 'Quest not found.');
    await q('DELETE FROM quest_steps WHERE quest_id=$1', [id], c);
    await q('DELETE FROM student_quests WHERE quest_id=$1 AND completed_at IS NULL', [id], c); // steps changed: in-progress runs restart
  } else {
    qid = (await one(`INSERT INTO quests (title, description, repeat, active, xp_reward, block_id, block_qty, coin_reward, item_key, class_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [...vals, classId], c)).id;
  }
  for (let i = 0; i < v.steps.length; i++) {
    const st = v.steps[i];
    await q('INSERT INTO quest_steps (quest_id, sort, kind, amount, subject, topic, region, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [qid, i, st.kind, st.amount, st.subject || null, st.topic || null, st.region || null, st.description || describeStep({ ...st, region: st.region ? REGIONS[st.region as keyof typeof REGIONS]?.name : null })], c);
  }
  return qid!;
}
teacherRouter.get('/classes/:classId/quests', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const quests = await q(`SELECT qu.*, (SELECT count(*)::int FROM student_quests sq WHERE sq.quest_id=qu.id AND sq.completed_at IS NOT NULL) completions
    FROM quests qu WHERE qu.class_id=$1 ORDER BY qu.id DESC`, [cid(req)]);
  const steps = await q('SELECT * FROM quest_steps WHERE quest_id = ANY($1) ORDER BY sort, id', [quests.map((x) => x.id)]);
  res.json(quests.map((qu) => ({ ...qu, steps: steps.filter((s) => s.quest_id === qu.id) })));
}));
teacherRouter.post('/classes/:classId/quests', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = QuestInput.parse(req.body);
  const id = await tx(async (c) => { const i = await saveQuest(c, cid(req), v); await logActivity(req.user!.id, cid(req), 'quest_created', { title: v.title, repeat: v.repeat }, c); return i; });
  hub.toClass(cid(req), 'questUpdate', {});
  hub.toClass(cid(req), 'toast', { kind: 'info', text: `New ${v.repeat === 'daily' ? 'daily challenge' : v.repeat === 'weekly' ? 'weekly challenge' : 'quest'}: ${v.title}` });
  res.json({ id });
}));
teacherRouter.put('/classes/:classId/quests/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = QuestInput.parse(req.body);
  await tx((c) => saveQuest(c, cid(req), v, int(req.params.id)));
  await logActivity(req.user!.id, cid(req), 'quest_updated', { title: v.title });
  hub.toClass(cid(req), 'questUpdate', {});
  res.json({ ok: true });
}));
teacherRouter.patch('/classes/:classId/quests/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = z.object({ active: z.boolean() }).parse(req.body);
  const r = await q('UPDATE quests SET active=$3 WHERE id=$1 AND class_id=$2 RETURNING title', [int(req.params.id), cid(req), v.active]);
  if (!r.length) throw new HttpError(404, 'Quest not found.');
  await logActivity(req.user!.id, cid(req), v.active ? 'quest_activated' : 'quest_deactivated', { title: r[0].title });
  hub.toClass(cid(req), 'questUpdate', {});
  res.json({ ok: true });
}));
teacherRouter.delete('/classes/:classId/quests/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const r = await q('DELETE FROM quests WHERE id=$1 AND class_id=$2 RETURNING title', [int(req.params.id), cid(req)]);
  if (!r.length) throw new HttpError(404, 'Quest not found.');
  await logActivity(req.user!.id, cid(req), 'quest_deleted', { title: r[0].title });
  hub.toClass(cid(req), 'questUpdate', {});
  res.json({ ok: true });
}));

/* ---------- special events ---------- */
const EventInput = z.object({
  title: z.string().trim().min(1, 'Give the event a title.').max(120), description: z.string().trim().max(1000).optional().nullable(),
  goal_kind: z.enum(EVENT_GOALS), subject: z.string().trim().max(60).optional().nullable(), goal_amount: z.coerce.number().int().min(1).max(1_000_000),
  ends_at: z.string().optional().nullable().refine((d) => !d || realDate(d), 'The end date is not a valid date.').refine((d) => !d || !realDate(d) || Date.parse(d) > Date.now(), 'The end date is already in the past.'), reward_xp: z.coerce.number().int().min(0).max(100000).default(0), reward_coins: z.coerce.number().int().min(0).max(100000).default(0),
  reward_item: z.string().optional().nullable(), unlock_structure: z.string().optional().nullable(),
  structure_x: z.coerce.number().int().min(2).max(WORLD_SIZE - 3).optional().nullable(), structure_z: z.coerce.number().int().min(2).max(WORLD_SIZE - 3).optional().nullable()
}).superRefine((v, ctx) => {
  if (v.goal_kind === 'subject_correct' && !v.subject) ctx.addIssue({ code: 'custom', message: 'Choose the subject for the goal.' });
  if (v.unlock_structure && !STRUCTURE_BY_KEY[v.unlock_structure]) ctx.addIssue({ code: 'custom', message: 'Unknown structure.' });
  if (v.reward_item && !COSMETIC_BY_KEY[v.reward_item]) ctx.addIssue({ code: 'custom', message: 'Unknown item.' });
});
teacherRouter.get('/classes/:classId/events', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q(`SELECT e.*, (SELECT count(*)::int FROM event_contributions ec WHERE ec.event_id=e.id AND ec.points>0) helpers FROM events e WHERE e.class_id=$1 ORDER BY e.id DESC`, [cid(req)]));
}));
teacherRouter.post('/classes/:classId/events', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = EventInput.parse(req.body);
  const r = await one(`INSERT INTO events (class_id, title, description, goal_kind, subject, goal_amount, ends_at, reward_xp, reward_coins, reward_item, unlock_structure, structure_x, structure_z)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [cid(req), v.title, v.description ?? null, v.goal_kind, v.subject ?? null, v.goal_amount, v.ends_at || null,
    v.reward_xp, v.reward_coins, v.reward_item || null, v.unlock_structure || null, v.unlock_structure ? v.structure_x ?? 138 : null, v.unlock_structure ? v.structure_z ?? 138 : null]);
  await logActivity(req.user!.id, cid(req), 'event_created', { title: v.title });
  hub.toClass(cid(req), 'toast', { kind: 'info', text: `Class event started: ${v.title}` });
  hub.toClass(cid(req), 'questUpdate', {});
  res.json(r);
}));
teacherRouter.post('/classes/:classId/events/:id/points', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = z.object({ points: z.number().int().min(1).max(100000), student_id: z.number().int().optional().nullable() }).parse(req.body);
  const r = await tx(async (c) => {
    const e = await one('SELECT * FROM events WHERE id=$1 AND class_id=$2 FOR UPDATE', [int(req.params.id), cid(req)], c);
    if (!e) throw new HttpError(404, 'Event not found.');
    if (e.completed_at) throw new HttpError(400, 'That event is already complete.');
    if (v.student_id && !(await one('SELECT 1 FROM students WHERE user_id=$1 AND class_id=$2', [v.student_id, cid(req)], c))) throw new HttpError(400, 'That student is not in this class.');
    const done = await addEventPoints(c, e, v.student_id ?? null, v.points);
    await logActivity(req.user!.id, cid(req), 'event_points', { event: e.title, points: v.points, student: v.student_id }, c);
    return { done, e };
  });
  const cls = await one('SELECT world_id FROM classes WHERE id=$1', [cid(req)]);
  if (r.done) await announceEvent({ eventId: r.e.id, classId: cid(req), worldId: cls.world_id, title: r.e.title });
  else hub.toClass(cid(req), 'questUpdate', {});
  res.json({ completed: r.done });
}));
teacherRouter.post('/classes/:classId/events/:id/complete', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const e = await one('SELECT * FROM events WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  if (!e) throw new HttpError(404, 'Event not found.');
  if (e.completed_at) throw new HttpError(400, 'That event is already complete.');
  const cls = await one('SELECT world_id FROM classes WHERE id=$1', [cid(req)]);
  await announceEvent({ eventId: e.id, classId: cid(req), worldId: cls.world_id, title: e.title });
  res.json({ ok: true });
}));
teacherRouter.delete('/classes/:classId/events/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const r = await q('DELETE FROM events WHERE id=$1 AND class_id=$2 RETURNING title', [int(req.params.id), cid(req)]);
  if (!r.length) throw new HttpError(404, 'Event not found.');
  await logActivity(req.user!.id, cid(req), 'event_deleted', { title: r[0].title });
  hub.toClass(cid(req), 'questUpdate', {});
  res.json({ ok: true });
}));

/* ---------- building approvals ---------- */
teacherRouter.get('/classes/:classId/approvals', h(async (req, res) => {
  const cls = await assertClassAccess(undefined, req.user!, cid(req));
  const pending = await pendingCounts(cls.world_id);
  const students = await q('SELECT s.user_id, u.display_name, s.plot_index FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=$1', [cid(req)]);
  const subs = await q(`SELECT b.*, u.display_name FROM build_submissions b JOIN users u ON u.id=b.student_id WHERE b.class_id=$1 ORDER BY (b.status='pending') DESC, b.id DESC LIMIT 100`, [cid(req)]);
  res.json({
    buildMode: cls.build_mode,
    pending: pending.map((p) => { const s = students.find((x) => x.user_id === p.placed_by); return { studentId: p.placed_by, name: s?.display_name ?? 'Unknown', blocks: p.n, plot: s ? plotBounds(s.plot_index) : null, submitted: subs.some((b) => b.student_id === p.placed_by && b.status === 'pending') }; }),
    submissions: subs
  });
}));
const Review = z.object({ feedback: z.string().trim().max(300).optional().nullable() });
teacherRouter.post('/students/:id/approve', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const v = Review.parse(req.body);
  const cls = await one('SELECT world_id FROM classes WHERE id=$1', [s.class_id]);
  const edits = await approvePending(cls.world_id, s.user_id);
  if (!edits.length) throw new HttpError(400, 'There are no new blocks from this student to approve.');
  await q(`UPDATE build_submissions SET status='approved', feedback=$2, reviewed_at=now(), reviewed_by=$3 WHERE student_id=$1 AND status='pending'`, [s.user_id, v.feedback ?? null, req.user!.id]);
  await logActivity(req.user!.id, s.class_id, 'build_approved', { student: s.user_id, name: await nameOf(s.user_id), blocks: edits.length });
  hub.toUser(0, 'blockBatchFor', { worldId: cls.world_id, edits, everyone: true, owner: s.user_id });
  hub.toUser(s.user_id, 'toast', { kind: 'reward', text: `Your teacher approved your build (${edits.length} blocks)! Everyone can see it now.${v.feedback ? ' “' + v.feedback + '”' : ''}` });
  res.json({ approved: edits.length });
}));
teacherRouter.post('/students/:id/reject', h(async (req, res) => {
  const s = await assertStudentAccess(req.user!, int(req.params.id));
  const v = Review.parse(req.body);
  const cls = await one('SELECT world_id FROM classes WHERE id=$1', [s.class_id]);
  const r = await rejectPending(cls.world_id, s.user_id);
  if (!r.returned) throw new HttpError(400, 'There are no new blocks from this student to send back.');
  await q(`UPDATE build_submissions SET status='rejected', feedback=$2, reviewed_at=now(), reviewed_by=$3 WHERE student_id=$1 AND status='pending'`, [s.user_id, v.feedback ?? null, req.user!.id]);
  await logActivity(req.user!.id, s.class_id, 'build_rejected', { student: s.user_id, name: await nameOf(s.user_id), blocks: r.returned });
  hub.toUser(0, 'blockBatchFor', { worldId: cls.world_id, edits: r.edits, everyone: false, owner: s.user_id });
  hub.toUser(s.user_id, 'inventory', { items: await inventoryOf(undefined, s.user_id) });
  hub.toUser(s.user_id, 'toast', { kind: 'info', text: `Your teacher sent your build back. Your ${r.returned} blocks are in your inventory again.${v.feedback ? ' “' + v.feedback + '”' : ''}` });
  res.json({ removed: r.returned });
}));

/* ---------- chat moderation ---------- */
teacherRouter.get('/classes/:classId/chat', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  res.json(await q(`SELECT m.id::int, m.user_id, u.display_name name, u.role, m.text, m.original, m.hidden, m.created_at FROM messages m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.class_id=$1 ORDER BY m.id DESC LIMIT 300`, [cid(req)]));
}));
teacherRouter.patch('/classes/:classId/chat/:id', h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, cid(req));
  const v = z.object({ hidden: z.boolean() }).parse(req.body);
  const before = await one('SELECT hidden FROM messages WHERE id=$1 AND class_id=$2', [int(req.params.id), cid(req)]);
  if (!before) throw new HttpError(404, 'Message not found.');
  if (before.hidden === v.hidden) return res.json({ ok: true }); // nothing changed, nothing to broadcast
  const m = await one('UPDATE messages SET hidden=$3 WHERE id=$1 AND class_id=$2 RETURNING id, user_id, text, created_at', [int(req.params.id), cid(req), v.hidden]);
  const u = m.user_id ? await one('SELECT display_name name, role FROM users WHERE id=$1', [m.user_id]) : null;
  Object.assign(m, { name: u?.name ?? 'Someone', role: u?.role ?? 'student' });
  if (v.hidden) hub.toClass(cid(req), 'chatHidden', { id: int(req.params.id) });
  else hub.toClass(cid(req), 'chat', { id: Number(m.id), userId: m.user_id, name: m.name, role: m.role, text: m.text, at: new Date(m.created_at).toISOString() });
  await logActivity(req.user!.id, cid(req), v.hidden ? 'chat_message_hidden' : 'chat_message_restored', { id: int(req.params.id) });
  res.json({ ok: true });
}));

teacherRouter.get('/cosmetics', h(async (_req, res) => { res.json(COSMETICS); }));
