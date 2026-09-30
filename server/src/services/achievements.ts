import type { PoolClient } from 'pg';
import { q } from '../db.js';

export interface AchievementSeed { key: string; name: string; description: string; criteria_type: string; criteria_subject?: string; threshold: number; xp_reward: number; coin_reward?: number; }

/** Built-in achievements added to every new class. Teachers can add their own. */
export const DEFAULT_ACHIEVEMENTS: AchievementSeed[] = [
  { key: 'first_steps', name: 'First Steps', description: 'Answer your first question.', criteria_type: 'questions_answered', threshold: 1, xp_reward: 10 },
  { key: 'builder', name: 'Builder', description: 'Place 100 blocks.', criteria_type: 'blocks_placed', threshold: 100, xp_reward: 50 },
  { key: 'master_builder', name: 'Master Builder', description: 'Place 500 blocks.', criteria_type: 'blocks_placed', threshold: 500, xp_reward: 150 },
  { key: 'mathematician', name: 'Mathematician', description: 'Answer 50 math questions correctly.', criteria_type: 'correct_in_subject', criteria_subject: 'Math', threshold: 50, xp_reward: 150 },
  { key: 'science_explorer', name: 'Science Explorer', description: 'Answer 25 science questions correctly.', criteria_type: 'correct_in_subject', criteria_subject: 'Science', threshold: 25, xp_reward: 100 },
  { key: 'bookworm', name: 'Bookworm', description: 'Answer 25 reading questions correctly.', criteria_type: 'correct_in_subject', criteria_subject: 'Reading', threshold: 25, xp_reward: 100 },
  { key: 'problem_solver', name: 'Problem Solver', description: 'Answer 20 difficult (level 3+) questions correctly.', criteria_type: 'hard_correct', threshold: 20, xp_reward: 200 },
  { key: 'quick_learner', name: 'Quick Learner', description: 'Answer 10 questions correctly.', criteria_type: 'correct_answers', threshold: 10, xp_reward: 40 },
  { key: 'task_master', name: 'Task Master', description: 'Complete 3 assignments.', criteria_type: 'assignments_completed', threshold: 3, xp_reward: 100 },
  { key: 'scholar', name: 'Scholar', description: 'Earn 5,000 XP.', criteria_type: 'xp_total', threshold: 5000, xp_reward: 0 }
];

export async function seedAchievements(c: PoolClient, classId: number) {
  for (const a of DEFAULT_ACHIEVEMENTS) {
    await q(`INSERT INTO achievements (class_id, key, name, description, criteria_type, criteria_subject, threshold, xp_reward, coin_reward)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [classId, a.key, a.name, a.description, a.criteria_type, a.criteria_subject ?? null, a.threshold, a.xp_reward, a.coin_reward ?? 0], c);
  }
}

/** Current value of a student's stat for an achievement criterion. */
export async function criterionValue(c: PoolClient, studentId: number, type: string, subject: string | null): Promise<number> {
  switch (type) {
    case 'questions_answered':
      return Number((await q(`SELECT count(DISTINCT question_id) n FROM student_answers WHERE student_id=$1`, [studentId], c))[0].n);
    case 'correct_answers':
      return Number((await q(`SELECT count(*) n FROM student_answers WHERE student_id=$1 AND rewarded`, [studentId], c))[0].n);
    case 'correct_in_subject':
      return Number((await q(`SELECT count(*) n FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE a.student_id=$1 AND a.rewarded AND lower(qu.subject)=lower($2)`, [studentId, subject ?? ''], c))[0].n);
    case 'hard_correct':
      return Number((await q(`SELECT count(*) n FROM student_answers a JOIN questions qu ON qu.id=a.question_id WHERE a.student_id=$1 AND a.rewarded AND qu.difficulty >= 3`, [studentId], c))[0].n);
    case 'blocks_placed':
      return Number((await q(`SELECT blocks_placed n FROM students WHERE user_id=$1`, [studentId], c))[0].n);
    case 'xp_total':
      return Number((await q(`SELECT xp n FROM students WHERE user_id=$1`, [studentId], c))[0].n);
    case 'assignments_completed':
      return Number((await q(`SELECT count(*) n FROM student_assignments WHERE student_id=$1`, [studentId], c))[0].n);
    default:
      return 0;
  }
}
