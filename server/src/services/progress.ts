/**
 * Quest, daily-challenge and special-event progress. Game actions call `recordGameEvent`
 * inside their own transaction; it advances quest steps and event goals and returns
 * notices for the player (sent after the transaction commits).
 */
import type { PoolClient } from 'pg';
import { q, one, tx } from '../db.js';
import { periodKey, QuestRepeat, STRUCTURE_BY_KEY, COSMETIC_BY_KEY, baseBlock, inWorld } from '@cq/shared';
import { grantReward, RewardResult } from './rewards.js';
import { logActivity } from './log.js';

export type GameEvent =
  | { type: 'answer_correct'; subject: string; topic: string | null; difficulty: number }
  | { type: 'block_placed'; inZone: boolean }
  | { type: 'region_visit'; region: string }
  | { type: 'assignment_completed' };

export interface Notice { kind: 'info' | 'reward'; text: string; }
export interface EventDone { eventId: number; classId: number; worldId: number; title: string; }
export interface ProgressResult { notices: Notice[]; rewards: RewardResult[]; eventCompleted?: EventDone; /** quest or event numbers moved (the HUD should refresh) */ changed: boolean; }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function stepMatches(step: any, ev: GameEvent): boolean {
  switch (step.kind) {
    case 'correct_answers': return ev.type === 'answer_correct';
    case 'subject_correct': return ev.type === 'answer_correct' && norm(ev.subject) === norm(step.subject);
    case 'topic_correct': return ev.type === 'answer_correct' && norm(ev.topic) === norm(step.topic);
    case 'hard_correct': return ev.type === 'answer_correct' && ev.difficulty >= 3;
    case 'place_blocks': return ev.type === 'block_placed';
    case 'place_in_zone': return ev.type === 'block_placed' && ev.inZone;
    case 'visit_region': return ev.type === 'region_visit' && norm(ev.region) === norm(step.region);
    case 'complete_assignment': return ev.type === 'assignment_completed';
    default: return false;
  }
}

export async function giveItem(c: PoolClient, studentId: number, itemKey: string | null | undefined): Promise<string | null> {
  if (!itemKey || !COSMETIC_BY_KEY[itemKey]) return null;
  const r = await q('INSERT INTO student_items (student_id, item_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING item_key', [studentId, itemKey], c);
  return r.length ? COSMETIC_BY_KEY[itemKey].name : null;
}

