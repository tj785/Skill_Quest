/**
 * Real-time multiplayer over Socket.IO. The server is authoritative:
 * positions are sanity-checked, region locks enforced, every block edit goes
 * through services/world.ts (permissions + inventory + persistence), chat is
 * filtered and moderated, and blocks waiting for teacher approval are only
 * shown to their builder and teachers.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { userFromToken, COOKIE } from './auth.js';
import { one, q, tx } from './db.js';
import { loadWorld, editsList, placeBlock, removeBlock, EditError, blockAt } from './services/world.js';
import { hub } from './services/hub.js';
import { recordGameEvent } from './services/progress.js';
import { announceEvent } from './services/questions.js';
import { studentLook } from './services/shop.js';
import {
  PlayerState, SPAWN, regionAt, REGIONS, WORLD_SIZE, WORLD_HEIGHT, ClientToServer, ServerToClient, CHAT_PRESETS, filterChat, BlockEdit, RegionKey
} from '@cq/shared';

interface Conn {
  socket: Socket<ClientToServer, ServerToClient>;
  userId: number;
  role: PlayerState['role'];
  classId: number;
  worldId: number;
  state: PlayerState;
  lastMoveAt: number;
  lastSafe: { x: number; y: number; z: number };
  editTimes: number[];
  lastChatAt: number;
  region?: RegionKey;
  /** Cached permission flags, refreshed every few seconds instead of on every movement packet. */
  flags: { frozen: boolean; level: number; unlockAll: boolean; at: number };
  /** Movement allowance in blocks (refills over time), so the server can reject speed hacks and teleports. */
  budget: { h: number; up: number; at: number };
  moveChain: Promise<void>;
}

/* Movement limits. Running is 6.5 blocks/s; the budget allows short bursts from packet bunching but not sustained speed. */
const MOVE_RATE = 8, MOVE_CAP = 6, UP_RATE = 11, UP_CAP = 2.2;
/** Per-user limits (shared by all of a user's connections, so opening more sockets doesn't help). */
const editTimesOf = new Map<number, number[]>();
const lastChatOf = new Map<number, number>();

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  }
  return out;
}

