/**
 * Single-file offline test build. Boots PostgreSQL (PGlite) in the page, runs the real
 * server routes and realtime code against it, then starts the normal game client.
 * Nothing is sent over the network; data is kept in this browser (IndexedDB).
 */
import { openDb, migrate, pool, flushDb, closeDb } from './db';
import { ensureAdmin, seedDemo } from '../server/src/seed.js';
import { Router } from './express';
import { Server, ClientSocket } from './socketio';
import { loadUser, COOKIE, createSession, userFromToken } from '../server/src/auth.js';
import { errorHandler } from '../server/src/http.js';
import { authRouter } from '../server/src/routes/auth.js';
import { studentRouter } from '../server/src/routes/student.js';
import { teacherRouter } from '../server/src/routes/teacher.js';
import { adminRouter } from '../server/src/routes/admin.js';
import { attachRealtime } from '../server/src/realtime.js';
import { SPAWN, CHAT_PRESETS } from '@cq/shared';

const DB_NAME = 'character-quest-test';
const T0 = performance.now();
const status = (t: string) => { console.info(`[offline ${Math.round(performance.now() - T0)}ms] ${t}`); const el = document.getElementById('cq-boot-status'); if (el) el.textContent = t; };

/* ---------------- cookie jar (stands in for the browser's httpOnly cookie) ---------------- */
const JAR_KEY = 'cq_offline_cookie';
let jar: Record<string, string> = {};
try { jar = JSON.parse(localStorage.getItem(JAR_KEY) || '{}'); } catch { /* storage off: session lasts until reload */ }
const saveJar = () => { try { localStorage.setItem(JAR_KEY, JSON.stringify(jar)); } catch { /* ignore */ } };
(globalThis as any).__cqCookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

async function decode(id: string): Promise<Blob> {
  const b64 = document.getElementById(id)!.textContent!.trim();
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).blob();
}

let app: ReturnType<typeof Router>;
let resolveReady!: () => void;
const ready = new Promise<void>((r) => (resolveReady = r));
(globalThis as any).__cqReady = ready;

