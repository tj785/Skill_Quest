import { Router } from 'express';
import { z } from 'zod';
import { h, int } from '../http.js';
import { q, one } from '../db.js';
import { requireRole } from '../auth.js';
import { publicQuestion, submitAnswer, weakTopics } from '../services/questions.js';
import { inventoryOf } from '../services/rewards.js';
import { buildingsOf } from '../services/world.js';
import { criterionValue } from '../services/achievements.js';
import { pool } from '../db.js';
import { levelProgress, titleForLevel, plotBounds, REGIONS } from '@cq/shared';
import { periodKey, QuestRepeat, CHAT_PRESETS, STRUCTURE_BY_KEY, COSMETIC_BY_KEY } from '@cq/shared';
import { shopFor, buyItem, equipItem, studentLook } from '../services/shop.js';
import { hub } from '../services/hub.js';
import { tx } from '../db.js';
import { pendingCounts } from '../services/world.js';

export const studentRouter = Router();
studentRouter.use(requireRole('student'));

/** Everything the student profile / HUD needs, in one call. */
export async function studentProfile(studentId: number) {
  const s = await one(`SELECT s.*, u.username, u.display_name, c.name class_name, c.world_id, c.build_mode, c.unlock_all_regions, c.adaptive_enabled
    FROM students s JOIN users u ON u.id=s.user_id JOIN classes c ON c.id=s.class_id WHERE s.user_id=$1`, [studentId]);
  if (!s) return undefined;
  const skills = await q(`SELECT sk.id, sk.name, coalesce(ss.points,0) points FROM skills sk
    LEFT JOIN student_skills ss ON ss.skill_id=sk.id AND ss.student_id=$1 WHERE sk.class_id=$2 ORDER BY sk.id`, [studentId, s.class_id]);
  const ach = await q(`SELECT a.*, sa.earned_at FROM achievements a
    LEFT JOIN student_achievements sa ON sa.achievement_id=a.id AND sa.student_id=$1 WHERE a.class_id=$2 ORDER BY sa.earned_at NULLS LAST, a.id`, [studentId, s.class_id]);
  const c = await pool.connect();
  let achievements: any[];
  try {
    achievements = [];
    for (const a of ach) achievements.push({
      id: a.id, name: a.name, description: a.description, earned: !!a.earned_at, earnedAt: a.earned_at,
      progress: a.earned_at ? a.threshold : Math.min(a.threshold, a.criteria_type === 'manual' ? 0 : await criterionValue(c, studentId, a.criteria_type, a.criteria_subject)),
      threshold: a.threshold
    });
  } finally { c.release(); }
  const stats = await one(`SELECT count(*) attempts, count(*) FILTER (WHERE correct) correct, count(*) FILTER (WHERE rewarded) solved FROM student_answers WHERE student_id=$1`, [studentId]);
  const buildings = await buildingsOf(s.world_id, studentId);
  const lp = levelProgress(s.xp);
  return {
    id: studentId, username: s.username, displayName: s.display_name, className: s.class_name, avatarColor: s.avatar_color,
    ...lp, title: titleForLevel(lp.level), coins: s.coins, blocksPlaced: s.blocks_placed,
    skills, achievements, inventory: await inventoryOf(undefined, studentId),
    buildings: buildings.map((b, i) => ({ name: `Build #${i + 1}`, blocks: b.blocks, x: b.x, y: b.y, z: b.z })),
    stats: { attempts: Number(stats.attempts), correct: Number(stats.correct), solved: Number(stats.solved) },
    plot: plotBounds(s.plot_index), buildMode: s.build_mode, canBuild: s.can_build, frozen: s.frozen, muted: s.muted, look: await studentLook(studentId),
    regions: Object.values(REGIONS).map((r) => ({ key: r.key, name: r.name, minLevel: r.minLevel, unlocked: s.unlock_all_regions || lp.level >= r.minLevel }))
  };
}

studentRouter.get('/me', h(async (req, res) => {
  res.json(await studentProfile(req.user!.id));
}));

