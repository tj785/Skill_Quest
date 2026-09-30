import type { PoolClient } from 'pg';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { normalizeAnswer, difficultyDef, defaultBlockId, isRewardable, QUESTION_TYPES } from '@cq/shared';
import { grantReward, inventoryOf, RewardResult, checkAchievements } from './rewards.js';
import { hub } from './hub.js';
import { recordGameEvent, Notice, EventDone, finishEvent } from './progress.js';
import { invalidateWorld } from './world.js';

export const QuestionInput = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().trim().min(1, 'Write the question.').max(2000),
  explanation: z.string().trim().max(2000).optional().nullable(),
  subject: z.string().trim().min(1, 'Choose a subject.').max(60),
  topic: z.string().trim().max(80).optional().nullable(),
  grade_level: z.string().trim().max(20).optional().nullable(),
  difficulty: z.coerce.number().int().min(1).max(5),
  xp_reward: z.coerce.number().int().min(0).max(100000).optional(),
  skill_id: z.coerce.number().int().optional().nullable(),
  skill_amount: z.coerce.number().int().min(0).max(1000).optional(),
  block_id: z.coerce.number().int().optional().nullable(),
  block_qty: z.coerce.number().int().min(0).max(1000).optional(),
  coin_reward: z.coerce.number().int().min(0).max(100000).optional(),
  numeric_tolerance: z.coerce.number().min(0).optional(),
  time_limit_sec: z.coerce.number().int().min(0).max(3600).optional().nullable(),
  active: z.boolean().optional(),
  /** For multiple choice / true-false: the options. For short answer / numeric: accepted answers. */
  /** matching: each answer is one pair, `text` = left side, `match_text` = right side. */
  answers: z.array(z.object({ text: z.string().trim().min(1).max(500), is_correct: z.boolean(), match_text: z.string().trim().max(500).optional().nullable() })).min(1, 'Add at least one answer.')
}).superRefine((v, ctx) => {
  if (!v.answers.some((a) => a.is_correct)) ctx.addIssue({ code: 'custom', message: 'Mark at least one answer as correct.' });
  if (v.type === 'multiple_choice' && v.answers.length < 2) ctx.addIssue({ code: 'custom', message: 'Multiple choice needs at least two options.' });
  if (v.type === 'numeric' && v.answers.some((a) => a.is_correct && Number.isNaN(Number(a.text)))) ctx.addIssue({ code: 'custom', message: 'Numeric answers must be numbers.' });
  if (v.type === 'matching' && (v.answers.length < 2 || v.answers.some((a) => !a.match_text))) ctx.addIssue({ code: 'custom', message: 'Matching needs at least two complete pairs.' });
  if (v.type === 'matching' && new Set(v.answers.map((a) => normalizeAnswer(a.text))).size !== v.answers.length) ctx.addIssue({ code: 'custom', message: 'Each left-side item in a matching question must be different.' });
  if (v.type === 'matching' && new Set(v.answers.map((a) => normalizeAnswer(a.match_text ?? ''))).size !== v.answers.length) ctx.addIssue({ code: 'custom', message: 'Each match on the right side must be different.' });
  if (v.type === 'matching' && v.answers.some((a) => a.text.includes('=') || a.text.includes('|') || (a.match_text ?? '').includes('|'))) ctx.addIssue({ code: 'custom', message: 'Matching pairs cannot use the characters = (on the left) or | (anywhere).' });
  if (v.block_id && !isRewardable(v.block_id)) ctx.addIssue({ code: 'custom', message: 'That block cannot be given as a reward.' });
});
export type QuestionInputT = z.infer<typeof QuestionInput>;

/** Fill any reward fields the teacher left blank from the difficulty preset. */
export function withDefaults(v: QuestionInputT) {
  const d = difficultyDef(v.difficulty);
  return {
    ...v,
    xp_reward: v.xp_reward ?? d.xp,
    skill_amount: v.skill_amount ?? d.skill,
    coin_reward: v.coin_reward ?? d.coins,
    block_id: v.block_id === undefined ? defaultBlockId(v.difficulty) : v.block_id,
    block_qty: v.block_qty ?? d.quantity,
    numeric_tolerance: v.numeric_tolerance ?? 0,
    active: v.active ?? true
  };
}

