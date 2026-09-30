import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { teacherRouter } from './routes/teacher.js';
import { adminRouter } from './routes/admin.js';
import { q } from './db.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:']
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.use(loadUser);

  app.get('/api/health', async (_req, res) => {
    try { await q('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false, error: 'Database unavailable' }); }
  });
  app.use('/api/auth', authRouter);
  app.use('/api/student', studentRouter);
  app.use('/api/teacher', teacherRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', errorHandler);

  // Serve the built client (npm run build) for everything else.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = [path.join(here, '../../client/dist'), path.join(process.cwd(), 'client/dist'), path.join(process.cwd(), '../client/dist')].find((p) => fs.existsSync(p));
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Client not built yet. Run "npm run build", or use "npm run dev" and open the Vite dev server.'));
  }
  app.use(errorHandler);
  return app;
}
