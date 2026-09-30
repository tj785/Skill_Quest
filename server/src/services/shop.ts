/** Cosmetics shop. Coins are spent in a server transaction; nothing here affects academic progress. */
import { q, one, tx } from '../db.js';
import { COSMETICS, COSMETIC_BY_KEY, lookFromItems, Look } from '@cq/shared';
import { logActivity } from './log.js';

export async function studentLook(studentId: number): Promise<Look> {
  const rows = await q<{ item_key: string }>('SELECT item_key FROM student_items WHERE student_id=$1 AND equipped', [studentId]);
  return lookFromItems(rows.map((r) => r.item_key));
}

export async function shopFor(studentId: number) {
  const s = await one('SELECT coins, level FROM students WHERE user_id=$1', [studentId]);
  const owned = new Map((await q('SELECT item_key, equipped FROM student_items WHERE student_id=$1', [studentId])).map((r) => [r.item_key, r.equipped]));
  return {
    coins: s.coins, level: s.level,
    items: COSMETICS.filter((c) => c.price !== null || owned.has(c.key)).map((c) => ({ ...c, owned: owned.has(c.key), equipped: owned.get(c.key) === true, locked: !!c.minLevel && s.level < c.minLevel }))
  };
}

export class ShopError extends Error { status = 400; }

export async function buyItem(studentId: number, key: string) {
  const item = COSMETIC_BY_KEY[key];
  if (!item || item.price === null) throw new ShopError('That item is not for sale.');
  return tx(async (c) => {
    const s = await one('SELECT coins, level, class_id FROM students WHERE user_id=$1 FOR UPDATE', [studentId], c);
    if (item.minLevel && s.level < item.minLevel) throw new ShopError(`Reach level ${item.minLevel} to buy ${item.name}.`);
    if (await one('SELECT 1 FROM student_items WHERE student_id=$1 AND item_key=$2', [studentId, key], c)) throw new ShopError('You already own that.');
    if (s.coins < item.price!) throw new ShopError(`You need ${item.price! - s.coins} more coins. Answer questions to earn coins.`);
    await q('UPDATE students SET coins = coins - $2 WHERE user_id=$1', [studentId, item.price], c);
    await q('INSERT INTO student_items (student_id, item_key) VALUES ($1,$2)', [studentId, key], c);
    await equipIn(c, studentId, key, true);
    await logActivity(studentId, s.class_id, 'item_bought', { item: item.name, price: item.price }, c);
    return { coins: s.coins - item.price! };
  });
}

async function equipIn(c: import('pg').PoolClient, studentId: number, key: string, on: boolean) {
  const item = COSMETIC_BY_KEY[key];
  if (on) {
    const sameKind = COSMETICS.filter((x) => x.kind === item.kind).map((x) => x.key);
    await q('UPDATE student_items SET equipped=FALSE WHERE student_id=$1 AND item_key = ANY($2)', [studentId, sameKind], c);
  }
  await q('UPDATE student_items SET equipped=$3 WHERE student_id=$1 AND item_key=$2', [studentId, key, on], c);
}

export async function equipItem(studentId: number, key: string, on: boolean) {
  if (!COSMETIC_BY_KEY[key]) throw new ShopError('Unknown item.');
  await tx(async (c) => {
    if (!(await one('SELECT 1 FROM student_items WHERE student_id=$1 AND item_key=$2', [studentId, key], c))) throw new ShopError('You do not own that yet.');
    await equipIn(c, studentId, key, on);
  });
}
