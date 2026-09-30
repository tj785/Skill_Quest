/**
 * Server-authoritative world state. Every block edit is validated here (permissions, inventory,
 * reach, protected areas, region locks) and persisted to world_blocks before anyone sees it.
 */
import { q, one, tx } from '../db.js';
import {
  baseBlock, inWorld, isProtected, plotBounds, regionAt, REGIONS, BLOCK_BY_ID, BLOCK_BY_KEY, BlockEdit, isRewardable, BuildMode
} from '@cq/shared';
import { addInventory, checkAchievements, grantReward } from './rewards.js';
import { recordGameEvent, Notice, EventDone } from './progress.js';

interface Edit { b: number; by: number | null; approved: boolean; }
interface WorldCache { id: number; seed: number; edits: Map<string, Edit>; }

const worlds = new Map<number, WorldCache>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export async function loadWorld(worldId: number): Promise<WorldCache> {
  let w = worlds.get(worldId);
  if (w) return w;
  const row = await one<{ id: number; seed: number }>('SELECT id, seed FROM worlds WHERE id=$1', [worldId]);
  if (!row) throw new Error('World not found');
  const edits = new Map<string, Edit>();
  for (const e of await q('SELECT x, y, z, block_id, placed_by, approved FROM world_blocks WHERE world_id=$1', [worldId])) edits.set(key(e.x, e.y, e.z), { b: e.block_id, by: e.placed_by, approved: e.approved });
  w = { id: row.id, seed: row.seed, edits };
  worlds.set(worldId, w);
  return w;
}

/** Drop the cache (after restores / resets done directly in SQL). */
export function invalidateWorld(worldId: number) { worlds.delete(worldId); }

export function blockAt(w: WorldCache, x: number, y: number, z: number): number {
  const e = w.edits.get(key(x, y, z));
  return e ? e.b : baseBlock(w.seed, x, y, z);
}

/**
 * All edits a given viewer may see. Blocks waiting for teacher approval are visible only to
 * their builder and to teachers; everyone else sees the original terrain there.
 * Pass viewer = null for the full list (teacher / admin view).
 */
export function editsList(w: WorldCache, viewer: { userId: number; role: string } | null = null): BlockEdit[] {
  const out: BlockEdit[] = [];
  const seesAll = !viewer || viewer.role !== 'student';
  for (const [k, e] of w.edits) {
    if (!e.approved && !seesAll && e.by !== viewer!.userId) continue;
    const [x, y, z] = k.split(',').map(Number);
    out.push(e.approved ? { x, y, z, b: e.b } : { x, y, z, b: e.b, pending: true });
  }
  return out;
}

/** What classmates who can't see pending blocks should show at a position. */
export function visibleBlockFor(w: WorldCache, x: number, y: number, z: number, viewer: { userId: number; role: string }): number {
  const e = w.edits.get(key(x, y, z));
  if (!e) return baseBlock(w.seed, x, y, z);
  if (e.approved || viewer.role !== 'student' || e.by === viewer.userId) return e.b;
  return baseBlock(w.seed, x, y, z);
}

export interface Actor {
  userId: number;
  role: 'student' | 'teacher' | 'admin';
  classId: number;
  pos?: { x: number; y: number; z: number };
}

interface ClassRules { build_mode: BuildMode; harvest_enabled: boolean; harvest_daily_cap: number; unlock_all_regions: boolean; }
interface StudentRow { user_id: number; plot_index: number; level: number; can_build: boolean; frozen: boolean; harvest_day: string | null; harvest_count: number; }

export class EditError extends Error {}

