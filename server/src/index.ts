import http from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { migrate } from './db.js';
import { ensureAdmin, seedDemo } from './seed.js';
import { config } from './config.js';

async function main() {
  if (config.production && (config.sessionSecret === 'dev-secret' || config.sessionSecret.startsWith('change-me'))) {
    throw new Error('Set SESSION_SECRET to a long random value before running in production.');
  }
  await migrate();
  await ensureAdmin();
  if (config.seedDemo) await seedDemo();
  const server = http.createServer(createApp());
  attachRealtime(server);
  server.listen(config.port, () => console.log(`Character Quest running on http://localhost:${config.port}`));
  const stop = () => { console.log('Shutting down…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error('Failed to start Character Quest:', e.message);
  if (/ECONNREFUSED|password authentication|does not exist/.test(e.message)) console.error('Check DATABASE_URL in your .env file and that PostgreSQL is running.');
  process.exit(1);
});
