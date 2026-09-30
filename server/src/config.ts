import 'dotenv/config';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgres://cq:cqpass@localhost:5432/character_quest'),
  /** Set DATABASE_SSL=true for hosted databases that require an encrypted connection. */
  databaseSsl: process.env.DATABASE_SSL === 'true',
  port: Number(env('PORT', '3000')),
  production: process.env.NODE_ENV === 'production',
  sessionDays: Number(env('SESSION_DAYS', '14')),
  seedDemo: (process.env.SEED_DEMO ?? 'true') === 'true',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: env('SESSION_SECRET', 'dev-secret')
};