/** Edits to one world run one at a time so two players can't claim the same spot or spend the same block. */
const locks = new Map<number, Promise<unknown>>();
function withWorldLock<T>(worldId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(worldId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(worldId, next.catch(() => undefined));
  return next;
}

async function zonesFor(classId: number) {
  return q<{ x0: number; z0: number; x1: number; z1: number; bonus_xp_per_block: number; name: string }>('SELECT * FROM project_zones WHERE class_id=$1', [classId]);
}

function inBox(x: number, z: number, b: { x0: number; z0: number; x1: number; z1: number }) {
  return x >= Math.min(b.x0, b.x1) && x <= Math.max(b.x0, b.x1) && z >= Math.min(b.z0, b.z1) && z <= Math.max(b.z0, b.z1);
}

/** Check whether a student may modify (x,y,z). Returns the project zone if the spot is inside one. */
async function checkStudentPermission(cls: ClassRules, s: StudentRow, classId: number, x: number, y: number, z: number) {
  if (s.frozen) throw new EditError('Your teacher has paused your character.');
  if (!s.can_build) throw new EditError('Building is turned off for you right now.');
  if (cls.build_mode === 'read_only') throw new EditError('This world is in explore-only mode.');
  if (isProtected(x, y, z)) throw new EditError('Village buildings are protected.');
  const region = REGIONS[regionAt(x, z)];
  if (!cls.unlock_all_regions && s.level < region.minLevel) throw new EditError(`${region.name} unlocks at level ${region.minLevel}.`);
  const own = inBox(x, z, plotBounds(s.plot_index));
  const zones = await zonesFor(classId);
  const zone = zones.find((zn) => inBox(x, z, zn));
  const others = await q<{ plot_index: number }>('SELECT plot_index FROM students WHERE class_id=$1 AND user_id<>$2', [classId, s.user_id]);
  const inOtherPlot = others.some((o) => inBox(x, z, plotBounds(o.plot_index)));
  if ((cls.build_mode === 'personal_area' || cls.build_mode === 'teacher_approval') && !own) throw new EditError('You can only build inside your own plot. Look for your name sign in the village.');
  if (cls.build_mode === 'class_project' && !own && !zone) throw new EditError('Build in your plot or in a class project zone.');
  if (cls.build_mode === 'anywhere' && inOtherPlot && !own) throw new EditError("That is a classmate's plot.");
  return zone;
}

function reachOk(pos: Actor['pos'], x: number, y: number, z: number) {
  if (!pos) return false;
  return Math.hypot(pos.x - (x + 0.5), pos.y + 1.6 - (y + 0.5), pos.z - (z + 0.5)) <= 8.5;
}

export function placeBlock(worldId: number, a: Actor, x: number, y: number, z: number, b: number) {
  return withWorldLock(worldId, () => placeBlockUnlocked(worldId, a, x, y, z, b));
}
async function placeBlockUnlocked(worldId: number, a: Actor, x: number, y: number, z: number, b: number): Promise<{ edit: BlockEdit; inventory?: Record<number, number>; notices: Notice[]; eventDone?: EventDone; progressChanged: boolean }> {
  if (![x, y, z, b].every(Number.isInteger)) throw new EditError('Invalid position.');
  if (!inWorld(x, y, z) || y < 1) throw new EditError('That is outside the world.');
  const def = BLOCK_BY_ID[b];
  if (!def || b === 0 || def.unbreakable) throw new EditError('Unknown block.');
  if (a.role === 'student' && !isRewardable(b)) throw new EditError('That block cannot be placed.');
  if (!reachOk(a.pos, x, y, z)) throw new EditError('That spot is too far away.');
  const w = await loadWorld(worldId);
  const cur = blockAt(w, x, y, z);
  if (cur !== 0 && cur !== BLOCK_BY_KEY.water.id) throw new EditError('Something is already there.');
  const existing = w.edits.get(key(x, y, z));
  if (a.role === 'student' && existing && existing.by === null) throw new EditError('That is part of a class reward building, so it is protected.');

  return tx(async (c) => {
    let zone: Awaited<ReturnType<typeof checkStudentPermission>>;
    let approved = true;
    const notices: Notice[] = [];
    let eventDone: EventDone | undefined;
    let progressChanged = false;
    if (a.role === 'student') {
      const cls = await one<ClassRules>('SELECT * FROM classes WHERE id=$1', [a.classId], c);
      const s = await one<StudentRow>('SELECT * FROM students WHERE user_id=$1 FOR UPDATE', [a.userId], c);
      zone = await checkStudentPermission(cls!, s!, a.classId, x, y, z);
      const inv = await one<{ quantity: number }>('SELECT quantity FROM inventory WHERE student_id=$1 AND block_id=$2', [a.userId, b], c);
      if (!inv || inv.quantity < 1) throw new EditError(`You have no ${def.name} left. Answer questions to earn more.`);
      await q('UPDATE inventory SET quantity = quantity - 1 WHERE student_id=$1 AND block_id=$2', [a.userId, b], c);
      // Only count a block once: removing and re-placing the same block earns nothing new.
      const fresh = Number((s as any).blocks_placed) + 1 > Number((s as any).blocks_credited ?? 0);
      const placed = await one<{ blocks_placed: number }>(`UPDATE students SET blocks_placed = blocks_placed + 1,
          blocks_credited = GREATEST(blocks_credited, blocks_placed + 1) WHERE user_id=$1 RETURNING blocks_placed`, [a.userId], c);
      approved = cls!.build_mode !== 'teacher_approval';
      if (fresh) {
        if (placed!.blocks_placed % 10 === 0) await checkAchievements(c, a.userId, a.classId);
        if (zone && zone.bonus_xp_per_block > 0) await grantReward(c, a.userId, { xp: zone.bonus_xp_per_block }, `project:${zone.name}`);
        const pr = await recordGameEvent(c, a.userId, a.classId, { type: 'block_placed', inZone: !!zone });
        notices.push(...pr.notices);
        progressChanged = pr.changed;
        eventDone = pr.eventCompleted;
      }
    }
    await persist(c, w, x, y, z, b, a.userId, approved);
    const inventory = a.role === 'student' ? Object.fromEntries((await q('SELECT block_id, quantity FROM inventory WHERE student_id=$1 AND quantity>0', [a.userId], c)).map((r) => [r.block_id, r.quantity])) : undefined;
    return { edit: approved ? { x, y, z, b } : { x, y, z, b, pending: true }, inventory, notices, eventDone, progressChanged };
  });
}

/** Terrain that yields a block when harvested (grass gives dirt; leaves/snow/water give nothing). */
function harvestYield(b: number): number | null {
  const k = BLOCK_BY_ID[b]?.key;
  if (k === 'grass') return BLOCK_BY_KEY.dirt.id;
  if (['dirt', 'stone', 'sand', 'gravel', 'log'].includes(k)) return b;
  return null;
}

export function removeBlock(worldId: number, a: Actor, x: number, y: number, z: number) {
  return withWorldLock(worldId, () => removeBlockUnlocked(worldId, a, x, y, z));
}
async function removeBlockUnlocked(worldId: number, a: Actor, x: number, y: number, z: number): Promise<{ edit: BlockEdit; inventory?: Record<number, number>; message?: string; wasPending: boolean }> {
  if (![x, y, z].every(Number.isInteger) || !inWorld(x, y, z)) throw new EditError('Invalid position.');
  if (!reachOk(a.pos, x, y, z)) throw new EditError('That spot is too far away.');
  const w = await loadWorld(worldId);
  const cur = a.role === 'student' ? visibleBlockFor(w, x, y, z, a) : blockAt(w, x, y, z);
  const def = BLOCK_BY_ID[cur];
  if (cur === 0 || cur === BLOCK_BY_KEY.water.id) throw new EditError('Nothing to remove.');
  const pendingOther = (() => { const e = w.edits.get(key(x, y, z)); return !!e && !e.approved && e.by !== a.userId && a.role === 'student'; })();
  if (pendingOther) throw new EditError('Nothing to remove.');
  if (def?.unbreakable) throw new EditError('That block cannot be removed.');
  const edit = w.edits.get(key(x, y, z));

  return tx(async (c) => {
    let message: string | undefined;
    if (a.role === 'student') {
      const cls = await one<ClassRules>('SELECT * FROM classes WHERE id=$1', [a.classId], c);
      const s = await one<StudentRow>('SELECT * FROM students WHERE user_id=$1 FOR UPDATE', [a.userId], c);
      if (edit && edit.b !== 0 && edit.by === null) throw new EditError('That is part of a class reward building, so it is protected.');
      const placedByOther = edit && edit.b !== 0 && edit.by !== null && edit.by !== a.userId;
      const zone = await checkStudentPermission(cls!, s!, a.classId, x, y, z).catch((e) => {
        if (placedByOther) throw new EditError('A classmate built that. Only they (or your teacher) can remove it.');
        throw e;
      });
      if (placedByOther && !zone) throw new EditError('A classmate built that. Only they (or your teacher) can remove it.');
      if (edit && edit.b !== 0 && edit.by === a.userId) {
        await addInventory(c, a.userId, cur, 1); // your own block comes back
        await q('UPDATE students SET blocks_placed = GREATEST(0, blocks_placed - 1) WHERE user_id=$1', [a.userId], c);
      } else if (!edit && cls!.harvest_enabled) {
        const y2 = harvestYield(cur);
        if (y2) {
          const today = new Date().toISOString().slice(0, 10);
          const count = s!.harvest_day && String(s!.harvest_day).slice(0, 10) === today ? s!.harvest_count : 0;
          if (count < cls!.harvest_daily_cap) {
            await addInventory(c, a.userId, y2, 1);
            await q('UPDATE students SET harvest_day=$2, harvest_count=$3 WHERE user_id=$1', [a.userId, today, count + 1], c);
          } else message = `Daily gathering limit reached (${cls!.harvest_daily_cap}). Answer questions to earn more blocks.`;
        }
      }
    }
    const wasPending = !!edit && !edit.approved;
    // Removing a pending block just cancels it: the spot goes back to its original terrain.
    if (wasPending) await persist(c, w, x, y, z, baseBlock(w.seed, x, y, z), a.userId);
    else await persist(c, w, x, y, z, 0, a.userId);
    const inventory = a.role === 'student' ? Object.fromEntries((await q('SELECT block_id, quantity FROM inventory WHERE student_id=$1 AND quantity>0', [a.userId], c)).map((r) => [r.block_id, r.quantity])) : undefined;
    return { edit: { x, y, z, b: wasPending ? baseBlock(w.seed, x, y, z) : 0 }, inventory, message, wasPending };
  });
}

async function persist(c: import('pg').PoolClient, w: WorldCache, x: number, y: number, z: number, b: number, by: number, approved = true) {
  const base = baseBlock(w.seed, x, y, z);
  if (b === base) {
    await q('DELETE FROM world_blocks WHERE world_id=$1 AND x=$2 AND y=$3 AND z=$4', [w.id, x, y, z], c);
    w.edits.delete(key(x, y, z));
  } else {
    await q(`INSERT INTO world_blocks (world_id, x, y, z, block_id, placed_by, approved) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (world_id, x, y, z) DO UPDATE SET block_id=$5, placed_by=$6, approved=$7, placed_at=now()`, [w.id, x, y, z, b, b === 0 ? null : by, approved], c);
    w.edits.set(key(x, y, z), { b, by: b === 0 ? null : by, approved });
  }
}

/** Pending (unapproved) blocks per student, for the teacher's approval list. */
export async function pendingCounts(worldId: number) {
  return q<{ placed_by: number; n: number }>('SELECT placed_by, count(*)::int n FROM world_blocks WHERE world_id=$1 AND NOT approved GROUP BY 1', [worldId]);
}

/** Approve a student's pending blocks: everyone can now see them. Returns the edits to broadcast. */
export async function approvePending(worldId: number, studentId: number): Promise<BlockEdit[]> {
  const rows = await q('UPDATE world_blocks SET approved=TRUE WHERE world_id=$1 AND placed_by=$2 AND NOT approved RETURNING x, y, z, block_id', [worldId, studentId]);
  invalidateWorld(worldId);
  return rows.map((r) => ({ x: r.x, y: r.y, z: r.z, b: r.block_id }));
}

/** Reject a student's pending blocks: they are removed and returned to the student's inventory. */
export async function rejectPending(worldId: number, studentId: number): Promise<{ edits: BlockEdit[]; returned: number }> {
  const w = await loadWorld(worldId);
  return tx(async (c) => {
    const rows = await q('DELETE FROM world_blocks WHERE world_id=$1 AND placed_by=$2 AND NOT approved RETURNING x, y, z, block_id', [worldId, studentId], c);
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.block_id, (counts.get(r.block_id) ?? 0) + 1);
    for (const [b, n] of counts) await addInventory(c, studentId, b, n);
    invalidateWorld(worldId);
    return { edits: rows.map((r) => ({ x: r.x, y: r.y, z: r.z, b: baseBlock(w.seed, r.x, r.y, r.z) })), returned: rows.length };
  });
}

