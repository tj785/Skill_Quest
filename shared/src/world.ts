/**
 * Deterministic world generation. The server and every client run the exact
 * same code from the same seed, so only player edits ever need to be stored
 * in the database (table `world_blocks`). A position's real block is:
 *   edit at (x,y,z) if one exists, otherwise baseBlock(seed, x, y, z).
 */
import { BLOCK_BY_KEY } from './blocks.js';

export const WORLD_SIZE = 256; // blocks along X and Z
export const WORLD_HEIGHT = 64; // blocks along Y
export const CHUNK = 16; // chunk edge length in X/Z
export const SEA_LEVEL = 20;
export const VILLAGE_Y = 24; // ground height of the starting village
export const CENTER = WORLD_SIZE / 2;
export const VILLAGE_RADIUS = 48;

export type RegionKey = 'village' | 'forest' | 'desert' | 'ocean' | 'mountains';

export interface RegionDef {
  key: RegionKey;
  name: string;
  /** Minimum character level needed to enter (teachers can override per class). */
  minLevel: number;
  /** Direction from the village, in radians (0 = +X / east). */
  angle: number;
  color: string;
  description: string;
}

export const REGIONS: Record<RegionKey, RegionDef> = {
  village: { key: 'village', name: 'Starting Village', minLevel: 1, angle: 0, color: '#c9b37a', description: 'Safe starting area with the Quest Center.' },
  forest: { key: 'forest', name: 'Whispering Forest', minLevel: 1, angle: Math.PI, color: '#3f8a34', description: 'Trees, wood and exploration.' },
  desert: { key: 'desert', name: 'Sunscorch Desert', minLevel: 2, angle: 0, color: '#e2d39a', description: 'Sand dunes and hidden structures.' },
  ocean: { key: 'ocean', name: 'Sapphire Ocean', minLevel: 3, angle: Math.PI / 2, color: '#3a7bd5', description: 'Islands and special resources.' },
  mountains: { key: 'mountains', name: 'Frostpeak Mountains', minLevel: 4, angle: -Math.PI / 2, color: '#8c8c8c', description: 'Stone, caves and rare materials.' }
};

const B = BLOCK_BY_KEY;