export async function saveQuestion(c: PoolClient, classId: number, authorId: number, input: QuestionInputT, id?: number) {
  const v = withDefaults(input);
  if (v.skill_id) {
    const sk = await one('SELECT 1 FROM skills WHERE id=$1 AND class_id=$2', [v.skill_id, classId], c);
    if (!sk) throw Object.assign(new Error('That skill does not belong to this class.'), { status: 400 });
  }
  const cols = [v.type, v.prompt, v.explanation ?? null, v.subject, v.topic ?? null, v.grade_level ?? null, v.difficulty, v.xp_reward,
    v.skill_id ?? null, v.skill_amount, v.block_id ?? null, v.block_qty, v.coin_reward, v.numeric_tolerance, v.time_limit_sec || null, v.active];
  let qid = id;
  if (id) {
    const r = await q(`UPDATE questions SET type=$1, prompt=$2, explanation=$3, subject=$4, topic=$5, grade_level=$6, difficulty=$7, xp_reward=$8,
      skill_id=$9, skill_amount=$10, block_id=$11, block_qty=$12, coin_reward=$13, numeric_tolerance=$14, time_limit_sec=$15, active=$16, updated_at=now()
      WHERE id=$17 AND class_id=$18 RETURNING id`, [...cols, id, classId], c);
    if (!r.length) throw Object.assign(new Error('Question not found.'), { status: 404 });
    await q('DELETE FROM question_answers WHERE question_id=$1', [id], c);
  } else {
    const r = await one<{ id: number }>(`INSERT INTO questions (type, prompt, explanation, subject, topic, grade_level, difficulty, xp_reward, skill_id, skill_amount,
      block_id, block_qty, coin_reward, numeric_tolerance, time_limit_sec, active, class_id, author_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`, [...cols, classId, authorId], c);
    qid = r!.id;
  }
  const answers = v.type === 'true_false' && v.answers.length < 2
    ? [{ text: 'True', is_correct: normalizeAnswer(v.answers[0].text) === 'true' }, { text: 'False', is_correct: normalizeAnswer(v.answers[0].text) !== 'true' }]
    : v.answers;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i] as { text: string; is_correct: boolean; match_text?: string | null };
    await q('INSERT INTO question_answers (question_id, text, is_correct, sort, match_text) VALUES ($1,$2,$3,$4,$5)', [qid, a.text, v.type === 'matching' ? true : a.is_correct, i, v.type === 'matching' ? a.match_text ?? null : null], c);
  }
  return qid!;
}

export async function questionWithAnswers(id: number, c?: PoolClient) {
  const qu = await one('SELECT * FROM questions WHERE id=$1', [id], c);
  if (!qu) return undefined;
  qu.answers = await q('SELECT id, text, is_correct, match_text FROM question_answers WHERE question_id=$1 ORDER BY sort, id', [id], c);
  return qu;
}

export function isCorrect(qu: { type: string; numeric_tolerance: number }, answers: { text: string; is_correct: boolean; match_text?: string | null }[], given: string): boolean {
  const correct = answers.filter((a) => a.is_correct);
  if (qu.type === 'matching') {
    let map: Record<string, string>;
    try { map = JSON.parse(given); } catch { return false; }
    if (!map || typeof map !== 'object') return false;
    const got = new Map(Object.entries(map).map(([k, v]) => [normalizeAnswer(String(k)), normalizeAnswer(String(v))]));
    return answers.length > 0 && answers.every((a) => got.get(normalizeAnswer(a.text)) === normalizeAnswer(a.match_text ?? ''));
  }
  if (qu.type === 'numeric') {
    const t = String(given).replace(/[,\s]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return false; // plain decimals only (no 0x.., 1e3)
    const n = Number(t);
    return correct.some((a) => Math.abs(Number(a.text) - n) <= (qu.numeric_tolerance || 0) + 1e-9);
  }
  const g = normalizeAnswer(given);
  return correct.some((a) => normalizeAnswer(a.text) === g);
}

/** Student-facing view: options without the correct flags. */
/** Number of correct pairs in a matching answer (null if the answer isn't a valid map). */
function matchingScore(answers: { text: string; match_text?: string | null }[], given: string): number | null {
  let map: Record<string, string>;
  try { map = JSON.parse(given); } catch { return null; }
  if (!map || typeof map !== 'object') return null;
  const got = new Map(Object.entries(map).map(([k, v]) => [normalizeAnswer(String(k)), normalizeAnswer(String(v))]));
  return answers.filter((a) => got.get(normalizeAnswer(a.text)) === normalizeAnswer(a.match_text ?? '')).length;
}

/** Deterministic shuffle so a matching question's right column is mixed up but stable between visits. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const a = [...arr]; let s = seed * 9301 + 49297;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a.every((x, i) => x === arr[i])) a.push(a.shift()!);
  return a;
}

export function publicQuestion(qu: any) {
  const showOptions = qu.type === 'multiple_choice' || qu.type === 'true_false';
  const matching = qu.type === 'matching';
  return {
    id: qu.id, type: qu.type, prompt: qu.prompt, subject: qu.subject, topic: qu.topic, difficulty: qu.difficulty,
    difficultyName: difficultyDef(qu.difficulty).name, time_limit_sec: qu.time_limit_sec,
    reward: { xp: qu.xp_reward, coins: qu.coin_reward, skill_id: qu.skill_id, skill_amount: qu.skill_amount, block_id: qu.block_id, block_qty: qu.block_qty },
    options: showOptions ? qu.answers.map((a: any) => a.text) : undefined,
    left: matching ? qu.answers.map((a: any) => a.text) : undefined,
    right: matching ? shuffled(qu.answers.map((a: any) => a.match_text), qu.id) : undefined
  };
}

export interface AnswerResult {
  correct: boolean;
  alreadyEarned: boolean;
  attempts: number;
  explanation?: string | null;
  reward?: RewardResult;
  assignmentsCompleted: { title: string; reward: RewardResult }[];
  /** Quest / challenge / event updates caused by this answer. */
  notices: Notice[];
  message: string;
  /** Just the list of gains ("+25 XP, +5 Wood Planks"), for reward cards that show their own heading. */
  gains?: string;
}