/** Attach multiplayer to an HTTP server (or to an already-created Socket.IO-compatible server, as the offline test build does). */
export function attachRealtime(server: HttpServer | any, existingIo?: any) {
  const io: Server<ClientToServer, ServerToClient> = existingIo ?? new Server(server, { path: '/socket.io', cors: { origin: false } });
  const conns = new Map<string, Conn>(); // socket.id -> conn
  const socketsOfUser = new Map<number, Set<string>>();
  const inWorld = (worldId: number) => [...conns.values()].filter((c) => c.worldId === worldId);

  /** Send a block change to everyone who may see it. Pending blocks go only to the builder and teachers. */
  const broadcastEdit = (worldId: number, edit: BlockEdit, by: number) => {
    for (const c of inWorld(worldId)) {
      if (edit.pending && c.role === 'student' && c.userId !== by) continue;
      c.socket.emit('blockChanged', { ...edit, by });
    }
  };

  hub.register({
    toUser: (uid, ev, data) => {
      if (ev === 'teleport' || ev === 'frozen' || ev === 'progress') {
        for (const sid of socketsOfUser.get(uid) ?? []) {
          const c = conns.get(sid);
          if (!c) continue;
          if (ev === 'teleport') { const p = data as { x: number; y: number; z: number }; Object.assign(c.state, p); c.lastSafe = { ...p }; }
          c.flags.at = 0; // re-read frozen / level on next move
        }
      }
      if (ev === 'blockBatchFor') {
        // Approved/rejected pending blocks: approvals go to everyone; rejections only to the builder and teachers.
        const d = data as { worldId: number; edits: BlockEdit[]; everyone: boolean; owner: number };
        for (const c of inWorld(d.worldId)) if (d.everyone || c.role !== 'student' || c.userId === d.owner) c.socket.emit('blockBatch', { edits: d.edits });
        return;
      }
      io.to(`user:${uid}`).emit(ev as any, data as any);
    },
    toClass: (cid, ev, data) => { io.to(`class:${cid}`).emit(ev as any, data as any); },
    kick: (uid) => { for (const sid of socketsOfUser.get(uid) ?? []) conns.get(sid)?.socket.disconnect(true); },
    resetWorld: async (worldId) => {
      const w = await loadWorld(worldId);
      for (const c of inWorld(worldId)) c.socket.emit('blocksReset', { edits: editsList(w, { userId: c.userId, role: c.role }) });
    },
    updateLook: async (uid) => {
      const look = await studentLook(uid);
      const s = await one('SELECT level FROM students WHERE user_id=$1', [uid]);
      for (const sid of socketsOfUser.get(uid) ?? []) {
        const c = conns.get(sid);
        if (!c) continue;
        c.state.look = look; c.state.level = s?.level ?? c.state.level;
        io.to(`world:${c.worldId}`).emit('playerUpdated', { id: uid, look, level: c.state.level });
      }
    },
    chatConfig: async (cid) => {
      const cls = await one('SELECT chat_mode FROM classes WHERE id=$1', [cid]);
      for (const c of conns.values()) {
        if (c.classId !== cid) continue;
        const muted = c.role === 'student' ? !!(await one('SELECT muted FROM students WHERE user_id=$1', [c.userId]))?.muted : false;
        c.socket.emit('chatConfig', { mode: cls?.chat_mode ?? 'off', muted });
      }
    }
  });

  io.use(async (socket: any, next: (e?: Error) => void) => {
    try {
      const user = await userFromToken(parseCookies(socket.handshake.headers?.cookie)[COOKIE] ?? socket.handshake.auth?.token);
      if (!user) return next(new Error('Please log in again.'));
      socket.data.user = user;
      next();
    } catch (e) { next(e as Error); }
  });

  io.on('connection', async (socket: Socket<ClientToServer, ServerToClient>) => {
    const user = (socket.data as any).user as NonNullable<Awaited<ReturnType<typeof userFromToken>>>;
    try {
      let classId: number, color = '#f2c230', level = 1;
      let pos = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };
      if (user.role === 'student') {
        const s = await one('SELECT * FROM students WHERE user_id=$1', [user.id]);
        classId = s.class_id; color = s.avatar_color; level = s.level;
        if (s.pos_x !== null && s.pos_y > 0) pos = { x: s.pos_x, y: s.pos_y, z: s.pos_z };
        else pos = { x: SPAWN.x + (Math.random() * 5 - 2.5), y: SPAWN.y, z: SPAWN.z + Math.random() * 3 }; // spread new players out
        if (s.frozen) socket.emit('frozen', { frozen: true });
      } else {
        classId = Number(socket.handshake.auth?.classId);
        if (!Number.isInteger(classId) || classId <= 0) { socket.emit('toast', { kind: 'error', text: 'Open the world from your dashboard so we know which class to enter.' }); socket.disconnect(true); return; }
        const cls = await one('SELECT * FROM classes WHERE id=$1', [classId]);
        if (!cls || (user.role !== 'admin' && cls.teacher_id !== user.id)) { socket.emit('toast', { kind: 'error', text: 'Pick one of your classes first.' }); socket.disconnect(true); return; }
      }
      const cls = await one('SELECT world_id, chat_mode FROM classes WHERE id=$1', [classId]);
      const world = await loadWorld(cls.world_id);
      const look = user.role === 'student' ? await studentLook(user.id) : { title: 'Teacher' };
      const state: PlayerState = { id: user.id, name: user.displayName, ...pos, yaw: 0, color, role: user.role, level, look };
      const conn: Conn = { socket, userId: user.id, role: user.role, classId, worldId: world.id, state, lastMoveAt: Date.now(), lastSafe: { ...pos }, editTimes: [], lastChatAt: 0,
        flags: { frozen: false, level, unlockAll: false, at: 0 }, budget: { h: MOVE_CAP, up: UP_CAP, at: Date.now() }, moveChain: Promise.resolve() };
      conns.set(socket.id, conn);
      if (!socketsOfUser.has(user.id)) socketsOfUser.set(user.id, new Set());
      socketsOfUser.get(user.id)!.add(socket.id);
      socket.join([`world:${world.id}`, `class:${classId}`, `user:${user.id}`]);

      const others = inWorld(world.id).filter((c) => c.userId !== user.id).map((c) => c.state);
      const players = [...new Map(others.map((p) => [p.id, p])).values()];
      const muted = user.role === 'student' ? !!(await one('SELECT muted FROM students WHERE user_id=$1', [user.id]))?.muted : false;
      // No awaits from here until the handlers below are attached, or events the client sends right after "welcome" would be lost.
      socket.emit('welcome', { you: state, players, seed: world.seed, edits: editsList(world, { userId: user.id, role: user.role }), worldId: world.id });
      socket.to(`world:${world.id}`).emit('playerJoined', state);
      socket.emit('chatConfig', { mode: cls.chat_mode, muted });

      // Moves are handled one at a time per connection so the checks below always see the latest position.
      socket.on('move', (d) => { conn.moveChain = conn.moveChain.then(() => handleMove(d)).catch((e) => console.error(e)); });
      const handleMove = async (d: any) => {
        if (!d || ![d.x, d.y, d.z, d.yaw].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
        const now = Date.now();
        const dt = Math.max(0.05, (now - conn.lastMoveAt) / 1000);
        conn.lastMoveAt = now;
        const x = Math.min(WORLD_SIZE - 0.5, Math.max(0.5, d.x)), z = Math.min(WORLD_SIZE - 0.5, Math.max(0.5, d.z));
        const y = Math.min(WORLD_HEIGHT + 20, Math.max(-5, d.y));
        const dist = Math.hypot(x - conn.state.x, z - conn.state.z);
        const region = regionAt(Math.floor(x), Math.floor(z));
        if (conn.role === 'student') {
          if (now - conn.flags.at > 3000) {
            const f = await one(`SELECT s.frozen, s.level, c.unlock_all_regions FROM students s JOIN classes c ON c.id=s.class_id WHERE s.user_id=$1`, [conn.userId]);
            conn.flags = { frozen: !!f?.frozen, level: f?.level ?? 1, unlockAll: !!f?.unlock_all_regions, at: now };
          }
          const rdef = REGIONS[region];
          conn.state.level = conn.flags.level;
          // Movement budget: horizontal and upward distance refill with time up to a small cap.
          const b = conn.budget;
          const el = Math.min(2, (now - b.at) / 1000);
          b.at = now;
          b.h = Math.min(MOVE_CAP, b.h + el * MOVE_RATE);
          b.up = Math.min(UP_CAP, b.up + el * UP_RATE);
          const rise = Math.max(0, y - conn.state.y);
          const tooFast = dist > b.h + 0.25 || rise > b.up + 0.25;
          let floating = false;
          if (!tooFast && rise > 0.05) {
            // Going up with nothing underneath (within a jump's height) means flying.
            const w = await loadWorld(conn.worldId);
            floating = true;
            for (let dx = -1; dx <= 1 && floating; dx++) for (let dz = -1; dz <= 1 && floating; dz++)
              for (let yy = Math.floor(y); yy >= Math.floor(y) - 3; yy--) if (blockAt(w, Math.floor(x) + dx, yy, Math.floor(z) + dz) !== 0) { floating = false; break; }
          }
          if (conn.flags.frozen || tooFast || floating) { socket.emit('teleport', { ...conn.lastSafe }); Object.assign(conn.state, conn.lastSafe); return; }
          b.h -= dist; b.up -= rise;
          if (!conn.flags.unlockAll && conn.state.level < rdef.minLevel) {
            socket.emit('teleport', { ...conn.lastSafe });
            socket.emit('toast', { kind: 'info', text: `${rdef.name} unlocks at level ${rdef.minLevel}. Answer questions to level up.` });
            return;
          }
          if (region !== conn.region) {
            conn.region = region;
            // "Visit a region" quest steps.
            tx((c) => recordGameEvent(c, conn.userId, conn.classId, { type: 'region_visit', region }))
              .then((r) => { for (const n of r.notices) socket.emit('toast', n); if (r.changed) socket.emit('questUpdate'); if (r.rewards.length) hub.toUser(conn.userId, 'progress', {}); })
              .catch((e) => console.error(e));
          }
        }
        conn.state.x = x; conn.state.y = y; conn.state.z = z; conn.state.yaw = d.yaw;
        if (y > 1) conn.lastSafe = { x, y, z };
        socket.to(`world:${conn.worldId}`).volatile.emit('playerMoved', { id: conn.userId, x, y, z, yaw: d.yaw });
      };

      const rateOk = () => {
        const now = Date.now();
        const times = (editTimesOf.get(conn.userId) ?? []).filter((t) => now - t < 1000);
        editTimesOf.set(conn.userId, times);
        if (times.length >= 12) return false;
        times.push(now); return true;
      };

      socket.on('place', async (d, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!rateOk()) return reply({ ok: false, error: 'Slow down a little.' });
        try {
          const r = await placeBlock(conn.worldId, { userId: conn.userId, role: conn.role, classId: conn.classId, pos: conn.state }, d?.x, d?.y, d?.z, d?.b);
          broadcastEdit(conn.worldId, r.edit, conn.userId);
          if (r.inventory) socket.emit('inventory', { items: r.inventory });
          for (const n of r.notices) socket.emit('toast', n);
          if (r.progressChanged) socket.emit('questUpdate');
          if (r.notices.length) hub.toUser(conn.userId, 'progress', {});
          reply({ ok: true });
          if (r.eventDone) await announceEvent(r.eventDone);
        } catch (e: any) {
          reply({ ok: false, error: e instanceof EditError ? e.message : 'Could not place that block.' });
          if (!(e instanceof EditError)) console.error(e);
        }
      });

      socket.on('remove', async (d, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!rateOk()) return reply({ ok: false, error: 'Slow down a little.' });
        try {
          const r = await removeBlock(conn.worldId, { userId: conn.userId, role: conn.role, classId: conn.classId, pos: conn.state }, d?.x, d?.y, d?.z);
          broadcastEdit(conn.worldId, r.wasPending ? { ...r.edit, pending: true } : r.edit, conn.userId);
          if (r.inventory) socket.emit('inventory', { items: r.inventory });
          if (r.message) socket.emit('toast', { kind: 'info', text: r.message });
          reply({ ok: true });
        } catch (e: any) {
          reply({ ok: false, error: e instanceof EditError ? e.message : 'Could not remove that block.' });
          if (!(e instanceof EditError)) console.error(e);
        }
      });

      socket.on('chat', async (d, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const text = String(d?.text ?? '').trim();
          if (!text) return reply({ ok: false, error: 'Type a message first.' });
          const c2 = await one('SELECT chat_mode FROM classes WHERE id=$1', [conn.classId]);
          const teacher = conn.role !== 'student';
          if (!teacher) {
            if (c2.chat_mode === 'off') return reply({ ok: false, error: 'Chat is turned off by your teacher.' });
            const st = await one('SELECT muted FROM students WHERE user_id=$1', [conn.userId]);
            if (st?.muted) return reply({ ok: false, error: 'Your teacher has muted your chat for now.' });
            if (Date.now() - (lastChatOf.get(conn.userId) ?? 0) < 3000) return reply({ ok: false, error: 'Wait a few seconds between messages.' });
            if (c2.chat_mode === 'preset' && !CHAT_PRESETS.includes(text)) return reply({ ok: false, error: 'Pick one of the safe phrases.' });
          }
          conn.lastChatAt = Date.now(); lastChatOf.set(conn.userId, conn.lastChatAt);
          const clean = teacher || c2.chat_mode === 'preset' ? text.slice(0, 300) : filterChat(text);
          if (!clean) return reply({ ok: false, error: 'Type a message first.' });
          const m = await one(`INSERT INTO messages (class_id, user_id, text, original) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [conn.classId, conn.userId, clean, clean === text ? null : text]);
          io.to(`class:${conn.classId}`).emit('chat', { id: Number(m.id), userId: conn.userId, name: user.displayName, role: conn.role, text: clean, at: new Date(m.created_at).toISOString() });
          reply({ ok: true });
        } catch (e) { console.error(e); reply({ ok: false, error: 'Message could not be sent.' }); }
      });

      const savePos = async () => {
        if (conn.role === 'student') await q('UPDATE students SET pos_x=$2, pos_y=$3, pos_z=$4 WHERE user_id=$1', [conn.userId, conn.lastSafe.x, conn.lastSafe.y, conn.lastSafe.z]).catch(() => {});
      };
      const timer = setInterval(savePos, 30_000);
      socket.on('disconnect', async () => {
        clearInterval(timer);
        conns.delete(socket.id);
        socketsOfUser.get(user.id)?.delete(socket.id);
        await savePos();
        if (!inWorld(conn.worldId).some((c) => c.userId === user.id)) io.to(`world:${conn.worldId}`).emit('playerLeft', { id: user.id });
      });
    } catch (e) {
      console.error(e);
      socket.disconnect(true);
    }
  });

  return io;
}