/* ---------------- noise ---------------- */
function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
function valueNoise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smooth(x - x0), fz = smooth(z - z0);
  const a = hash2(seed, x0, z0), b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1), d = hash2(seed, x0 + 1, z0 + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
function fbm(seed: number, x: number, z: number, octaves = 4): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed + i * 1013, x * freq, z * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/* ---------------- regions ---------------- */
export function regionAt(x: number, z: number): RegionKey {
  const dx = x - CENTER, dz = z - CENTER;
  if (Math.hypot(dx, dz) <= VILLAGE_RADIUS) return 'village';
  const ang = Math.atan2(dz, dx); // -PI..PI
  if (ang > Math.PI / 4 && ang <= (3 * Math.PI) / 4) return 'ocean';
  if (ang > -(3 * Math.PI) / 4 && ang <= -Math.PI / 4) return 'mountains';
  if (ang > -Math.PI / 4 && ang <= Math.PI / 4) return 'desert';
  return 'forest';
}

function regionWeights(x: number, z: number) {
  const ang = Math.atan2(z - CENTER, x - CENTER);
  const w: Record<string, number> = {};
  let total = 0;
  for (const k of ['forest', 'desert', 'ocean', 'mountains'] as const) {
    let d = Math.abs(ang - REGIONS[k].angle);
    if (d > Math.PI) d = 2 * Math.PI - d;
    const v = Math.pow(Math.max(0, Math.cos(Math.min(d * 1.35, Math.PI / 2))), 3);
    w[k] = v; total += v;
  }
  for (const k in w) w[k] /= total || 1;
  return w as Record<'forest' | 'desert' | 'ocean' | 'mountains', number>;
}

/** Terrain surface height (top solid block y) for a column. Cached per seed. */
const heightCache = new Map<number, Int16Array>();
export function surfaceHeight(seed: number, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return 0;
  let cache = heightCache.get(seed);
  if (!cache) { cache = new Int16Array(WORLD_SIZE * WORLD_SIZE).fill(-1); heightCache.set(seed, cache); }
  const i = x + z * WORLD_SIZE;
  if (cache[i] >= 0) return cache[i];
  const dist = Math.hypot(x - CENTER, z - CENTER);
  const t = Math.min(1, Math.max(0, (dist - VILLAGE_RADIUS) / 30));
  const w = regionWeights(x, z);
  const n = fbm(seed, x / 38, z / 38);
  const forestH = VILLAGE_Y + (n - 0.5) * 10;
  const desertH = VILLAGE_Y - 1 + (fbm(seed + 7, x / 22, z / 22) - 0.5) * 7;
  const islands = fbm(seed + 31, x / 26, z / 26);
  const oceanH = SEA_LEVEL - 7 + (islands > 0.64 ? (islands - 0.64) * 70 : 0) + (n - 0.5) * 4;
  const ridge = 1 - Math.abs(fbm(seed + 91, x / 30, z / 30) * 2 - 1);
  const mountainH = VILLAGE_Y + 4 + ridge * 30 * Math.min(1, t * 1.6);
  const regionH = w.forest * forestH + w.desert * desertH + w.ocean * oceanH + w.mountains * mountainH;
  // Edge of the world: gentle wall so nobody falls off.
  const edge = Math.min(x, z, WORLD_SIZE - 1 - x, WORLD_SIZE - 1 - z);
  let h = VILLAGE_Y + (regionH - VILLAGE_Y) * smooth(t);
  if (edge < 4) h = Math.max(h, WORLD_HEIGHT - 20 + (4 - edge) * 3);
  const out = Math.max(2, Math.min(WORLD_HEIGHT - 3, Math.round(h)));
  cache[i] = out;
  return out;
}

/* ---------------- trees ---------------- */
function hasTree(seed: number, x: number, z: number): boolean {
  if (x < 3 || z < 3 || x > WORLD_SIZE - 4 || z > WORLD_SIZE - 4) return false;
  const r = regionAt(x, z);
  const dist = Math.hypot(x - CENTER, z - CENTER);
  let density = 0;
  if (r === 'forest') density = dist > VILLAGE_RADIUS + 6 ? 0.045 : 0;
  else if (r === 'mountains') density = 0.008;
  else if (r === 'village') density = dist > 44 ? 0.01 : 0;
  if (density === 0) return false;
  const h = surfaceHeight(seed, x, z);
  if (h <= SEA_LEVEL || h > 44) return false;
  if (hash2(seed + 555, x, z) > density) return false;
  // Keep trees apart: only the local maximum hash in a 5x5 area wins.
  const mine = hash2(seed + 777, x, z);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (!dx && !dz) continue;
    if (hash2(seed + 555, x + dx, z + dz) <= density && hash2(seed + 777, x + dx, z + dz) > mine) return false;
  }
  return true;
}
function treeHeight(seed: number, x: number, z: number) { return 4 + Math.floor(hash2(seed + 999, x, z) * 3); }

/* ---------------- village structures ---------------- */
export interface Landmark { key: string; name: string; x: number; z: number; y: number; kind: 'quest' | 'market' | 'achievement' | 'tutorial' | 'spawn' | 'homes' | 'project'; }

export const LANDMARKS: Landmark[] = [
  { key: 'quest_center', name: 'Quest Center & Question Hall', x: CENTER, z: CENTER - 10, y: VILLAGE_Y + 1, kind: 'quest' },
  { key: 'marketplace', name: 'Marketplace', x: CENTER + 14, z: CENTER, y: VILLAGE_Y + 1, kind: 'market' },
  { key: 'achievement_hall', name: 'Achievement Hall', x: CENTER - 14, z: CENTER, y: VILLAGE_Y + 1, kind: 'achievement' },
  { key: 'tutorial', name: 'Tutorial Garden', x: CENTER, z: CENTER + 14, y: VILLAGE_Y + 1, kind: 'tutorial' },
  { key: 'spawn', name: 'Spawn', x: CENTER, z: CENTER + 4, y: VILLAGE_Y + 1, kind: 'spawn' }
];

