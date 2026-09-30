/**
 * Reward engine. The ONLY place XP, coins, skills and inventory are increased.
 * Always runs inside a database transaction on the server; clients can never grant themselves anything.
 */
import type { PoolClient } from 'pg';
import { q, one } from '../db.js';
import { levelForXp, BLOCK_BY_ID, titleForLevel } from '@cq/shared';
import { criterionValue } from './achievements.js';
import { logActivity } from './log.js';

export interface Reward {
  xp?: number;
  coins?: number;
  skillId?: number | null;
  skillAmount?: number;
  blockId?: number | null;
  blockQty?: number;
}

export interface RewardResult {
  xp: number; coins: number; level: number; leveledUp: boolean; title: string;
  gained: { xp: number; coins: number; skill?: { name: string; amount: number }; block?: { id: number; name: string; qty: number; tier: string } };
  achievements: { name: string; description: string; xp: number }[];
}

export async function addInventory(c: PoolClient, studentId: number, blockId: number, qty: number) {
  if (qty === 0) return;
  await q(`INSERT INTO inventory (student_id, block_id, quantity) VALUES ($1,$2,GREATEST($3,0))
           ON CONFLICT (student_id, block_id) DO UPDATE SET quantity = GREATEST(inventory.quantity + $3, 0)`, [studentId, blockId, qty], c);
}

export async function inventoryOf(c: PoolClient | undefined, studentId: number): Promise<Record<number, number>> {
  const rows = await q<{ block_id: number; quantity: number }>('SELECT block_id, quantity FROM inventory WHERE student_id=$1 AND quantity > 0', [studentId], c);
  return Object.fromEntries(rows.map((r) => [r.block_id, r.quantity]));
}

export async function grantReward(c: PoolClient, studentId: number, r: Reward, reason: string): Promise<RewardResult> {
  const before = await one<{ xp: number; level: number; class_id: number }>('SELECT xp, level, class_id FROM students WHERE user_id=$1 FOR UPDATE', [studentId], c);
  if (!before) throw new Error('Student not found');
  const xpGain = Math.max(0, Math.floor(r.xp ?? 0));
  const coinGain = Math.max(0, Math.floor(r.coins ?? 0));
  const newXp = before.xp + xpGain;
  const level = levelForXp(newXp);
  await q('UPDATE students SET xp=$2, level=$3, coins = coins + $4 WHERE user_id=$1', [studentId, newXp, level, coinGain], c);

  const gained: RewardResult['gained'] = { xp: xpGain, coins: coinGain };
  if (r.skillId && (r.skillAmount ?? 0) > 0) {
    await q(`INSERT INTO student_skills (student_id, skill_id, points) VALUES ($1,$2,$3)
             ON CONFLICT (student_id, skill_id) DO UPDATE SET points = student_skills.points + $3`, [studentId, r.skillId, r.skillAmount], c);
    const sk = await one<{ name: string }>('SELECT name FROM skills WHERE id=$1', [r.skillId], c);
    gained.skill = { name: sk?.name ?? 'Skill', amount: r.skillAmount! };
  }
  if (r.blockId && (r.blockQty ?? 0) > 0 && BLOCK_BY_ID[r.blockId]) {
    await addInventory(c, studentId, r.blockId, r.blockQty!);
    const b = BLOCK_BY_ID[r.blockId];
    gained.block = { id: b.id, name: b.name, qty: r.blockQty!, tier: b.tier };
  }

  const achievements = await checkAchievements(c, studentId, before.class_id);
  const after = await one<{ xp: number; level: number; coins: number }>('SELECT xp, level, coins FROM students WHERE user_id=$1', [studentId], c);
  await logActivity(studentId, before.class_id, 'reward', { reason, ...gained, achievements: achievements.map((a) => a.name) }, c);
  return {
    xp: after!.xp, coins: after!.coins, level: after!.level, leveledUp: after!.level > before.level,
    title: titleForLevel(after!.level), gained, achievements
  };
}

/** Award any achievements whose criteria are now met. Achievement XP can itself unlock more (bounded loop). */
export async function checkAchievements(c: PoolClient, studentId: number, classId: number) {
  const earned: { name: string; description: string; xp: number }[] = [];
  for (let round = 0; round < 3; round++) {
    const pending = await q(`SELECT a.* FROM achievements a
       WHERE a.class_id=$1 AND a.criteria_type <> 'manual'
       AND NOT EXISTS (SELECT 1 FROM student_achievements sa WHERE sa.achievement_id=a.id AND sa.student_id=$2)`, [classId, studentId], c);
    let any = false;
    for (const a of pending) {
      const v = await criterionValue(c, studentId, a.criteria_type, a.criteria_subject);
      if (v < a.threshold) continue;
      await q('INSERT INTO student_achievements (student_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [studentId, a.id], c);
      if (a.xp_reward > 0 || a.coin_reward > 0) {
        const s = await one<{ xp: number }>('SELECT xp FROM students WHERE user_id=$1', [studentId], c);
        const nx = s!.xp + a.xp_reward;
        await q('UPDATE students SET xp=$2, level=$3, coins=coins+$4 WHERE user_id=$1', [studentId, nx, levelForXp(nx), a.coin_reward], c);
      }
      earned.push({ name: a.name, description: a.description, xp: a.xp_reward });
      any = true;
    }
    if (!any) break;
  }
  return earned;
}

/** Manually award an achievement (teacher action). */
export async function awardAchievement(c: PoolClient, studentId: number, achievementId: number) {
  const a = await one('SELECT * FROM achievements WHERE id=$1', [achievementId], c);
  if (!a) throw new Error('Achievement not found');
  const ins = await q('INSERT INTO student_achievements (student_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING student_id', [studentId, achievementId], c);
  if (ins.length && (a.xp_reward || a.coin_reward)) await grantReward(c, studentId, { xp: a.xp_reward, coins: a.coin_reward }, `achievement:${a.key}`);
  return a;
}
