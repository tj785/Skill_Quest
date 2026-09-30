/**
 * First-run setup: administrator account + optional demo data so a teacher can
 * see the platform working immediately.
 */
import crypto from 'node:crypto';
import { q, one, tx } from './db.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { createClass, addStudent } from './services/classes.js';
import { saveQuestion, submitAnswer } from './services/questions.js';
import { BLOCK_BY_KEY as B, CENTER, VILLAGE_Y, plotBounds, baseBlock } from '@cq/shared';
import { invalidateWorld } from './services/world.js';

export const DEMO = {
  teacher: { username: 'teacher', password: 'teacher123', name: 'Teacher Demo' },
  className: 'Grade 5 Adventure Class',
  seed: 20260927,
  students: [
    { username: 'alex', name: 'Alex' }, { username: 'jordan', name: 'Jordan' },
    { username: 'sam', name: 'Sam' }, { username: 'taylor', name: 'Taylor' }
  ],
  studentPassword: 'quest123'
};

export async function ensureAdmin() {
  if (await one("SELECT 1 FROM users WHERE role='admin'")) return;
  let pw = config.adminPassword;
  if (!pw) {
    pw = crypto.randomBytes(9).toString('base64url');
    console.log(`\n[setup] Created administrator "${config.adminUsername}" with temporary password: ${pw}\n        Set ADMIN_PASSWORD in .env to choose your own.\n`);
  }
  await q(`INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,'Administrator','admin') ON CONFLICT DO NOTHING`, [config.adminUsername, await hashPassword(pw)]);
}

type Q = Parameters<typeof saveQuestion>[3];
const mc = (prompt: string, subject: string, topic: string, difficulty: number, options: string[], correct: number, explanation?: string): Q =>
  ({ type: 'multiple_choice', prompt, subject, topic, grade_level: '5', difficulty, explanation, answers: options.map((t, i) => ({ text: t, is_correct: i === correct })) });
const num = (prompt: string, subject: string, topic: string, difficulty: number, answer: number, explanation?: string): Q =>
  ({ type: 'numeric', prompt, subject, topic, grade_level: '5', difficulty, explanation, answers: [{ text: String(answer), is_correct: true }] });
const tf = (prompt: string, subject: string, topic: string, difficulty: number, answer: boolean): Q =>
  ({ type: 'true_false', prompt, subject, topic, grade_level: '5', difficulty, answers: [{ text: 'True', is_correct: answer }, { text: 'False', is_correct: !answer }] });
const sa = (prompt: string, subject: string, topic: string, difficulty: number, answers: string[]): Q =>
  ({ type: 'short_answer', prompt, subject, topic, grade_level: '5', difficulty, answers: answers.map((t) => ({ text: t, is_correct: true })) });

