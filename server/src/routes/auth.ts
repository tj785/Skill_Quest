import { Router } from 'express';
import { z } from 'zod';
import { h, HttpError } from '../http.js';
import { one, tx } from '../db.js';
import {
  checkPassword, createSession, destroySession, setSessionCookie, COOKIE, loginAllowed, recordLoginFailure, clearLoginFailures, hashPassword
} from '../auth.js';
import { addStudent, validUsername } from '../services/classes.js';
import { logActivity } from '../services/log.js';

export const authRouter = Router();

const Login = z.object({ username: z.string().trim().min(1, 'Enter your username.'), password: z.string().min(1, 'Enter your password.') });

authRouter.post('/login', h(async (req, res) => {
  const { username, password } = Login.parse(req.body);
  const k = `${username.toLowerCase()}|${req.ip}`;
  if (!loginAllowed(k)) throw new HttpError(429, 'Too many tries. Wait 10 minutes or ask your teacher to reset your password.');
  const u = await one('SELECT * FROM users WHERE lower(username)=lower($1)', [username]);
  if (!u || u.disabled || !(await checkPassword(password, u.password_hash))) {
    recordLoginFailure(k);
    throw new HttpError(401, 'That username and password do not match.');
  }
  clearLoginFailures(k);
  setSessionCookie(res, await createSession(u.id));
  res.json({ user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role } });
}));

authRouter.post('/logout', h(async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await destroySession(t);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

/** Public info for the login page: whether demo accounts exist and teacher sign-up is enabled. */
authRouter.get('/config', h(async (_req, res) => {
  const demo = !!(await one("SELECT 1 FROM users WHERE lower(username)='teacher' AND role='teacher'"));
  res.json({ demo: demo && (process.env.SEED_DEMO ?? 'true') === 'true', teacherSignup: !!process.env.TEACHER_SIGNUP_CODE });
}));

authRouter.get('/me', h(async (req, res) => {
  res.json({ user: req.user ?? null });
}));

const Join = z.object({
  joinCode: z.string().trim().min(4, 'Enter the class code from your teacher.'),
  username: z.string().trim(),
  password: z.string().min(4, 'Passwords need at least 4 characters.'),
  displayName: z.string().trim().max(40).optional()
});

/** Student creates their own account with a class join code. */
authRouter.post('/join', h(async (req, res) => {
  const v = Join.parse(req.body);
  const cls = await one('SELECT * FROM classes WHERE upper(join_code)=upper($1)', [v.joinCode]);
  if (!cls) throw new HttpError(404, 'No class has that code. Check it with your teacher.');
  const id = await tx(async (c) => {
    const uid = await addStudent(c, cls.id, v.username, v.password, v.displayName);
    await logActivity(uid, cls.id, 'student_joined', { username: v.username }, c);
    return uid;
  }).catch((e) => { throw new HttpError(400, e.message); });
  setSessionCookie(res, await createSession(id));
  res.json({ user: { id, username: v.username, role: 'student' } });
}));

const TeacherSignup = z.object({
  username: z.string().trim(),
  password: z.string().min(8, 'Teacher passwords need at least 8 characters.'),
  displayName: z.string().trim().min(1, 'Enter your name.').max(60),
  school: z.string().trim().max(100).optional(),
  signupCode: z.string().optional()
});

/** Teacher self-signup, allowed only when TEACHER_SIGNUP_CODE is set and matches. */
authRouter.post('/teacher-signup', h(async (req, res) => {
  const v = TeacherSignup.parse(req.body);
  const code = process.env.TEACHER_SIGNUP_CODE;
  if (!code) throw new HttpError(403, 'Teacher sign-up is turned off. Ask your administrator to create your account.');
  if (v.signupCode !== code) throw new HttpError(403, 'That teacher sign-up code is not right.');
  if (!validUsername(v.username)) throw new HttpError(400, 'Usernames need 3-32 letters, numbers, dots, dashes or underscores.');
  if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [v.username])) throw new HttpError(400, 'That username is taken.');
  const u = await tx(async (c) => {
    const row = await one(`INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'teacher') RETURNING id`, [v.username, await hashPassword(v.password), v.displayName], c);
    await c.query('INSERT INTO teachers (user_id, school) VALUES ($1,$2)', [row.id, v.school ?? null]);
    await logActivity(row.id, null, 'teacher_signup', { username: v.username }, c);
    return row;
  });
  setSessionCookie(res, await createSession(u.id));
  res.json({ user: { id: u.id, username: v.username, role: 'teacher' } });
}));
