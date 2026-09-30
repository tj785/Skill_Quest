import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { BLOCKS } from '@cq/shared';

export let pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined });

/** Swap the pool (used by tests to point at a separate database). */
export function setPool(p: pg.Pool) { pool = p; }

export type Queryable = pg.Pool | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T[]> {
  const r = await db.query<T>(text, params as any[]);
  return r.rows;
}
export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Queryable = pool): Promise<T | undefined> {
  return (await q<T>(text, params, db))[0];
}

/** Run fn inside a transaction; rolls back on any error and retries a few times on a deadlock / serialization failure. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await txOnce(fn); } catch (e: any) {
      if (attempt >= 4 || !['40P01', '40001'].includes(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 40));
    }
  }
}
async function txOnce<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const cand of [path.join(here, '../migrations'), path.join(here, '../../migrations'), path.join(process.cwd(), 'server/migrations'), path.join(process.cwd(), 'migrations')]) {
    if (fs.existsSync(cand)) return cand;
  }
  throw new Error('Could not find migrations folder');
}

/** Apply any .sql migration not yet recorded in schema_migrations, in filename order. */
export async function migrate(log = true): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    applied.push(f);
    if (log) console.log(`[migrate] applied ${f}`);
  }
  // Keep the blocks reference table in sync with the shared catalog.
  for (const b of BLOCKS) {
    await pool.query('INSERT INTO blocks (id, key, name, tier) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET key=$2, name=$3, tier=$4', [b.id, b.key, b.name, b.tier]);
  }
  return applied;
}