/** Moderation: remove every block a student placed (terrain they dug stays dug). Returns count. */
export async function removeStudentBuilds(worldId: number, studentId: number): Promise<number> {
  const r = await q('DELETE FROM world_blocks WHERE world_id=$1 AND placed_by=$2 RETURNING x', [worldId, studentId]);
  invalidateWorld(worldId);
  return r.length;
}

/** Moderation: restore generated terrain inside a rectangle (all heights). */
export async function resetArea(worldId: number, x0: number, z0: number, x1: number, z1: number): Promise<number> {
  const r = await q('DELETE FROM world_blocks WHERE world_id=$1 AND x BETWEEN $2 AND $3 AND z BETWEEN $4 AND $5 RETURNING x',
    [worldId, Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]);
  invalidateWorld(worldId);
  return r.length;
}

/** Group a student's placed blocks into "buildings" (connected clusters of 8+ blocks) for profiles and stats. */
export async function buildingsOf(worldId: number, studentId?: number) {
  const rows = await q<{ x: number; y: number; z: number; placed_by: number }>(
    `SELECT x, y, z, placed_by FROM world_blocks WHERE world_id=$1 AND block_id<>0 ${studentId ? 'AND placed_by=$2' : 'AND placed_by IS NOT NULL'}`,
    studentId ? [worldId, studentId] : [worldId]);
  const byOwner = new Map<number, { x: number; y: number; z: number }[]>();
  for (const r of rows) { if (!byOwner.has(r.placed_by)) byOwner.set(r.placed_by, []); byOwner.get(r.placed_by)!.push(r); }
  const out: { owner: number; blocks: number; x: number; y: number; z: number }[] = [];
  for (const [owner, list] of byOwner) {
    const set = new Map(list.map((p) => [key(p.x, p.y, p.z), p]));
    const seen = new Set<string>();
    for (const p of list) {
      const k0 = key(p.x, p.y, p.z);
      if (seen.has(k0)) continue;
      const stack = [p]; seen.add(k0);
      let n = 0, sx = 0, sy = 0, sz = 0;
      while (stack.length) {
        const c = stack.pop()!; n++; sx += c.x; sy += c.y; sz += c.z;
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const k = key(c.x + dx, c.y + dy, c.z + dz);
          if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(set.get(k)!); }
        }
      }
      if (n >= 8) out.push({ owner, blocks: n, x: Math.round(sx / n), y: Math.round(sy / n), z: Math.round(sz / n) });
    }
  }
  return out;
}