export const SPAWN = { x: CENTER + 0.5, y: VILLAGE_Y + 2, z: CENTER + 4.5 };

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; block: number; hollow?: boolean };
const structureBoxes: Box[] = (() => {
  const boxes: Box[] = [];
  const g = VILLAGE_Y + 1;
  const add = (b: Box) => boxes.push(b);
  // Quest Center: stone-brick hall with glass windows and a gold roof beacon.
  { const cx = CENTER, cz = CENTER - 10;
    add({ x0: cx - 5, x1: cx + 5, y0: g - 1, y1: g - 1, z0: cz - 4, z1: cz + 4, block: B.stone_bricks.id });
    for (const [px, pz] of [[cx - 5, cz - 4], [cx + 5, cz - 4], [cx - 5, cz + 4], [cx + 5, cz + 4]]) add({ x0: px, x1: px, y0: g, y1: g + 4, z0: pz, z1: pz, block: B.marble_column.id });
    add({ x0: cx - 5, x1: cx + 5, y0: g, y1: g + 3, z0: cz - 4, z1: cz - 4, block: B.stone_bricks.id });
    add({ x0: cx - 3, x1: cx + 3, y0: g + 1, y1: g + 2, z0: cz - 4, z1: cz - 4, block: B.glass.id });
    add({ x0: cx - 6, x1: cx + 6, y0: g + 5, y1: g + 5, z0: cz - 5, z1: cz + 5, block: B.dark_planks.id });
    add({ x0: cx - 1, x1: cx + 1, y0: g + 6, y1: g + 6, z0: cz - 1, z1: cz + 1, block: B.gold_block.id });
    add({ x0: cx, x1: cx, y0: g + 7, y1: g + 7, z0: cz, z1: cz, block: B.lantern.id });
    add({ x0: cx - 1, x1: cx + 1, y0: g, y1: g, z0: cz - 1, z1: cz + 1, block: B.bookshelf.id });
  }
  // Marketplace stalls.
  { const cx = CENTER + 14, cz = CENTER;
    for (const dz of [-4, 0, 4]) {
      add({ x0: cx - 1, x1: cx + 1, y0: g, y1: g, z0: cz + dz - 1, z1: cz + dz + 1, block: B.planks.id });
      add({ x0: cx - 2, x1: cx + 2, y0: g + 3, y1: g + 3, z0: cz + dz - 2, z1: cz + dz + 2, block: dz === 0 ? B.red_block.id : B.yellow_block.id });
      for (const [px, pz] of [[cx - 2, cz + dz - 2], [cx + 2, cz + dz - 2], [cx - 2, cz + dz + 2], [cx + 2, cz + dz + 2]]) add({ x0: px, x1: px, y0: g, y1: g + 2, z0: pz, z1: pz, block: B.log.id });
    }
  }
  // Achievement Hall: bricks with a crystal on top.
  { const cx = CENTER - 14, cz = CENTER;
    add({ x0: cx - 3, x1: cx + 3, y0: g, y1: g + 4, z0: cz - 3, z1: cz + 3, block: B.bricks.id, hollow: true });
    add({ x0: cx + 3, x1: cx + 3, y0: g, y1: g + 1, z0: cz, z1: cz, block: 0 });
    add({ x0: cx - 3, x1: cx + 3, y0: g + 5, y1: g + 5, z0: cz - 3, z1: cz + 3, block: B.stone_bricks.id });
    add({ x0: cx, x1: cx, y0: g + 6, y1: g + 6, z0: cz, z1: cz, block: B.crystal.id });
  }
  // Tutorial garden: a little path ring with signs of each block tier.
  { const cx = CENTER, cz = CENTER + 14;
    const row = [B.dirt.id, B.planks.id, B.bricks.id, B.glass.id, B.gold_block.id, B.crystal.id, B.starstone.id];
    row.forEach((id, i) => add({ x0: cx - 6 + i * 2, x1: cx - 6 + i * 2, y0: g, y1: g, z0: cz, z1: cz, block: id }));
  }
  // Village paths (gravel cross).
  add({ x0: CENTER - 1, x1: CENTER + 1, y0: g - 1, y1: g - 1, z0: CENTER - 16, z1: CENTER + 16, block: B.gravel.id });
  add({ x0: CENTER - 16, x1: CENTER + 16, y0: g - 1, y1: g - 1, z0: CENTER - 1, z1: CENTER + 1, block: B.gravel.id });
  return boxes;
})();

