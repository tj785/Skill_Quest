import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { hashPassword } from '../auth.js';
import { DEFAULT_SKILLS, STARTER_INVENTORY, BLOCK_BY_KEY, MAX_PLOTS } from '@cq/shared';
import { seedAchievements } from './achievements.js';
import { addInventory } from './rewards.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeJoinCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const AVATAR_COLORS = ['#3c6fc8', '#c8453c', '#3fa55a', '#e6a23c', '#8a4fd6', '#2fb3b3', '#d64f97', '#6b7a8f'];

export async function createClass(c: PoolClient, teacherId: number, name: string, grade: string | null, opts: { seed?: number } = {}) {
  const seed = opts.seed ?? crypto.randomInt(1, 2 ** 31 - 1);
  const world = await one<{ id: number }>('INSERT INTO worlds (name, seed) VALUES ($1,$2) RETURNING id', [`${name} World`, seed], c);
  let code = makeJoinCode();
  for (let i = 0; i < 5 && (await one('SELECT 1 FROM classes WHERE join_code=$1', [code], c)); i++) code = makeJoinCode();
  const cls = await one<{ id: number; world_id: number; [k: string]: any }>('INSERT INTO classes (name, grade, teacher_id, world_id, join_code) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, grade, teacherId, world!.id, code], c);
  for (const s of DEFAULT_SKILLS) await q('INSERT INTO skills (class_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [cls!.id, s], c);
  await seedAchievements(c, cls!.id);
  return cls!;
}

export class UsernameTaken extends Error { constructor(u: string) { super(`The username "${u}" is already taken.`); } }

export function validUsername(u: string) { return /^[A-Za-z0-9_.-]{3,32}$/.test(u); }

export async function addStudent(c: PoolClient, classId: number, username: string, password: string, displayName?: string) {
  if (!validUsername(username)) throw new Error('Usernames need 3-32 letters, numbers, dots, dashes or underscores.');
  if (password.length < 4) throw new Error('Passwords need at least 4 characters.');
  if ((displayName?.trim().length ?? 0) > 40) throw new Error('Display names can be up to 40 characters.');
  if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [username], c)) throw new UsernameTaken(username);
  const used = new Set((await q<{ plot_index: number }>('SELECT plot_index FROM students WHERE class_id=$1', [classId], c)).map((r) => r.plot_index));
  let plot = 0;
  while (used.has(plot)) plot++;
  if (plot >= MAX_PLOTS) throw new Error(`A class can hold up to ${MAX_PLOTS} students with personal plots.`);
  const user = await one<{ id: number }>(`INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'student') RETURNING id`,
    [username, await hashPassword(password), displayName?.trim() || username], c);
  await q('INSERT INTO students (user_id, class_id, plot_index, avatar_color) VALUES ($1,$2,$3,$4)', [user!.id, classId, plot, AVATAR_COLORS[plot % AVATAR_COLORS.length]], c);
  for (const [key, n] of Object.entries(STARTER_INVENTORY)) await addInventory(c, user!.id, BLOCK_BY_KEY[key].id, n);
  return user!.id;
}

/** Throws unless the teacher owns the class (admins may access any class). */
export async function assertClassAccess(c: PoolClient | undefined, user: { id: number; role: string }, classId: number) {
  const cls = await one('SELECT * FROM classes WHERE id=$1', [classId], c);
  if (!cls) throw Object.assign(new Error('Class not found.'), { status: 404 });
  if (user.role !== 'admin' && cls.teacher_id !== user.id) throw Object.assign(new Error('That class belongs to another teacher.'), { status: 403 });
  return cls;
}

export async function assertStudentAccess(user: { id: number; role: string }, studentId: number) {
  const s = await one('SELECT s.*, c.teacher_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.user_id=$1', [studentId]);
  if (!s) throw Object.assign(new Error('Student not found.'), { status: 404 });
  if (user.role !== 'admin' && s.teacher_id !== user.id) throw Object.assign(new Error('That student is not in your class.'), { status: 403 });
  return s;
}
