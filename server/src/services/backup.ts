/**
 * JSON backup / restore of every game table. Complements (does not replace) regular pg_dump backups.
 * Tables are listed parents-first so restore can insert in order.
 */
import { q, tx } from '../db.js';
import { invalidateWorld } from './world.js';

export const BACKUP_TABLES = [
  'users', 'teachers', 'worlds', 'classes', 'students', 'inventory', 'skills', 'student_skills', 'questions', 'question_answers',
  'student_answers', 'assignments', 'assignment_questions', 'assignment_students', 'student_assignments', 'achievements',
  'student_achievements', 'world_blocks', 'project_zones', 'activity_logs',
  'build_submissions', 'messages', 'student_items', 'quests', 'quest_steps', 'student_quests', 'events', 'event_contributions'
];

export async function exportBackup(opts: { classId?: number } = {}) {
  const data: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) data[t] = await q(`SELECT * FROM ${t}`);
  if (opts.classId) {
    // Narrow to one class (for "export student data").
    const cls = (data.classes as any[]).filter((c) => c.id === opts.classId);
    const studentIds = new Set((data.students as any[]).filter((s) => s.class_id === opts.classId).map((s) => s.user_id));
    return {
      exportedAt: new Date().toISOString(), class: cls[0],
      students: (data.users as any[]).filter((u) => studentIds.has(u.id)).map(({ password_hash, ...u }) => ({
        ...u,
        progress: (data.students as any[]).find((s) => s.user_id === u.id),
        inventory: (data.inventory as any[]).filter((i) => i.student_id === u.id),
        skills: (data.student_skills as any[]).filter((i) => i.student_id === u.id),
        achievements: (data.student_achievements as any[]).filter((i) => i.student_id === u.id),
        answers: (data.student_answers as any[]).filter((i) => i.student_id === u.id)
      }))
    };
  }
  return { format: 'character-quest-backup', version: 1, exportedAt: new Date().toISOString(), tables: data };
}

export async function restoreBackup(backup: any) {
  if (backup?.format !== 'character-quest-backup' || !backup.tables) throw Object.assign(new Error('This file is not a Character Quest full backup.'), { status: 400 });
  await tx(async (c) => {
    await c.query(`TRUNCATE ${[...BACKUP_TABLES].reverse().join(', ')}, sessions RESTART IDENTITY CASCADE`);
    for (const t of BACKUP_TABLES) {
      const rows = backup.tables[t] as Record<string, unknown>[] | undefined;
      if (!rows?.length) continue;
      const cols = Object.keys(rows[0]);
      for (const r of rows) {
        const vals = cols.map((k) => (r[k] !== null && typeof r[k] === 'object' && !(r[k] instanceof Date) ? JSON.stringify(r[k]) : r[k]));
        await c.query(`INSERT INTO ${t} (${cols.map((k) => `"${k}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
      }
      // Move sequences past restored ids.
      if (cols.includes('id')) await c.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT max(id) FROM ${t}), 1))`);
    }
  });
  for (const w of (backup.tables.worlds as any[]) ?? []) invalidateWorld(w.id);
}