function structureBlock(x: number, y: number, z: number): number | undefined {
  let found: number | undefined;
  for (const b of structureBoxes) {
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || z < b.z0 || z > b.z1) continue;
    if (b.hollow && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0) { found = 0; continue; }
    found = b.block; // later boxes win
  }
  return found;
}

/** Protected zone: generated village buildings cannot be edited by students. */
export function isProtected(x: number, y: number, z: number): boolean {
  for (const b of structureBoxes) {
    if (x >= b.x0 - 1 && x <= b.x1 + 1 && z >= b.z0 - 1 && z <= b.z1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 2) return true;
  }
  return y <= 0;
}

/* ---------------- base block ---------------- */
export function baseBlock(seed: number, x: number, y: number, z: number): number {
  if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE || y < 0 || y >= WORLD_HEIGHT) return 0;
  if (y === 0) return B.bedrock.id;
  const s = structureBlock(x, y, z);
  if (s !== undefined) return s;
  const h = surfaceHeight(seed, x, z);
  const region = regionAt(x, z);
  if (y <= h) {
    const depth = h - y;
    if (region === 'desert' || h <= SEA_LEVEL + 1) return depth < 4 ? B.sand.id : B.stone.id;
    if (region === 'mountains' && h >= 42) return depth === 0 ? B.snow.id : B.stone.id;
    if (region === 'mountains' && h >= 32) return depth < 1 && hash2(seed + 3, x, z) > 0.5 ? B.gravel.id : B.stone.id;
    if (depth === 0) return B.grass.id;
    if (depth < 4) return B.dirt.id;
    return B.stone.id;
  }
  if (y <= SEA_LEVEL) return B.water.id;
  // Trees (trunk + leaf blob) from any trunk within 2 blocks.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const tx = x + dx, tz = z + dz;
    if (!hasTree(seed, tx, tz)) continue;
    const th = surfaceHeight(seed, tx, tz);
    const top = th + treeHeight(seed, tx, tz);
    if (dx === 0 && dz === 0 && y > th && y <= top) return B.log.id;
    const ly = y - top;
    if (ly >= -2 && ly <= 1) {
      const r = ly <= -1 ? 2 : 1;
      if (Math.abs(dx) <= r && Math.abs(dz) <= r && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) return B.leaves.id;
    }
  }
  return 0;
}

/** Fill a chunk column (CHUNK x WORLD_HEIGHT x CHUNK) with base blocks. Index = x + z*CHUNK + y*CHUNK*CHUNK. */
export function generateChunk(seed: number, cx: number, cz: number): Uint8Array {
  const out = new Uint8Array(CHUNK * CHUNK * WORLD_HEIGHT);
  for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
    const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
    const h = surfaceHeight(seed, x, z);
    const maxY = Math.min(WORLD_HEIGHT - 1, Math.max(h, SEA_LEVEL) + 12);
    for (let y = 0; y <= maxY; y++) out[lx + lz * CHUNK + y * CHUNK * CHUNK] = baseBlock(seed, x, y, z);
  }
  return out;
}

export function inWorld(x: number, y: number, z: number): boolean {
  return x >= 0 && z >= 0 && y >= 0 && x < WORLD_SIZE && z < WORLD_SIZE && y < WORLD_HEIGHT;
}

/* ---------------- personal plots ---------------- */
export const PLOT_SIZE = 8;
export const MAX_PLOTS = 40;
/** Plots ring the village: plot index n -> its square. Returned bounds are inclusive. */
export function plotBounds(index: number) {
  const perSide = 5;
  const side = Math.floor(index / perSide) % 4;
  const slot = index % perSide;
  const ring = Math.floor(index / (perSide * 4)) % 2;
  const off = 20 + ring * 10;
  // Plots sit side by side along each edge (x or z from -20 to +19) so the four edges never share a corner.
  const along = -20 + slot * PLOT_SIZE;
  let x0: number, z0: number;
  if (side === 0) { x0 = CENTER + along; z0 = CENTER + off; }
  else if (side === 1) { x0 = CENTER + off; z0 = CENTER + along; }
  else if (side === 2) { x0 = CENTER + along; z0 = CENTER - off - PLOT_SIZE; }
  else { x0 = CENTER - off - PLOT_SIZE; z0 = CENTER + along; }
  return { x0, z0, x1: x0 + PLOT_SIZE - 1, z1: z0 + PLOT_SIZE - 1 };
}