export const DEMO_QUESTIONS: (Q & { skill: string })[] = [
  { ...num('What is 12 × 8?', 'Math', 'Multiplication', 1, 96), skill: 'Mathematics' },
  { ...num('What is 7 × 8?', 'Math', 'Multiplication', 1, 56), skill: 'Mathematics' },
  { ...num('What is 9 × 6?', 'Math', 'Multiplication', 1, 54), skill: 'Mathematics' },
  { ...mc('What is 3/4 + 1/8?', 'Math', 'Fractions', 3, ['4/12', '7/8', '1/2', '5/8'], 1, '3/4 is 6/8, and 6/8 + 1/8 = 7/8.'), skill: 'Mathematics' },
  { ...mc('Which fraction is equal to 2/3?', 'Math', 'Fractions', 2, ['4/6', '3/4', '2/6', '5/6'], 0), skill: 'Mathematics' },
  { ...mc('What is 1/2 of 3/5?', 'Math', 'Fractions', 3, ['3/10', '4/7', '1/5', '6/5'], 0), skill: 'Mathematics' },
  { ...num('A rectangle is 7 cm long and 4 cm wide. What is its area in square cm?', 'Math', 'Geometry', 2, 28), skill: 'Mathematics' },
  { ...num('What is the volume of a cube with 3 cm sides (in cubic cm)?', 'Math', 'Geometry', 3, 27), skill: 'Mathematics' },
  { ...mc('A word that means the opposite of another word is called a…', 'Reading', 'Vocabulary', 1, ['Synonym', 'Antonym', 'Homophone', 'Noun'], 1), skill: 'Reading' },
  { ...sa('What is the main character of a story usually called? (one word)', 'Reading', 'Story Elements', 2, ['protagonist']), skill: 'Reading' },
  { ...mc('"The wind whispered through the trees" is an example of…', 'Reading', 'Figurative Language', 3, ['Simile', 'Personification', 'Hyperbole', 'Alliteration'], 1), skill: 'Reading' },
  { ...tf('Plants make their own food using sunlight. True or false?', 'Science', 'Plants', 1, true), skill: 'Science' },
  { ...mc('What gas do plants take in from the air?', 'Science', 'Plants', 2, ['Oxygen', 'Carbon dioxide', 'Helium', 'Nitrogen'], 1), skill: 'Science' },
  { ...mc('Which planet is closest to the Sun?', 'Science', 'Space', 1, ['Venus', 'Earth', 'Mercury', 'Mars'], 2), skill: 'Science' },
  { ...mc('Water turning into water vapor is called…', 'Science', 'Matter', 3, ['Condensation', 'Evaporation', 'Freezing', 'Melting'], 1), skill: 'Science' },
  { ...mc('Which sentence is written correctly?', 'Writing', 'Grammar', 2, ['their going to the park.', 'They\'re going to the park.', 'there going to the park.', 'Theyre going to the park.'], 1), skill: 'Writing' },
  { ...sa('What punctuation mark ends a question?', 'Writing', 'Punctuation', 1, ['question mark', '?']), skill: 'Writing' },
  { ...mc('In a program, a loop is used to…', 'Programming', 'Loops', 2, ['Repeat instructions', 'Delete files', 'Draw a picture once', 'Stop the computer'], 0), skill: 'Programming' },
  { ...num('A loop runs 4 times and adds 3 to a score that starts at 0. What is the score?', 'Programming', 'Loops', 3, 12), skill: 'Programming' },
  { type: 'matching', prompt: 'Match each planet to its description.', subject: 'Science', topic: 'Space', grade_level: '5', difficulty: 2,
    explanation: 'Mercury is closest to the Sun, Mars looks red because of rusty dust, Jupiter is the largest planet and Saturn has bright rings.',
    answers: [{ text: 'Mercury', match_text: 'Closest to the Sun', is_correct: true }, { text: 'Mars', match_text: 'The Red Planet', is_correct: true },
      { text: 'Jupiter', match_text: 'Largest planet', is_correct: true }, { text: 'Saturn', match_text: 'Famous for its rings', is_correct: true }], skill: 'Science' },
  { type: 'matching', prompt: 'Match each word to its synonym.', subject: 'Reading', topic: 'Vocabulary', grade_level: '5', difficulty: 2,
    answers: [{ text: 'Happy', match_text: 'Joyful', is_correct: true }, { text: 'Big', match_text: 'Enormous', is_correct: true }, { text: 'Quick', match_text: 'Rapid', is_correct: true }], skill: 'Reading' },
  { ...mc('A MASTER challenge: what is 15% of 240?', 'Math', 'Percents', 5, ['24', '36', '32', '40'], 1, '10% of 240 is 24, 5% is 12, so 15% is 36.'), skill: 'Problem Solving' }
];

/** A small house (planks, glass windows, bricks roof) built on a plot. */
function houseBlocks(p: { x0: number; z0: number }) {
  const out: { x: number; y: number; z: number; b: number }[] = [];
  const g = VILLAGE_Y + 1, x0 = p.x0 + 1, z0 = p.z0 + 1, w = 5, d = 5, hgt = 3;
  for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) for (let y = g; y < g + hgt; y++) {
    const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
    if (!edge) continue;
    const door = z === z0 + d - 1 && x === x0 + 2 && y < g + 2;
    if (door) continue;
    const window = y === g + 1 && (x === x0 + 1 || x === x0 + 3) && (z === z0 || z === z0 + d - 1);
    out.push({ x, y, z, b: window ? B.glass.id : B.planks.id });
  }
  for (let x = x0 - 1; x <= x0 + w; x++) for (let z = z0 - 1; z <= z0 + d; z++) out.push({ x, y: g + hgt, z, b: B.bricks.id });
  return out;
}
function towerBlocks(p: { x0: number; z0: number }) {
  const out: { x: number; y: number; z: number; b: number }[] = [];
  const g = VILLAGE_Y + 1, x0 = p.x0 + 2, z0 = p.z0 + 2;
  for (let y = g; y < g + 7; y++) for (let x = x0; x < x0 + 3; x++) for (let z = z0; z < z0 + 3; z++) {
    if (x === x0 + 1 && z === z0 + 1) continue;
    out.push({ x, y, z, b: y === g + 6 ? B.gold_block.id : B.stone_bricks.id });
  }
  return out;
}

