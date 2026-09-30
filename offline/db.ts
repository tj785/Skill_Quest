/**
 * Offline test build: a drop-in replacement for server/src/db.ts that runs PostgreSQL
 * inside the browser (PGlite, WebAssembly). Same q / one / tx / migrate API, so every
 * server service and route runs unchanged.
 */
import { PGlite } from '@electric-sql/pglite';
import { BLOCKS } from '@cq/shared';
import { MIGRATIONS } from './migrations.gen';

let db: PGlite;

/** Transactions need the single connection to themselves. */
let chain: Promise<void> = Promise.resolve();
function acquire(): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const prev = chain;
  chain = prev.then(() => mine);
  return prev.then(() => release);
}

async function run(text: string, params: unknown[] = []) {
  const vals = params.map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v));
  if (!vals.length) {
    const res = await db.exec(text);
    const last = res[res.length - 1];
    return { rows: (last?.rows ?? []) as any[], rowCount: last?.affectedRows ?? 0 };
  }
  const r = await db.query(text, vals as any[]);
  return { rows: r.rows as any[], rowCount: r.affectedRows ?? 0 };
}

export interface PoolClient { query: <T = any>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>; release: () => void; }
export const pool = {
  query: (text: string, params?: unknown[]) => run(text, params),
  async connect(): Promise<PoolClient> {
    const release = await acquire();
    let done = false;
    return { query: (t, p) => run(t, p) as any, release: () => { if (!done) { done = true; release(); } } };
  },
  end: async () => {}
};
export type Queryable = typeof pool | PoolClient;
export function setPool() { /* not used offline */ }
/** Make sure everything written so far is saved in IndexedDB (writes are flushed in the background otherwise). */
export async function flushDb() {
  // PGlite's own syncToFs() doesn't wait in relaxed mode, so call the file system's sync directly.
  try { await (db as any).fs?.syncToFs?.(false); } catch (e) { console.warn('flush failed', e); }
}
/** Close the database, which writes everything to IndexedDB. Used right before the page reloads. */
export async function closeDb() { await flushDb(); try { await db.close(); } catch (e) { console.warn('close failed', e); } }

export async function q<T = any>(text: string, params: unknown[] = [], c: Queryable = pool): Promise<T[]> { return (await c.query(text, params)).rows as T[]; }
export async function one<T = any>(text: string, params: unknown[] = [], c: Queryable = pool): Promise<T | undefined> { return (await q<T>(text, params, c))[0]; }
export async function tx<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function openDb(opts: { dataDir?: string; wasmModule: WebAssembly.Module; fsBundle: Blob }) {
  db = await PGlite.create({
    dataDir: opts.dataDir, wasmModule: opts.wasmModule, fsBundle: opts.fsBundle, relaxedDurability: true,
    // Match node-postgres: 64-bit integers and NUMERIC come back as strings.
    parsers: { 20: (v: string) => v, 1700: (v: string) => v }
  });
}

export async function migrate(log = true): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    await tx(async (c) => { await c.query(sql); await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]); });
    applied.push(name);
    if (log) console.log(`[migrate] applied ${name}`);
  }
  for (const b of BLOCKS) await pool.query('INSERT INTO blocks (id, key, name, tier) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET key=$2, name=$3, tier=$4', [b.id, b.key, b.name, b.tier]);
  return applied;
}
