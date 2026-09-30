/** Cosmetics, quest step kinds, event structures and chat presets (shared by server and client). */
import { BLOCK_BY_KEY as B } from './blocks.js';

/* ---------------- cosmetics ---------------- */
export type CosmeticKind = 'shirt' | 'hat' | 'cape' | 'title';
export interface Cosmetic {
  key: string;
  kind: CosmeticKind;
  name: string;
  /** Coins; null = cannot be bought (teacher reward / event only). */
  price: number | null;
  color?: string;
  hat?: 'cap' | 'crown' | 'wizard' | 'tophat' | 'helmet' | 'headband';
  title?: string;
  minLevel?: number;
}

export const COSMETICS: Cosmetic[] = [
  { key: 'shirt_red', kind: 'shirt', name: 'Red Shirt', price: 20, color: '#c8453c' },
  { key: 'shirt_green', kind: 'shirt', name: 'Forest Green Shirt', price: 20, color: '#3fa55a' },
  { key: 'shirt_purple', kind: 'shirt', name: 'Royal Purple Shirt', price: 30, color: '#7a4fd6' },
  { key: 'shirt_gold', kind: 'shirt', name: 'Golden Tunic', price: 120, color: '#e6b12c', minLevel: 5 },
  { key: 'shirt_black', kind: 'shirt', name: 'Midnight Armor', price: 200, color: '#2a2f3a', minLevel: 8 },
  { key: 'hat_cap', kind: 'hat', name: 'Explorer Cap', price: 40, hat: 'cap', color: '#2a63d4' },
  { key: 'hat_headband', kind: 'hat', name: 'Scholar Headband', price: 25, hat: 'headband', color: '#c8453c' },
  { key: 'hat_wizard', kind: 'hat', name: 'Wizard Hat', price: 90, hat: 'wizard', color: '#4b3aa6', minLevel: 3 },
  { key: 'hat_tophat', kind: 'hat', name: 'Top Hat', price: 70, hat: 'tophat', color: '#1f1f25' },
  { key: 'hat_helmet', kind: 'hat', name: 'Knight Helmet', price: 150, hat: 'helmet', color: '#9aa4b1', minLevel: 6 },
  { key: 'hat_crown', kind: 'hat', name: 'Golden Crown', price: 300, hat: 'crown', color: '#f2c230', minLevel: 10 },
  { key: 'hat_crown_legend', kind: 'hat', name: 'Legend Crown', price: null, hat: 'crown', color: '#ff9a1f' },
  { key: 'cape_blue', kind: 'cape', name: 'Blue Cape', price: 60, color: '#2a63d4' },
  { key: 'cape_red', kind: 'cape', name: 'Hero Cape', price: 80, color: '#b8352a' },
  { key: 'cape_star', kind: 'cape', name: 'Starlight Cape', price: 250, color: '#1d2a6b', minLevel: 8 },
  { key: 'cape_event', kind: 'cape', name: 'Champion Cape', price: null, color: '#e8a33b' },
  { key: 'title_bookworm', kind: 'title', name: 'Title: Bookworm', price: 50, title: 'Bookworm' },
  { key: 'title_builder', kind: 'title', name: 'Title: Master Builder', price: 100, title: 'Master Builder', minLevel: 4 },
  { key: 'title_math', kind: 'title', name: 'Title: Math Wizard', price: 100, title: 'Math Wizard', minLevel: 4 },
  { key: 'title_explorer', kind: 'title', name: 'Title: World Explorer', price: null, title: 'World Explorer' },
  { key: 'title_helper', kind: 'title', name: 'Title: Class Helper', price: null, title: 'Class Helper' },
  { key: 'title_champion', kind: 'title', name: 'Title: Event Champion', price: null, title: 'Event Champion' }
];
export const COSMETIC_BY_KEY: Record<string, Cosmetic> = Object.assign(Object.create(null), Object.fromEntries(COSMETICS.map((c) => [c.key, c])));

/** What a player looks like: sent to every client so avatars show equipped cosmetics. */
export interface Look { shirt?: string; hat?: Cosmetic['hat']; hatColor?: string; cape?: string; title?: string; }
export function lookFromItems(keys: string[]): Look {
  const look: Look = {};
  for (const k of keys) {
    const c = COSMETIC_BY_KEY[k];
    if (!c) continue;
    if (c.kind === 'shirt') look.shirt = c.color;
    if (c.kind === 'hat') { look.hat = c.hat; look.hatColor = c.color; }
    if (c.kind === 'cape') look.cape = c.color;
    if (c.kind === 'title') look.title = c.title;
  }
  return look;
}

/* ---------------- quests ---------------- */
export const QUEST_STEP_KINDS = ['correct_answers', 'subject_correct', 'topic_correct', 'hard_correct', 'place_blocks', 'place_in_zone', 'visit_region', 'complete_assignment'] as const;
export type QuestStepKind = (typeof QUEST_STEP_KINDS)[number];
export const QUEST_STEP_LABEL: Record<QuestStepKind, string> = {
  correct_answers: 'Answer questions correctly',
  subject_correct: 'Answer questions in a subject',
  topic_correct: 'Answer questions on a topic',
  hard_correct: 'Answer difficult questions (level 3+)',
  place_blocks: 'Place blocks',
  place_in_zone: 'Place blocks in a class project zone',
  visit_region: 'Visit a region',
  complete_assignment: 'Complete an assignment'
};
export const QUEST_REPEATS = ['none', 'daily', 'weekly'] as const;
export type QuestRepeat = (typeof QUEST_REPEATS)[number];