export async function recordGameEvent(c: PoolClient, studentId: number, classId: number, ev: GameEvent): Promise<ProgressResult> {
  const out: ProgressResult = { notices: [], rewards: [], changed: false };
  const cls = await one<{ timezone: string; world_id: number }>('SELECT timezone, world_id FROM classes WHERE id=$1', [classId], c);
  if (!cls) return out;

  /* ---- quests ---- */
  const quests = await q('SELECT * FROM quests WHERE class_id=$1 AND active ORDER BY id', [classId], c);
  if (quests.length) {
    const steps = await q('SELECT * FROM quest_steps WHERE quest_id = ANY($1) ORDER BY quest_id, sort, id', [quests.map((x) => x.id)], c);
    for (const quest of quests) {
      const qs = steps.filter((s) => s.quest_id === quest.id);
      if (!qs.length) continue;
      const period = periodKey(quest.repeat as QuestRepeat, cls.timezone);
      await q(`INSERT INTO student_quests (student_id, quest_id, period) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [studentId, quest.id, period], c);
      const sq = await one('SELECT * FROM student_quests WHERE student_id=$1 AND quest_id=$2 AND period=$3 FOR UPDATE', [studentId, quest.id, period], c);
      if (!sq || sq.completed_at) continue;
      const step = qs[sq.step_index];
      if (!step || !stepMatches(step, ev)) continue;
      out.changed = true;
      let progress = sq.step_progress + 1;
      let index = sq.step_index;
      const amount = step.kind === 'visit_region' ? 1 : step.amount;
      if (progress >= amount) {
        index++; progress = 0;
        if (index >= qs.length) {
          await q('UPDATE student_quests SET step_index=$4, step_progress=0, completed_at=now() WHERE student_id=$1 AND quest_id=$2 AND period=$3', [studentId, quest.id, period, index], c);
          const r = await grantReward(c, studentId, { xp: quest.xp_reward, coins: quest.coin_reward, blockId: quest.block_id, blockQty: quest.block_qty }, `quest:${quest.id}`);
          const item = await giveItem(c, studentId, quest.item_key);
          out.rewards.push(r);
          out.notices.push({ kind: 'reward', text: `${quest.repeat === 'daily' ? 'Daily challenge' : quest.repeat === 'weekly' ? 'Weekly challenge' : 'Quest'} complete: ${quest.title}! +${r.gained.xp} XP${r.gained.block ? `, ${r.gained.block.qty} ${r.gained.block.name}` : ''}${item ? `, ${item}` : ''}` });
          continue;
        }
        out.notices.push({ kind: 'info', text: `${quest.title}: step ${index} of ${qs.length} done. Next: ${qs[index].description}` });
      }
      await q('UPDATE student_quests SET step_index=$4, step_progress=$5 WHERE student_id=$1 AND quest_id=$2 AND period=$3', [studentId, quest.id, period, index, progress], c);
    }
  }

  /* ---- events ---- */
  const kind = ev.type === 'answer_correct' ? ['correct_answers', 'subject_correct'] : ev.type === 'block_placed' ? ['blocks_placed'] : [];
  if (kind.length) {
    const events = await q(`SELECT * FROM events WHERE class_id=$1 AND completed_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) AND goal_kind = ANY($2) FOR UPDATE`, [classId, kind], c);
    for (const e of events) {
      if (e.goal_kind === 'subject_correct' && !(ev.type === 'answer_correct' && norm(ev.subject) === norm(e.subject))) continue;
      const done = await addEventPoints(c, e, studentId, 1);
      out.changed = true;
      if (done) out.eventCompleted = { eventId: e.id, classId, worldId: cls.world_id, title: e.title };
    }
  }
  return out;
}

/** Add points to an event. Returns true when this pushed it over its goal; the caller then runs finishEvent() after committing. */
export async function addEventPoints(c: PoolClient, e: any, studentId: number | null, points: number): Promise<boolean> {
  if (studentId) await q(`INSERT INTO event_contributions (event_id, student_id, points) VALUES ($1,$2,$3)
    ON CONFLICT (event_id, student_id) DO UPDATE SET points = event_contributions.points + $3`, [e.id, studentId, points], c);
  const upd = await one<{ progress: number; completed_at: Date | null }>('UPDATE events SET progress = progress + $2 WHERE id=$1 RETURNING progress, completed_at', [e.id, points], c);
  return !upd!.completed_at && upd!.progress >= e.goal_amount && upd!.progress - points < e.goal_amount;
}

/**
 * Complete an event: build the unlocked structure and reward every helper.
 * Runs in small separate transactions (never while a student's row is locked) so a class
 * answering at the same moment can't deadlock. Returns null if it was already complete.
 */
export async function finishEvent(eventId: number): Promise<{ title: string; classId: number; worldId: number; helpers: { id: number; item: string | null; xp: number; coins: number }[] } | null> {
  const e = await tx(async (c) => {
    const ev = await one('UPDATE events SET completed_at = now() WHERE id=$1 AND completed_at IS NULL RETURNING *', [eventId], c);
    if (!ev) return null;
    const cls = await one('SELECT world_id FROM classes WHERE id=$1', [ev.class_id], c);
    const st = ev.unlock_structure ? STRUCTURE_BY_KEY[ev.unlock_structure] : null;
    if (st && ev.structure_x !== null) {
      const w = await one('SELECT seed FROM worlds WHERE id=$1', [cls.world_id], c);
      let gy = 1;
      for (let y = 60; y > 0; y--) { const b = baseBlock(w.seed, ev.structure_x, y, ev.structure_z); if (b !== 0 && b !== 9) { gy = y + 1; break; } }
      for (const b of st.blocks) {
        const x = ev.structure_x + b.dx, y = gy + b.dy, z = ev.structure_z + b.dz;
        if (!inWorld(x, y, z)) continue;
        await q(`INSERT INTO world_blocks (world_id, x, y, z, block_id, placed_by, approved) VALUES ($1,$2,$3,$4,$5,NULL,TRUE)
          ON CONFLICT (world_id, x, y, z) DO UPDATE SET block_id=$5, placed_by=NULL, approved=TRUE`, [cls.world_id, x, y, z, b.b], c);
      }
    }
    return { ...ev, world_id: cls.world_id, structure: st?.name };
  });
  if (!e) return null;
  const helpers = await q('SELECT student_id FROM event_contributions WHERE event_id=$1 AND points > 0', [eventId]);
  const out: { id: number; item: string | null; xp: number; coins: number }[] = [];
  for (const h of helpers) {
    const r = await tx(async (c) => {
      let xp = 0, coins = 0;
      if (e.reward_xp || e.reward_coins) { const g = await grantReward(c, h.student_id, { xp: e.reward_xp, coins: e.reward_coins }, `event:${e.id}`); xp = g.gained.xp; coins = g.gained.coins; }
      const item = await giveItem(c, h.student_id, e.reward_item);
      return { id: h.student_id, item, xp, coins };
    });
    out.push(r);
  }
  await logActivity(null, e.class_id, 'event_completed', { title: e.title, helpers: helpers.length, structure: e.structure });
  return { title: e.title, classId: e.class_id, worldId: e.world_id, helpers: out };
}