async function boot() {
  status('Starting the database…');
  const [wasm, data] = await Promise.all([decode('cq-pg-wasm'), decode('cq-pg-data')]);
  const wasmModule = await WebAssembly.compile(await wasm.arrayBuffer());
  let persistent = true;
  try { await openDb({ dataDir: `idb://${DB_NAME}`, wasmModule, fsBundle: data }); }
  catch (e) { console.warn('IndexedDB unavailable, using a temporary in-memory database', e); persistent = false; await openDb({ wasmModule, fsBundle: data }); }
  status('Setting up tables…');
  await migrate(false);
  status('Creating the demo class (first run takes a few seconds)…');
  await ensureAdmin();
  await seedDemo({ quiet: true });
  await flushDb(); // the first run writes a lot; make sure it is all saved before anything else happens

  app = Router();
  app.use(loadUser);
  app.get('/api/health', async (_q: any, res: any) => res.json({ ok: true, offline: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/student', studentRouter);
  app.use('/api/teacher', teacherRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_q: any, res: any) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', errorHandler);
  attachRealtime(null, new Server());
  (globalThis as any).__cqOffline = { persistent };
  status('Ready');
  resolveReady();
  startBots();
  addBanner(persistent);
}

/* ---------------- fetch → in-page server ---------------- */
const realFetch = window.fetch.bind(window);
window.fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  await ready;
  const u = new URL(url, 'http://offline.local');
  const method = (init.method || 'GET').toUpperCase();
  let body: any = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch { body = init.body; } }
  return new Promise<Response>((resolve) => {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    const res: any = {
      finished: false, locals: {},
      status(n: number) { statusCode = n; return res; },
      setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
      set(k: string, v: string) { return res.setHeader(k, v); },
      cookie(name: string, value: string) { jar[name] = value; saveJar(); return res; },
      clearCookie(name: string) { delete jar[name]; saveJar(); return res; },
      json(obj: unknown) { headers['content-type'] ??= 'application/json'; return res.send(JSON.stringify(obj)); },
      send(text: string) {
        if (res.finished) return res;
        res.finished = true;
        resolve(new Response(typeof text === 'string' ? text : JSON.stringify(text), { status: statusCode, headers }));
        return res;
      }
    };
    const req: any = {
      method, path: u.pathname, originalUrl: u.pathname + u.search, url: u.pathname + u.search, query: Object.fromEntries(u.searchParams),
      body, params: {}, ip: 'offline', headers: { 'content-type': 'application/json' }, cookies: { ...jar }, get: () => undefined
    };
    app(req, res, (err?: any) => {
      if (err) errorHandler(err, req, res, () => {});
      else res.status(404).json({ error: 'Not found' });
    });
  });
};

/* ---------------- simulated classmates so multiplayer can be tried in one tab ---------------- */
let botsOn = (() => { try { return localStorage.getItem('cq_offline_bots') !== 'off'; } catch { return true; } })();
const bots: { sock: ClientSocket | null; userId: number; name: string; x: number; z: number; t: number; dir: number }[] = [];
async function currentUserId() { const u = await userFromToken(jar[COOKIE]); return u?.id; }
async function startBots() {
  const rows = (await pool.query(`SELECT u.id, u.display_name FROM users u WHERE u.username IN ('sam','taylor') ORDER BY u.id`)).rows as any[];
  for (const r of rows) bots.push({ sock: null, userId: r.id, name: r.display_name, x: SPAWN.x + (bots.length ? 3 : -3), z: SPAWN.z + 3, t: 0, dir: Math.random() * 6 });
  setInterval(tickBots, 200);
}
let ticking = false;
async function tickBots() {
  if (ticking) return;
  ticking = true;
  try { await tickBotsOnce(); } catch (e) { console.warn(e); } finally { ticking = false; }
}
async function tickBotsOnce() {
  const me = await currentUserId();
  for (const b of bots) {
    const want = botsOn && me !== undefined && me !== b.userId;
    if (!want) { if (b.sock) { b.sock.disconnect(); b.sock = null; } continue; }
    if (!b.sock) {
      await pool.query('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [b.userId, b.x, SPAWN.y, b.z]);
      const token = await createSession(b.userId);
      b.sock = new ClientSocket({ auth: { token }, noCookie: true });
      b.sock.on('teleport', (p: any) => { b.x = p.x; b.z = p.z; });
      continue;
    }
    if (!b.sock.connected) continue;
    b.t++;
    if (b.t % 25 === 0) b.dir += (Math.random() - 0.5) * 2;
    const nx = b.x + Math.cos(b.dir) * 0.35, nz = b.z + Math.sin(b.dir) * 0.35;
    // Wander around the village square without leaving it.
    if (Math.hypot(nx - SPAWN.x, nz - SPAWN.z) > 9) { b.dir += Math.PI; continue; }
    b.x = nx; b.z = nz;
    b.sock.emit('move', { x: b.x, y: SPAWN.y, z: b.z, yaw: -b.dir - Math.PI / 2 });
    if (b.t % 300 === 150) b.sock.emit('chat', { text: CHAT_PRESETS[Math.floor(Math.random() * CHAT_PRESETS.length)] }, () => {});
  }
}

/* ---------------- banner: switch user, bots, reset ---------------- */
function addBanner(persistent: boolean) {
  const el = document.createElement('div');
  el.className = 'offline-banner collapsed';
  el.innerHTML = `<button type="button" data-toggle aria-expanded="false">🧪 Test tools</button>
    <b>Offline test build</b>
    <span>${persistent ? 'Progress is saved in this browser.' : 'Temporary: progress resets when you close the tab.'}</span>
    <label>Log in as <select aria-label="Log in as a demo account">
      <option value="">choose…</option><option>teacher</option><option>alex</option><option>jordan</option><option>sam</option><option>taylor</option><option>admin</option></select></label>
    <label><input type="checkbox" ${botsOn ? 'checked' : ''}/> Simulated classmates</label>
    <button type="button" data-reset>Reset demo data</button>
    <button type="button" data-hide aria-label="Hide the test tools">Hide</button>`;
  document.body.appendChild(el);
  el.querySelector('select')!.addEventListener('change', async (e) => {
    const u = (e.target as HTMLSelectElement).value;
    if (!u) return;
    const password = u === 'teacher' ? 'teacher123' : u === 'admin' ? 'admin123' : 'quest123';
    const r = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    await closeDb(); // closing saves everything (including the new session) before the page reloads
    location.hash = u === 'teacher' ? '#/teacher' : u === 'admin' ? '#/admin' : '#/play';
    location.reload();
  });
  el.querySelector('input')!.addEventListener('change', (e) => {
    botsOn = (e.target as HTMLInputElement).checked;
    try { localStorage.setItem('cq_offline_bots', botsOn ? 'on' : 'off'); } catch { /* ignore */ }
  });
  el.querySelector('[data-reset]')!.addEventListener('click', async () => {
    if (!confirm('Erase everything in this test build and start again with the demo class?')) return;
    jar = {}; saveJar();
    try { localStorage.removeItem('cq_class'); } catch { /* ignore */ }
    await closeDb();
    await new Promise((r) => { const q = indexedDB.deleteDatabase(`/pglite/${DB_NAME}`); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
    location.hash = '';
    location.reload();
  });
  el.querySelector('[data-hide]')!.addEventListener('click', () => el.remove());
  const tg = el.querySelector('[data-toggle]') as HTMLButtonElement;
  tg.addEventListener('click', () => { const open = el.classList.toggle('collapsed') === false; tg.setAttribute('aria-expanded', String(open)); });
  // Flush pending writes when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDb(); });
}

boot().catch((e) => {
  console.error(e);
  status(`Could not start: ${e?.message ?? e}. Try Chrome, Edge or Firefox (a current version).`);
});

// The normal client.
import '../client/src/main';