export async function submitAnswer(studentId: number, classId: number, questionId: number, given: string, timeSpentMs?: number): Promise<AnswerResult> {
  const result = await tx(async (c) => {
    const qu = await questionWithAnswers(questionId, c);
    if (!qu || qu.class_id !== classId || !qu.active) throw Object.assign(new Error('That question is not available.'), { status: 404 });
    // Serialize concurrent submissions from the same student.
    await q('SELECT 1 FROM students WHERE user_id=$1 FOR UPDATE', [studentId], c);
    const prev = await one<{ n: string; earned: boolean }>('SELECT count(*) n, bool_or(rewarded) earned FROM student_answers WHERE student_id=$1 AND question_id=$2', [studentId, questionId], c);
    const attempt = Number(prev!.n) + 1;
    const already = !!prev!.earned;
    const correct = isCorrect(qu, qu.answers, given);
    const reward = correct && !already;
    await q('INSERT INTO student_answers (student_id, question_id, answer_text, correct, attempt_no, time_spent_ms, rewarded) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [studentId, questionId, String(given).slice(0, 500), correct, attempt, timeSpentMs ?? null, reward], c);
    let rr: RewardResult | undefined;
    const assignmentsCompleted: AnswerResult['assignmentsCompleted'] = [];
    const notices: Notice[] = [];
    let eventDone: EventDone | undefined;
    if (reward) {
      rr = await grantReward(c, studentId, { xp: qu.xp_reward, coins: qu.coin_reward, skillId: qu.skill_id, skillAmount: qu.skill_amount, blockId: qu.block_id, blockQty: qu.block_qty }, `question:${qu.id}`);
      assignmentsCompleted.push(...(await completeAssignments(c, studentId, classId, questionId)));
      const pr = await recordGameEvent(c, studentId, classId, { type: 'answer_correct', subject: qu.subject, topic: qu.topic, difficulty: qu.difficulty });
      notices.push(...pr.notices);
      if (pr.eventCompleted) eventDone = pr.eventCompleted;
      for (let i = 0; i < assignmentsCompleted.length; i++) {
        const pa = await recordGameEvent(c, studentId, classId, { type: 'assignment_completed' });
        notices.push(...pa.notices);
      }
    } else if (!correct) {
      // Trying again is encouraged: answering wrong never removes anything, but still counts for "first steps".
      const got = await checkAchievements(c, studentId, classId);
      for (const a of got) notices.push({ kind: 'reward', text: `Achievement unlocked: ${a.name}${a.xp ? ` (+${a.xp} XP)` : ''}` });
    }
    let message = correct
      ? already ? 'Correct again. You already earned the reward for this one.' : rewardMessage(qu.difficulty, rr!)
      : 'Not quite. Take another look and try again.';
    if (!correct && qu.type === 'matching') {
      const right = matchingScore(qu.answers, given);
      if (right !== null) message = `${right} of ${qu.answers.length} pairs are right. Look again at the others.`;
    }
    return { correct, alreadyEarned: already, attempts: attempt, explanation: correct ? qu.explanation : null, reward: rr, assignmentsCompleted, notices, eventDone, message, gains: rr ? gainsText(rr) : undefined };
  });
  if (result.reward || result.notices.length) {
    const s = await one('SELECT xp, level, coins FROM students WHERE user_id=$1', [studentId]);
    hub.toUser(studentId, 'progress', { xp: s.xp, level: s.level, coins: s.coins });
    hub.toUser(studentId, 'inventory', { items: await inventoryOf(undefined, studentId) });
    if (result.notices.length) hub.toUser(studentId, 'questUpdate', {});
  }
  await announceEvent(result.eventDone);
  const { eventDone: _e, ...rest } = result;
  return rest;
}

function gainsText(r: RewardResult): string {
  const parts = [`+${r.gained.xp} XP`];
  if (r.gained.skill) parts.push(`+${r.gained.skill.amount} ${r.gained.skill.name}`);
  if (r.gained.block) parts.push(`+${r.gained.block.qty} ${r.gained.block.name}`);
  if (r.gained.coins) parts.push(`+${r.gained.coins} coins`);
  return parts.join(', ') + '.';
}
function rewardMessage(difficulty: number, r: RewardResult): string {
  const head = difficulty >= 5 ? 'MASTER QUESTION COMPLETE!' : difficulty >= 4 ? 'Advanced question complete!' : 'Correct!';
  return `${head} ${gainsText(r)}`;
}

/** Award any assignment whose questions are now all answered correctly. */
async function completeAssignments(c: PoolClient, studentId: number, classId: number, questionId: number) {
  const out: { title: string; reward: RewardResult }[] = [];
  const candidates = await q(`SELECT a.* FROM assignments a JOIN assignment_questions aq ON aq.assignment_id=a.id
     WHERE aq.question_id=$1 AND a.class_id=$2
       AND (a.target='class' OR EXISTS (SELECT 1 FROM assignment_students s WHERE s.assignment_id=a.id AND s.student_id=$3))
       AND NOT EXISTS (SELECT 1 FROM student_assignments sa WHERE sa.assignment_id=a.id AND sa.student_id=$3)`, [questionId, classId, studentId], c);
  for (const a of candidates) {
    const left = await one<{ n: string }>(`SELECT count(*) n FROM assignment_questions aq JOIN questions qu ON qu.id=aq.question_id
       WHERE aq.assignment_id=$1 AND qu.active AND NOT EXISTS (SELECT 1 FROM student_answers sa WHERE sa.question_id=aq.question_id AND sa.student_id=$2 AND sa.rewarded)`, [a.id, studentId], c);
    if (Number(left!.n) > 0) continue;
    await q('INSERT INTO student_assignments (assignment_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, studentId], c);
    const reward = await grantReward(c, studentId, { xp: a.xp_reward, coins: a.coin_reward, blockId: a.block_id, blockQty: a.block_qty }, `assignment:${a.id}`);
    out.push({ title: a.title, reward });
  }
  return out;
}

/** Topics where a student is struggling: at least 3 attempts and under 60% accuracy. */
export async function weakTopics(studentId: number) {
  return q(`SELECT qu.subject, coalesce(qu.topic, qu.subject) topic, count(*) attempts,
      round(100.0 * sum(CASE WHEN a.correct THEN 1 ELSE 0 END) / count(*)) accuracy
    FROM student_answers a JOIN questions qu ON qu.id=a.question_id
    WHERE a.student_id=$1 GROUP BY 1,2 HAVING count(*) >= 3 AND 100.0 * sum(CASE WHEN a.correct THEN 1 ELSE 0 END) / count(*) < 60
    ORDER BY accuracy ASC`, [studentId]);
}

/** When a class goal is reached: complete the event (outside the answer transaction), reload the world for everyone and tell them. */
export async function announceEvent(e?: EventDone) {
  if (!e) return;
  const done = await finishEvent(e.eventId);
  if (!done) return;
  invalidateWorld(done.worldId);
  hub.resetWorld(done.worldId);
  hub.toClass(done.classId, 'toast', { kind: 'reward', text: `Class goal reached: ${done.title}! Everyone who helped earned a reward.` });
  for (const h of done.helpers) {
    const parts = [h.xp ? `+${h.xp} XP` : '', h.coins ? `+${h.coins} coins` : '', h.item ? `${h.item} (wear it from the Shop, B)` : ''].filter(Boolean);
    if (parts.length) hub.toUser(h.id, 'toast', { kind: 'reward', text: `Thanks for helping with ${done.title}: ${parts.join(', ')}` });
    hub.toUser(h.id, 'progress', {});
  }
  hub.toClass(done.classId, 'questUpdate', {});
}
