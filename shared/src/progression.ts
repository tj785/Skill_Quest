/** Leveling, difficulty presets and titles. Used by the server (authoritative) and client (display). */
import { BLOCK_BY_KEY, Tier } from './blocks.js';

/** Total XP needed to reach each level. Level 1 = 0, 2 = 100, 3 = 250, 4 = 500, 5 = 800, then +400, +500, ... */
export function xpForLevel(level: number): number {
  const fixed = [0, 0, 100, 250, 500, 800];
  if (level <= 5) return fixed[Math.max(1, level)];
  let xp = 800;
  for (let l = 6; l <= level; l++) xp += 300 + (l - 5) * 100;
  return xp;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 200 && xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, levelStart: cur, nextLevelXp: next, pct: Math.min(1, (xp - cur) / (next - cur)) };
}

export const TITLES: { level: number; title: string }[] = [
  { level: 1, title: 'Apprentice' },
  { level: 3, title: 'Explorer' },
  { level: 5, title: 'Builder' },
  { level: 8, title: 'Scholar' },
  { level: 12, title: 'Architect' },
  { level: 16, title: 'Sage' },
  { level: 20, title: 'Legend' }
];
export function titleForLevel(level: number): string {
  let t = TITLES[0].title;
  for (const r of TITLES) if (level >= r.level) t = r.title;
  return t;
}

export interface DifficultyDef { level: 1 | 2 | 3 | 4 | 5; name: string; xp: number; skill: number; coins: number; tier: Tier; blockKey: string; quantity: number; }

/** Default rewards per difficulty. Teachers can override any of these per question. */
export const DIFFICULTIES: DifficultyDef[] = [
  { level: 1, name: 'Basic', xp: 25, skill: 1, coins: 5, tier: 'common', blockKey: 'planks', quantity: 5 },
  { level: 2, name: 'Developing', xp: 50, skill: 2, coins: 10, tier: 'uncommon', blockKey: 'bricks', quantity: 4 },
  { level: 3, name: 'Challenge', xp: 100, skill: 5, coins: 20, tier: 'rare', blockKey: 'diamond_brick', quantity: 3 },
  { level: 4, name: 'Advanced', xp: 250, skill: 8, coins: 40, tier: 'epic', blockKey: 'crystal', quantity: 2 },
  { level: 5, name: 'Master', xp: 500, skill: 10, coins: 80, tier: 'legendary', blockKey: 'starstone', quantity: 1 }
];
export function difficultyDef(level: number): DifficultyDef {
  return DIFFICULTIES[Math.min(5, Math.max(1, level)) - 1];
}
export function defaultBlockId(level: number): number {
  return BLOCK_BY_KEY[difficultyDef(level).blockKey].id;
}

/** Starter inventory for a brand-new student so they can try building immediately. */
export const STARTER_INVENTORY: Record<string, number> = { planks: 10, dirt: 10, log: 5 };

export const DEFAULT_SKILLS = ['Mathematics', 'Reading', 'Science', 'Writing', 'Programming', 'Problem Solving'];

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'numeric', 'matching'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const BUILD_MODES = ['anywhere', 'personal_area', 'class_project', 'teacher_approval', 'read_only'] as const;
export type BuildMode = (typeof BUILD_MODES)[number];
export const BUILD_MODE_LABEL: Record<BuildMode, string> = {
  anywhere: 'Build anywhere',
  personal_area: 'Personal area only',
  class_project: 'Personal area + class project zones',
  teacher_approval: 'Teacher approval (plot builds stay hidden until you approve them)',
  read_only: 'Read only (explore, no building)'
};

/** Normalize a free-text answer for comparison: case, spacing and trailing punctuation are ignored. */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}