studentRouter.get('/questions', h(async (req, res) => {
  const sid = req.user!.id;
  const cls = await one('SELECT adaptive_enabled FROM classes WHERE id=$1', [req.user!.classId]);
  const rows = await q(`SELECT qu.*, coalesce(st.attempts,0) attempts, coalesce(st.earned,false) earned
    FROM questions qu LEFT JOIN (SELECT question_id, count(*) attempts, bool_or(rewarded) earned FROM student_answers WHERE student_id=$1 GROUP BY 1) st ON st.question_id=qu.id
    WHERE qu.class_id=$2 AND qu.active ORDER BY qu.subject, qu.difficulty, qu.id`, [sid, req.user!.classId]);
  const answers = await q('SELECT question_id, text, match_text FROM question_answers WHERE question_id = ANY($1) ORDER BY sort, id', [rows.map((r) => r.id)]);
  const weak = cls?.adaptive_enabled ? await weakTopics(sid) : [];
  const weakSet = new Set(weak.map((w) => `${w.subject}|${w.topic}`));
  const questions = rows.map((r) => ({
    ...publicQuestion({ ...r, answers: answers.filter((a) => a.question_id === r.id) }),
    attempts: Number(r.attempts), earned: r.earned,
    recommended: !r.earned && weakSet.has(`${r.subject}|${r.topic ?? r.subject}`)
  }));
  const assignments = await q(`SELECT a.id, a.title, a.description, a.xp_reward, a.block_id, a.block_qty, a.coin_reward, a.due_date,
      (SELECT count(*) FROM assignment_questions aq JOIN questions qu ON qu.id=aq.question_id WHERE aq.assignment_id=a.id AND qu.active) total,
      (SELECT count(*) FROM assignment_questions aq JOIN student_answers sa ON sa.question_id=aq.question_id AND sa.student_id=$2 AND sa.rewarded WHERE aq.assignment_id=a.id) done,
      EXISTS (SELECT 1 FROM student_assignments x WHERE x.assignment_id=a.id AND x.student_id=$2) completed,
      (SELECT array_agg(question_id) FROM assignment_questions WHERE assignment_id=a.id) question_ids
    FROM assignments a WHERE a.class_id=$1 AND (a.target='class' OR EXISTS (SELECT 1 FROM assignment_students s WHERE s.assignment_id=a.id AND s.student_id=$2))
    ORDER BY a.id DESC`, [req.user!.classId, sid]);
  res.json({ questions, assignments, recommendations: weak.map((w) => ({ subject: w.subject, topic: w.topic, accuracy: Number(w.accuracy), text: `${w.topic} practice` })) });
}));

const Answer = z.object({ answer: z.union([z.string(), z.number()]).transform(String), timeSpentMs: z.number().int().min(0).max(3_600_000).optional() });

studentRouter.post('/questions/:id/answer', h(async (req, res) => {
  const v = Answer.parse(req.body);
  res.json(await submitAnswer(req.user!.id, req.user!.classId!, int(req.params.id), v.answer, v.timeSpentMs));
}));

studentRouter.get('/classmates', h(async (req, res) => {
  const rows = await q(`SELECT u.id, u.display_name, s.level, s.avatar_color, s.plot_index FROM students s JOIN users u ON u.id=s.user_id
    WHERE s.class_id=$1 AND NOT u.disabled ORDER BY u.display_name`, [req.user!.classId]);
  res.json(rows.map((r) => ({ id: r.id, name: r.display_name, level: r.level, color: r.avatar_color, plot: plotBounds(r.plot_index) })));
}));

/* ---------------- quests, challenges and events ---------------- */

export async function questsFor(studentId: number, classId: number) {
  const cls = await one('SELECT timezone FROM classes WHERE id=$1', [classId]);
  const quests = await q('SELECT * FROM quests WHERE class_id=$1 AND active ORDER BY repeat DESC, id', [classId]);
  const steps = await q('SELECT * FROM quest_steps WHERE quest_id = ANY($1) ORDER BY quest_id, sort, id', [quests.map((x) => x.id)]);
  const out = [];
  for (const qu of quests) {
    const period = periodKey(qu.repeat as QuestRepeat, cls.timezone);
    const sq = await one('SELECT * FROM student_quests WHERE student_id=$1 AND quest_id=$2 AND period=$3', [studentId, qu.id, period]);
    const qs = steps.filter((s) => s.quest_id === qu.id);
    out.push({
      id: qu.id, title: qu.title, description: qu.description, repeat: qu.repeat,
      reward: { xp: qu.xp_reward, coins: qu.coin_reward, block_id: qu.block_id, block_qty: qu.block_qty, item: qu.item_key ? COSMETIC_BY_KEY[qu.item_key]?.name : null },
      completed: !!sq?.completed_at, stepIndex: sq?.step_index ?? 0, stepProgress: sq?.step_progress ?? 0,
      steps: qs.map((s) => ({ description: s.description, amount: s.kind === 'visit_region' ? 1 : s.amount, kind: s.kind }))
    });
  }
  const events = await q(`SELECT e.*, coalesce(ec.points,0) mine FROM events e LEFT JOIN event_contributions ec ON ec.event_id=e.id AND ec.student_id=$2
    WHERE e.class_id=$1 AND e.starts_at <= now() AND (e.completed_at IS NULL OR e.completed_at > now() - interval '3 days') AND (e.ends_at IS NULL OR e.ends_at > now() OR e.completed_at IS NOT NULL)
    ORDER BY e.completed_at NULLS FIRST, e.id DESC`, [classId, studentId]);
  return {
    quests: out,
    events: events.map((e) => ({ id: e.id, title: e.title, description: e.description, goal: e.goal_amount, progress: Math.min(e.progress, e.goal_amount), mine: Number(e.mine),
      completed: !!e.completed_at, endsAt: e.ends_at, unlock: e.unlock_structure ? STRUCTURE_BY_KEY[e.unlock_structure]?.name : null,
      reward: { xp: e.reward_xp, coins: e.reward_coins, item: e.reward_item ? COSMETIC_BY_KEY[e.reward_item]?.name : null } }))
  };
}

