import { q, Queryable, pool } from '../db.js';

/** Record an important action (teacher/admin changes, moderation, rewards) in activity_logs. */
export async function logActivity(actorId: number | null, classId: number | null, action: string, details: Record<string, unknown> = {}, db: Queryable = pool) {
  await q('INSERT INTO activity_logs (actor_id, class_id, action, details) VALUES ($1, $2, $3, $4)', [actorId, classId, action, JSON.stringify(details)], db);
}
