/**
 * In-page stand-in for Socket.IO: the real server realtime code (rooms, acks, middleware)
 * talks to the real game client through this, inside one browser tab.
 */
type Fn = (...a: any[]) => void;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const later = (f: () => void) => setTimeout(f, 0);

class Emitter {
  private h = new Map<string, Fn[]>();
  on(ev: string, f: Fn) { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)!).push(f); return this; }
  off(ev?: string, f?: Fn) { if (!ev) this.h.clear(); else if (!f) this.h.delete(ev); else this.h.set(ev, (this.h.get(ev) ?? []).filter((x) => x !== f)); return this; }
  fire(ev: string, ...a: any[]) { for (const f of [...(this.h.get(ev) ?? [])]) { try { f(...a); } catch (e) { console.error(e); } } }
}

let nextId = 1;
export class ServerSocket extends Emitter {
  id = `s${nextId++}`; data: any = {}; rooms = new Set<string>(); connected = true;
  constructor(public server: Server, public client: ClientSocket, public handshake: any) { super(); }
  emit(ev: string, d?: any) { if (this.connected) { const v = clone(d); later(() => this.client.deliver(ev, v)); } return true; }
  join(r: string | string[]) { for (const x of Array.isArray(r) ? r : [r]) this.rooms.add(x); }
  leave(r: string) { this.rooms.delete(r); }
  to(room: string) { return this.server.room(room, this); }
  get volatile() { return this; }
  disconnect(_close?: boolean) { if (!this.connected) return; this.connected = false; this.server.sockets.delete(this.id); this.fire('disconnect', 'server namespace disconnect'); later(() => this.client.deliver('disconnect', 'io server disconnect')); }
}

export class Server extends Emitter {
  sockets = new Map<string, ServerSocket>();
  private mw: ((s: ServerSocket, next: (e?: Error) => void) => void)[] = [];
  constructor(..._a: any[]) { super(); (globalThis as any).__cqIo = this; }
  use(f: (s: ServerSocket, next: (e?: Error) => void) => void) { this.mw.push(f); return this; }
  room(room: string, except?: ServerSocket) {
    const self = this;
    const target = { emit(ev: string, d?: any) { for (const s of self.sockets.values()) if (s !== except && s.rooms.has(room)) s.emit(ev, d); return true; }, get volatile() { return target; } };
    return target;
  }
  to(room: string) { return this.room(room); }
  in(room: string) { return this.room(room); }
  emit(ev: string, d?: any) { for (const s of this.sockets.values()) s.emit(ev, d); }
  accept(client: ClientSocket, handshake: any) {
    const s = new ServerSocket(this, client, handshake);
    let i = 0;
    const next = (e?: Error) => {
      if (e) { later(() => client.deliver('connect_error', { message: e.message })); return; }
      const f = this.mw[i++];
      if (f) { Promise.resolve(f(s, next)).catch((x) => next(x)); return; }
      this.sockets.set(s.id, s); s.join(s.id);
      client.server = s;
      later(() => client.deliver('connect'));
      this.fire('connection', s);
    };
    next();
  }
}

export class ClientSocket extends Emitter {
  server?: ServerSocket; connected = false; id = '';
  constructor(private opts: any) { super(); later(() => this.connect()); }
  connect() {
    const io: Server = (globalThis as any).__cqIo;
    if (!io) { setTimeout(() => this.connect(), 200); return; }
    const ready: Promise<void> = (globalThis as any).__cqReady ?? Promise.resolve();
    ready.then(() => io.accept(this, { headers: { cookie: this.opts?.noCookie ? '' : (globalThis as any).__cqCookieHeader?.() ?? '' }, auth: this.opts?.auth ?? {} }));
  }
  deliver(ev: string, d?: any) {
    if (ev === 'connect') { this.connected = true; this.id = this.server!.id; }
    if (ev === 'disconnect') this.connected = false;
    if (ev === 'connect_error') { this.fire(ev, Object.assign(new Error(d?.message ?? 'error'), d)); return; }
    this.fire(ev, d);
  }
  emit(ev: string, d?: any, ack?: Fn) {
    const s = this.server;
    if (!s || !s.connected) return this;
    const v = clone(d);
    const cb = ack ? (r: any) => { const rv = clone(r); later(() => ack(rv)); } : undefined;
    later(() => s.fire(ev, v, cb));
    return this;
  }
  get volatile() { return this; }
  disconnect() { const s = this.server; this.server = undefined; this.connected = false; if (s && s.connected) { s.connected = false; s.server.sockets.delete(s.id); s.fire('disconnect', 'client namespace disconnect'); } return this; }
  close() { return this.disconnect(); }
}

export function io(opts?: any) { return new ClientSocket(opts); }
export type Socket = any;
export default io;