studentRouter.get('/quests', h(async (req, res) => { res.json(await questsFor(req.user!.id, req.user!.classId!)); }));

studentRouter.get('/shop', h(async (req, res) => { res.json(await shopFor(req.user!.id)); }));
studentRouter.post('/shop/:key/buy', h(async (req, res) => {
  const r = await buyItem(req.user!.id, String(req.params.key));
  hub.updateLook(req.user!.id);
  const s = await one('SELECT xp, level, coins FROM students WHERE user_id=$1', [req.user!.id]);
  hub.toUser(req.user!.id, 'progress', { xp: s.xp, level: s.level, coins: s.coins });
  res.json(r);
}));
studentRouter.post('/shop/:key/equip', h(async (req, res) => {
  const on = z.object({ on: z.boolean() }).parse(req.body).on;
  await equipItem(req.user!.id, String(req.params.key), on);
  hub.updateLook(req.user!.id);
  res.json({ ok: true });
}));

studentRouter.get('/chat', h(async (req, res) => {
  const cls = await one('SELECT chat_mode FROM classes WHERE id=$1', [req.user!.classId]);
  const me = await one('SELECT muted FROM students WHERE user_id=$1', [req.user!.id]);
  const msgs = cls.chat_mode === 'off' ? [] : await q(`SELECT m.id, m.user_id, u.display_name name, u.role, m.text, m.created_at FROM messages m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.class_id=$1 AND NOT m.hidden ORDER BY m.id DESC LIMIT 40`, [req.user!.classId]);
  res.json({ mode: cls.chat_mode, muted: me.muted, presets: CHAT_PRESETS,
    messages: msgs.reverse().map((m) => ({ id: Number(m.id), userId: m.user_id, name: m.name ?? 'Someone', role: m.role, text: m.text, at: m.created_at })) });
}));

/* ---------------- teacher-approval building ---------------- */
studentRouter.get('/submissions', h(async (req, res) => {
  const cls = await one('SELECT world_id, build_mode FROM classes WHERE id=$1', [req.user!.classId]);
  const pending = (await pendingCounts(cls.world_id)).find((p) => p.placed_by === req.user!.id)?.n ?? 0;
  const list = await q('SELECT id, note, status, feedback, blocks, created_at, reviewed_at FROM build_submissions WHERE student_id=$1 ORDER BY id DESC LIMIT 10', [req.user!.id]);
  res.json({ buildMode: cls.build_mode, pendingBlocks: pending, submissions: list });
}));
studentRouter.post('/submissions', h(async (req, res) => {
  const note = z.object({ note: z.string().trim().max(300).optional() }).parse(req.body).note ?? null;
  const cls = await one('SELECT world_id, build_mode FROM classes WHERE id=$1', [req.user!.classId]);
  const pending = (await pendingCounts(cls.world_id)).find((p) => p.placed_by === req.user!.id)?.n ?? 0;
  if (!pending) return res.status(400).json({ error: 'Build something in your plot first. Your new blocks will be sent to your teacher.' });
  const open = await one(`SELECT id FROM build_submissions WHERE student_id=$1 AND status='pending'`, [req.user!.id]);
  if (open) await q('UPDATE build_submissions SET note=coalesce($2, note), blocks=$3, created_at=now() WHERE id=$1', [open.id, note, pending]);
  else await tx((c) => c.query('INSERT INTO build_submissions (class_id, student_id, note, blocks) VALUES ($1,$2,$3,$4)', [req.user!.classId, req.user!.id, note, pending]));
  res.json({ ok: true, blocks: pending });
}));