export async function seedDemo(opts: { quiet?: boolean } = {}) {
  if (await one('SELECT 1 FROM users WHERE lower(username)=$1', [DEMO.teacher.username])) return false;
  const log = (s: string) => { if (!opts.quiet) console.log(s); };
  const ctx = await tx(async (c) => {
    const t = await one(`INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'teacher') RETURNING id`,
      [DEMO.teacher.username, await hashPassword(DEMO.teacher.password), DEMO.teacher.name], c);
    await c.query('INSERT INTO teachers (user_id, school) VALUES ($1,$2)', [t.id, 'Demo School']);
    const cls = await createClass(c, t.id, DEMO.className, '5', { seed: DEMO.seed });
    await c.query(`UPDATE classes SET join_code='DEMO5A' WHERE id=$1`, [cls.id]);
    const skills = new Map((await q('SELECT id, name FROM skills WHERE class_id=$1', [cls.id], c)).map((r) => [r.name, r.id]));
    const qids: number[] = [];
    for (const dq of DEMO_QUESTIONS) {
      const { skill, ...input } = dq;
      qids.push(await saveQuestion(c, cls.id, t.id, { ...input, skill_id: skills.get(skill) ?? null }));
    }
    const students: Record<string, number> = {};
    for (const s of DEMO.students) students[s.username] = await addStudent(c, cls.id, s.username, DEMO.studentPassword, s.name);
    // Fractions Challenge assignment.
    const fr = await one(`INSERT INTO assignments (class_id, title, description, xp_reward, block_id, block_qty, coin_reward)
      VALUES ($1,'Fractions Challenge','Answer all the fraction questions correctly.',500,$2,25,50) RETURNING id`, [cls.id, B.stone_bricks.id], c);
    for (let i = 0; i < DEMO_QUESTIONS.length; i++) if (DEMO_QUESTIONS[i].topic === 'Fractions') await c.query('INSERT INTO assignment_questions VALUES ($1,$2)', [fr.id, qids[i]]);
    // Class project zone.
    await c.query(`INSERT INTO project_zones (class_id, name, x0, z0, x1, z1, bonus_xp_per_block) VALUES ($1,'Build the Future City',$2,$3,$4,$5,2)`,
      [cls.id, CENTER + 24, CENTER + 24, CENTER + 33, CENTER + 33]);
    // Chat: students may send the pre-written phrases only (teacher can switch to free chat).
    await c.query(`UPDATE classes SET chat_mode='preset' WHERE id=$1`, [cls.id]);
    // A multi-step quest, a daily challenge and a weekly challenge.
    const quest = async (title: string, description: string, repeat: string, xp: number, coins: number, blockKey: string | null, qty: number, item: string | null, steps: [string, number, string | null, string | null, string][]) => {
      const qu = await one(`INSERT INTO quests (class_id, title, description, repeat, xp_reward, coin_reward, block_id, block_qty, item_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [cls.id, title, description, repeat, xp, coins, blockKey ? B[blockKey].id : null, qty, item], c);
      for (let i = 0; i < steps.length; i++) {
        const [kind, amount, subject, region, desc] = steps[i];
        await c.query('INSERT INTO quest_steps (quest_id, sort, kind, amount, subject, region, description) VALUES ($1,$2,$3,$4,$5,$6,$7)', [qu.id, i, kind, amount, subject, region, desc]);
      }
    };
    await quest('The Explorer\'s Journey', 'Prove you are ready to explore the world.', 'none', 150, 30, 'glass', 10, 'title_explorer', [
      ['correct_answers', 3, null, null, 'Answer 3 questions correctly'],
      ['visit_region', 1, null, 'forest', 'Travel to the Whispering Forest'],
      ['place_blocks', 5, null, null, 'Place 5 blocks anywhere you are allowed to build'],
      ['subject_correct', 2, 'Science', null, 'Answer 2 Science questions correctly']
    ]);
    await quest('Daily Brain Warm-up', 'A fresh challenge every day.', 'daily', 40, 10, 'planks', 5, null, [
      ['correct_answers', 3, null, null, 'Answer 3 questions correctly today']
    ]);
    await quest('Weekly Math Marathon', 'Keep your math skills sharp all week.', 'weekly', 120, 25, null, 0, null, [
      ['subject_correct', 5, 'Math', null, 'Answer 5 Math questions correctly this week']
    ]);
    // Special events: a class goal that builds a fountain, and a manual walk-a-thon style event.
    await c.query(`INSERT INTO events (class_id, title, description, goal_kind, goal_amount, reward_xp, reward_coins, reward_item, unlock_structure, structure_x, structure_z, ends_at)
      VALUES ($1,'Fountain of Knowledge','Answer 30 questions correctly as a class to build a fountain in the village!','correct_answers',30,100,20,'cape_event','fountain',$2,$3, now() + interval '14 days')`,
      [cls.id, CENTER - 12, CENTER + 10]);
    await c.query(`INSERT INTO events (class_id, title, description, goal_kind, goal_amount, reward_xp, reward_coins, unlock_structure, structure_x, structure_z)
      VALUES ($1,'Reading Week','Your teacher adds a point for every book the class finishes. Reach 10 to raise a statue!','manual',10,80,15,'statue',$2,$3)`,
      [cls.id, CENTER + 12, CENTER - 12]);
    await c.query(`INSERT INTO messages (class_id, user_id, text) VALUES ($1,$2,'Welcome to Character Quest! Say hi with the chat button.')`, [cls.id, t.id]);
    return { cls, qids, students, teacherId: t.id };
  });

  // Example history so the dashboard has data (goes through the real reward engine).
  const hist: [string, number, string][] = [
    ['jordan', 0, '96'], ['jordan', 1, '56'], ['jordan', 3, '5/8'], ['jordan', 3, '7/8'], ['jordan', 11, 'True'], ['jordan', 13, 'Mercury'], ['jordan', 17, 'Repeat instructions'],
    ['alex', 0, '96'], ['alex', 3, '4/12'], ['alex', 3, '1/2'], ['alex', 4, '3/4'], ['alex', 5, '4/7'], ['alex', 8, 'Antonym'], ['alex', 12, 'Carbon dioxide'],
    ['sam', 1, '54'], ['sam', 1, '56'], ['sam', 15, "They're going to the park."],
    ['taylor', 11, 'True']
  ];
  for (const [u, qi, ans] of hist) await submitAnswer(ctx.students[u], ctx.cls.id, ctx.qids[qi], ans, 20000);

  // Example buildings in Jordan's and Alex's plots.
  const worldId = ctx.cls.world_id;
  const place = async (studentId: number, blocks: { x: number; y: number; z: number; b: number }[]) => {
    for (const bl of blocks) {
      if (baseBlock(DEMO.seed, bl.x, bl.y, bl.z) === bl.b) continue;
      await q(`INSERT INTO world_blocks (world_id, x, y, z, block_id, placed_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [worldId, bl.x, bl.y, bl.z, bl.b, studentId]);
    }
    await q('UPDATE students SET blocks_placed = blocks_placed + $2, blocks_credited = blocks_credited + $2 WHERE user_id=$1', [studentId, blocks.length]);
  };
  const plotOf = async (id: number) => plotBounds((await one('SELECT plot_index FROM students WHERE user_id=$1', [id])).plot_index);
  await place(ctx.students.jordan, houseBlocks(await plotOf(ctx.students.jordan)));
  await place(ctx.students.alex, towerBlocks(await plotOf(ctx.students.alex)));
  invalidateWorld(worldId);
  log(`[setup] Demo data created: teacher "${DEMO.teacher.username}" / "${DEMO.teacher.password}", students alex, jordan, sam, taylor / "${DEMO.studentPassword}", class code DEMO5A`);
  return true;
}
