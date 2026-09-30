import { Router } from 'express';
import { z } from 'zod';
import { h, int, HttpError } from '../http.js';
import { q, one, tx } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { validUsername, assertClassAccess } from '../services/classes.js';
import { exportBackup, restoreBackup } from '../services/backup.js';
import { logActivity } from '../services/log.js';
import { hub } from '../services/hub.js';

export const adminRouter = Router();

/** Class data export is available to the class's teacher too. */
adminRouter.get('/classes/:classId/export', requireRole('teacher', 'admin'), h(async (req, res) => {
  await assertClassAccess(undefined, req.user!, int(req.params.classId));
  const data = await exportBackup({ classId: int(req.params.classId) });
  res.setHeader('Content-Disposition', `attachment; filename="class-${req.params.classId}-student-data.json"`);
  res.json(data);
}));

adminRouter.use(requireRole('admin'));

adminRouter.get('/teachers', h(async (_req, res) => {
  res.json(await q(`SELECT u.id, u.username, u.display_name, u.disabled, u.last_login_at, t.school,
    (SELECT count(*)::int FROM classes c WHERE c.teacher_id=u.id) classes FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE u.role='teacher' ORDER BY u.display_name`));
}));

const NewTeacher = z.object({ username: z.string().trim(), password: z.string().min(8, 'Teacher passwords need at least 8 characters.'), displayName: z.string().trim().min(1).max(60), school: z.string().trim().max(100).optional() });
adminRouter.post('/teachers', h(async (req, res) => {
  const v = NewTeacher.parse(req.body);
  if (!validUsername(v.username)) throw new HttpError(400, 'Usernames need 3-32 letters, numbers, dots, dashes or underscores.');
  if (await one('SELECT 1 FROM users WHERE lower(username)=lower($1)', [v.username])) throw new HttpError(400, 'That username is taken.');
  const id = await tx(async (c) => {
    const u = await one(`INSERT INTO users (username, password_hash, display_name, role) VALUES ($1,$2,$3,'teacher') RETURNING id`, [v.username, await hashPassword(v.password), v.displayName], c);
    await c.query('INSERT INTO teachers (user_id, school) VALUES ($1,$2)', [u.id, v.school ?? null]);
    await logActivity(req.user!.id, null, 'teacher_created', { username: v.username }, c);
    return u.id;
  });
  res.json({ id });
}));

adminRouter.patch('/users/:id', h(async (req, res) => {
  const v = z.object({ password: z.string().min(8).optional(), disabled: z.boolean().optional() }).parse(req.body);
  const id = int(req.params.id);
  if (v.password) { await q('UPDATE users SET password_hash=$2 WHERE id=$1', [id, await hashPassword(v.password)]); await q('DELETE FROM sessions WHERE user_id=$1', [id]); }
  if (v.disabled !== undefined) await q('UPDATE users SET disabled=$2 WHERE id=$1', [id, v.disabled]);
  if (v.password || v.disabled) hub.kick(id); // signed-out users leave the world right away
  await logActivity(req.user!.id, null, 'user_updated', { id, disabled: v.disabled, password: v.password ? '(reset)' : undefined });
  res.json({ ok: true });
}));

adminRouter.get('/overview', h(async (_req, res) => {
  res.json(await one(`SELECT (SELECT count(*)::int FROM users WHERE role='teacher') teachers, (SELECT count(*)::int FROM students) students,
    (SELECT count(*)::int FROM classes) classes, (SELECT count(*)::int FROM worlds) worlds, (SELECT count(*)::int FROM world_blocks) edits,
    (SELECT count(*)::int FROM questions) questions, (SELECT count(*)::int FROM student_answers) answers`));
}));

adminRouter.get('/backup', h(async (req, res) => {
  const data = await exportBackup();
  await logActivity(req.user!.id, null, 'backup_exported', {});
  res.setHeader('Content-Disposition', `attachment; filename="character-quest-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

adminRouter.post('/restore', h(async (req, res) => {
  const v = z.object({ confirm: z.literal('RESTORE'), backup: z.any() }).parse(req.body);
  await restoreBackup(v.backup);
  res.json({ ok: true, message: 'Backup restored. Everyone has been logged out.' });
}));

adminRouter.get('/activity', h(async (_req, res) => {
  res.json(await q(`SELECT l.*, u.display_name actor FROM activity_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT 300`));
}));
