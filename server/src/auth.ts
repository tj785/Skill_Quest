import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { q, one } from './db.js';
import { config } from './config.js';

export const COOKIE = 'cq_session';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'teacher' | 'student';
  classId?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export async function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }
export async function checkPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }

function sha(token: string) { return crypto.createHash('sha256').update(token + config.sessionSecret).digest('hex'); }

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [sha(token), userId, String(config.sessionDays)]);
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return token;
}

export async function destroySession(token: string) { await q('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]); }

export async function userFromToken(token: string | undefined): Promise<AuthUser | undefined> {
  if (!token) return undefined;
  const row = await one(`
    SELECT u.id, u.username, u.display_name, u.role, s2.class_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN students s2 ON s2.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [sha(token)]);
  if (!row) return undefined;
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, classId: row.class_id ?? undefined };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: config.sessionDays * 86400_000, path: '/' });
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try { req.user = await userFromToken(req.cookies?.[COOKIE]); next(); } catch (e) { next(e); }
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}

/** Very small in-memory login rate limiter: 10 failed attempts per username+IP per 10 minutes. */
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(key: string): boolean {
  const a = attempts.get(key);
  return !a || a.until < Date.now() || a.n < 10;
}
export function recordLoginFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 600_000 });
  else a.n++;
}
export function clearLoginFailures(key: string) { attempts.delete(key); }