/** Default step description if the teacher leaves it blank. */
export function describeStep(s: { kind: QuestStepKind; amount: number; subject?: string | null; topic?: string | null; region?: string | null }): string {
  switch (s.kind) {
    case 'correct_answers': return `Answer ${s.amount} question${s.amount === 1 ? '' : 's'} correctly`;
    case 'subject_correct': return `Answer ${s.amount} ${s.subject ?? ''} question${s.amount === 1 ? '' : 's'} correctly`;
    case 'topic_correct': return `Answer ${s.amount} ${s.topic ?? ''} question${s.amount === 1 ? '' : 's'} correctly`;
    case 'hard_correct': return `Answer ${s.amount} difficult question${s.amount === 1 ? '' : 's'} (level 3+)`;
    case 'place_blocks': return `Place ${s.amount} block${s.amount === 1 ? '' : 's'}`;
    case 'place_in_zone': return `Place ${s.amount} block${s.amount === 1 ? '' : 's'} in a class project zone`;
    case 'visit_region': return `Visit the ${s.region ?? 'region'}`;
    case 'complete_assignment': return `Complete ${s.amount} assignment${s.amount === 1 ? '' : 's'}`;
  }
}

/** Period key for repeating quests, in the class's time zone. */
export function periodKey(repeat: QuestRepeat, timeZone: string, now = new Date()): string {
  if (repeat === 'none') return '';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); // YYYY-MM-DD
  if (repeat === 'daily') return day;
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ---------------- events ---------------- */
export const EVENT_GOALS = ['correct_answers', 'subject_correct', 'blocks_placed', 'manual'] as const;
export type EventGoal = (typeof EVENT_GOALS)[number];
export const EVENT_GOAL_LABEL: Record<EventGoal, string> = {
  correct_answers: 'Questions answered correctly (whole class)',
  subject_correct: 'Correct answers in one subject (whole class)',
  blocks_placed: 'Blocks placed (whole class)',
  manual: 'Points you add (e.g. walk-a-thon laps, reading minutes)'
};

export interface StructureDef { key: string; name: string; blocks: { dx: number; dy: number; dz: number; b: number }[]; }
function fountain(): StructureDef['blocks'] {
  const out: StructureDef['blocks'] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
    out.push({ dx, dy: 0, dz, b: edge ? B.stone_bricks.id : B.water.id });
  }
  for (let dy = 1; dy <= 3; dy++) out.push({ dx: 0, dy, dz: 0, b: dy === 3 ? B.crystal.id : B.marble_column.id });
  return out;
}
function statue(): StructureDef['blocks'] {
  const out: StructureDef['blocks'] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push({ dx, dy: 0, dz, b: B.marble_column.id });
  for (let dy = 1; dy <= 4; dy++) out.push({ dx: 0, dy, dz: 0, b: B.royal_gold.id });
  out.push({ dx: -1, dy: 3, dz: 0, b: B.royal_gold.id }, { dx: 1, dy: 3, dz: 0, b: B.royal_gold.id }, { dx: 0, dy: 5, dz: 0, b: B.starstone.id });
  return out;
}
function arch(): StructureDef['blocks'] {
  const out: StructureDef['blocks'] = [];
  for (let dy = 0; dy <= 4; dy++) { out.push({ dx: -2, dy, dz: 0, b: B.rainbow.id }, { dx: 2, dy, dz: 0, b: B.rainbow.id }); }
  for (let dx = -2; dx <= 2; dx++) out.push({ dx, dy: 5, dz: 0, b: B.rainbow.id });
  out.push({ dx: 0, dy: 6, dz: 0, b: B.lantern.id });
  return out;
}
export const STRUCTURES: StructureDef[] = [
  { key: 'fountain', name: 'Crystal Fountain', blocks: fountain() },
  { key: 'statue', name: 'Golden Champion Statue', blocks: statue() },
  { key: 'arch', name: 'Rainbow Arch', blocks: arch() }
];
export const STRUCTURE_BY_KEY: Record<string, StructureDef> = Object.assign(Object.create(null), Object.fromEntries(STRUCTURES.map((s) => [s.key, s])));

/* ---------------- chat ---------------- */
export const CHAT_MODES = ['off', 'preset', 'free'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export const CHAT_MODE_LABEL: Record<ChatMode, string> = {
  off: 'Off (no chat)',
  preset: 'Safe phrases only (students pick from a list)',
  free: 'Typed messages (filtered, you can review everything)'
};
export const CHAT_PRESETS = [
  'Hi!', 'Good job!', 'Want to build together?', 'Come see my build!', 'Follow me!', 'Thank you!',
  'I need help with a question.', 'Where is the Quest Center?', 'Nice house!', 'Let’s work on the class project!', 'Be right back.', 'Great teamwork!'
];
const BLOCKED_WORDS = ['stupid', 'dumb', 'idiot', 'hate', 'shut up', 'loser', 'ugly', 'kill', 'damn', 'hell', 'crap', 'sucks', 'fat', 'moron'];
/** Very small classroom filter. Replaces blocked words with asterisks and strips links / numbers that look like phone numbers. */
export function filterChat(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]');
  t = t.replace(/\b\d[\d\s().-]{6,}\d\b/g, '[number removed]');
  for (const w of BLOCKED_WORDS) t = t.replace(new RegExp(`\\b${w.replace(' ', '\\s+')}\\b`, 'gi'), (m) => '*'.repeat(m.length));
  return t;
}
