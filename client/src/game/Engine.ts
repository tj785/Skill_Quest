/**
 * The 3D voxel world: chunk storage + meshing, first/third-person player with
 * collision, block targeting, other players, and landmark labels.
 * The engine never changes the world by itself: it asks the server (via callbacks)
 * and applies changes only when the server broadcasts them.
 */
import * as THREE from 'three';
import {
  BLOCK_BY_ID, BLOCK_BY_KEY, CHUNK, WORLD_SIZE, WORLD_HEIGHT, generateChunk, baseBlock, BlockEdit, PlayerState, LANDMARKS, regionAt, RegionKey, Look
} from '@cq/shared';
import { buildAtlas, Atlas, ATLAS_COLS, TILE } from './textures';

const CHUNKS = WORLD_SIZE / CHUNK;
const WATER = BLOCK_BY_KEY.water.id;

const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, face: 'side' as const, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.78, face: 'side' as const, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.55, face: 'bottom' as const, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, face: 'top' as const, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.68, face: 'side' as const, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.88, face: 'side' as const, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] }
];

export interface EngineCallbacks {
  onMove: (p: { x: number; y: number; z: number; yaw: number }) => void;
  requestPlace: (x: number, y: number, z: number) => void;
  requestRemove: (x: number, y: number, z: number) => void;
  onRegion: (r: RegionKey) => void;
  onNearQuestCenter: (near: boolean) => void;
  onPointerLock: (locked: boolean) => void;
  onHotbarKey: (i: number) => void;
  onHotbarScroll: (d: number) => void;
  onHotkey: (key: string) => void;
  /** A short tip for the player (e.g. why a block could not be placed). */
  onHint?: (text: string) => void;
}

interface Remote { group: THREE.Group; target: THREE.Vector3; yaw: number; state: PlayerState; }

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400);
  readonly atlas: Atlas;
  private chunks = new Map<number, Uint8Array>();
  private meshes = new Map<number, THREE.Group>();
  private dirty = new Set<number>();
  private opaqueMat: THREE.MeshBasicMaterial;
  private transMat: THREE.MeshBasicMaterial;
  private highlight: THREE.LineSegments;
  private remotes = new Map<number, Remote>();
  private keys = new Set<string>();
  private raf = 0;
  private last = performance.now();
  private lastSent = 0;
  private lastRegion?: RegionKey;
  private nearQuest = false;
  private clouds: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  frozen = false;
  flying = false;
  canFly = false;
  thirdPerson = false;
  sensitivity = 1;
  invertY = false;
  target: { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null = null;
  inputEnabled = true;
  /** Touch devices: on-screen joystick + drag-to-look instead of pointer lock. */
  touchMode = false;
  /** Joystick vector from the touch UI (x = strafe, z = forward/back, -1..1). */
  touchMove = { x: 0, z: 0 };
  touchJump = false;
  /** Blocks waiting for teacher approval (drawn with a gold tint). Keys are "x,y,z". */
  private pending = new Set<string>();
  /** Every server edit currently applied ("x,y,z" -> block), so a reset can change only what differs. */
  private edits = new Map<string, number>();
  private self?: THREE.Group;
  private selfState?: PlayerState;
  /** Minimap data: top block id per column. */
  readonly topBlock = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
  readonly topHeight = new Uint8Array(WORLD_SIZE * WORLD_SIZE);

  constructor(private container: HTMLElement, private seed: number, private cb: EngineCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Game world. Click to control your character.');
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new THREE.Color('#8ccaf5');
    this.scene.fog = new THREE.Fog('#a9d8f7', 60, 150);
    this.atlas = buildAtlas();
    this.opaqueMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true });
    this.transMat = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const hg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x111111 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);
    this.addLandmarkLabels();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.bindInput();
  }

  /* ------------------------------------------------ world data */
  async generate(edits: BlockEdit[], onProgress: (p: number) => void) {
    const total = CHUNKS * CHUNKS;
    let n = 0;
    for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) {
      this.chunks.set(cx + cz * CHUNKS, generateChunk(this.seed, cx, cz));
      if (++n % 12 === 0) { onProgress(n / total * 0.6); await new Promise((r) => setTimeout(r, 0)); }
    }
    for (const e of edits) { this.setLocal(e.x, e.y, e.z, e.b, false); this.markPending(e); this.edits.set(`${e.x},${e.y},${e.z}`, e.b); }
    for (let x = 0; x < WORLD_SIZE; x++) for (let z = 0; z < WORLD_SIZE; z++) this.updateColumn(x, z);
    // Mesh nearest chunks first.
    const order = [...this.chunks.keys()].sort((a, b) => this.chunkDist(a) - this.chunkDist(b));
    n = 0;
    for (const k of order) {
      this.meshChunk(k);
      if (++n % 8 === 0) { onProgress(0.6 + (n / total) * 0.4); await new Promise((r) => setTimeout(r, 0)); }
    }
    onProgress(1);
  }

  private chunkDist(k: number) {
    const cx = k % CHUNKS, cz = Math.floor(k / CHUNKS);
    return Math.hypot(cx * CHUNK + 8 - this.pos.x, cz * CHUNK + 8 - this.pos.z);
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return 0;
    const c = this.chunks.get((x >> 4) + (z >> 4) * CHUNKS);
    if (!c) return 0;
    return c[(x & 15) + (z & 15) * CHUNK + y * CHUNK * CHUNK];
  }

  private setLocal(x: number, y: number, z: number, b: number, remesh = true) {
    if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const k = (x >> 4) + (z >> 4) * CHUNKS;
    const c = this.chunks.get(k);
    if (!c) return;
    c[(x & 15) + (z & 15) * CHUNK + y * CHUNK * CHUNK] = b;
    if (!remesh) return;
    this.dirty.add(k);
    if ((x & 15) === 0 && x > 0) this.dirty.add(k - 1);
    if ((x & 15) === 15 && x < WORLD_SIZE - 1) this.dirty.add(k + 1);
    if ((z & 15) === 0 && z > 0) this.dirty.add(k - CHUNKS);
    if ((z & 15) === 15 && z < WORLD_SIZE - 1) this.dirty.add(k + CHUNKS);
    this.updateColumn(x, z);
  }

  /** Apply a server-confirmed edit. */
  applyEdit(e: BlockEdit) { this.markPending(e); this.edits.set(`${e.x},${e.y},${e.z}`, e.b); this.setLocal(e.x, e.y, e.z, e.b); }
  private markPending(e: BlockEdit) {
    const k = `${e.x},${e.y},${e.z}`;
    if (e.pending && e.b !== 0) this.pending.add(k); else this.pending.delete(k);
  }
  isPending(x: number, y: number, z: number) { return this.pending.has(`${x},${y},${z}`); }
  get pendingCount() { return this.pending.size; }

  /** Replace all edits (after a reset or a class event): only positions that actually differ are changed and re-meshed. */
  resetEdits(edits: BlockEdit[]) {
    const next = new Map<string, number>();
    for (const e of edits) next.set(`${e.x},${e.y},${e.z}`, e.b);
    this.pending.clear();
    for (const e of edits) this.markPending(e);
    const changed: [number, number, number, number][] = [];
    for (const [k, b] of this.edits) if (!next.has(k)) { const [x, y, z] = k.split(',').map(Number); changed.push([x, y, z, baseBlock(this.seed, x, y, z)]); }
    for (const [k, b] of next) if (this.edits.get(k) !== b || this.pending.has(k)) { const [x, y, z] = k.split(',').map(Number); changed.push([x, y, z, b]); }
    this.edits = next;
    for (const [x, y, z, b] of changed) this.setLocal(x, y, z, b);
    // Nearest chunks first so a new structure next to the player appears right away.
    const order = [...this.dirty].sort((a, b) => this.chunkDist(a) - this.chunkDist(b));
    this.dirty = new Set(order);
  }

  private updateColumn(x: number, z: number) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const b = this.getBlock(x, y, z);
      if (b !== 0) { this.topBlock[x + z * WORLD_SIZE] = b; this.topHeight[x + z * WORLD_SIZE] = y; return; }
    }
  }

  isSolid(x: number, y: number, z: number) {
    if (x < 0 || z < 0 || x >= WORLD_SIZE || z >= WORLD_SIZE) return true;
    const b = this.getBlock(x, y, z);
    return b !== 0 && b !== WATER && !!BLOCK_BY_ID[b]?.solid;
  }

  /* ------------------------------------------------ meshing */
  private meshChunk(k: number) {
    const c = this.chunks.get(k)!;
    const cx = k % CHUNKS, cz = Math.floor(k / CHUNKS);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const buf = { o: { p: [] as number[], uv: [] as number[], c: [] as number[], i: [] as number[] }, t: { p: [] as number[], uv: [] as number[], c: [] as number[], i: [] as number[] } };
    const rows = Math.ceil(this.atlas.texture.image.height / TILE);
    const eps = 0.0008;
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const b = c[lx + lz * CHUNK + y * CHUNK * CHUNK];
      if (b === 0) continue;
      const def = BLOCK_BY_ID[b];
      if (!def) continue;
      const trans = !!def.transparent;
      const x = ox + lx, z = oz + lz;
      const pend = this.pending.size > 0 && this.pending.has(`${x},${y},${z}`);
      for (const f of FACES) {
        const nb = this.getBlock(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
        if (nb !== 0) {
          const nd = BLOCK_BY_ID[nb];
          if (!nd?.transparent) continue; // hidden behind an opaque block
          if (nb === b) continue; // water next to water, glass next to glass
          if (b === WATER && nb !== WATER && nd?.transparent) continue;
        }
        if (b === WATER && f.dir[1] !== 1 && nb !== 0) continue;
        const target = trans ? buf.t : buf.o;
        const tile = this.atlas.tileOf(b, f.face);
        const tu = tile % ATLAS_COLS, tv = Math.floor(tile / ATLAS_COLS);
        const u0 = tu / ATLAS_COLS + eps, u1 = (tu + 1) / ATLAS_COLS - eps;
        const v1 = 1 - tv / rows - eps, v0 = 1 - (tv + 1) / rows + eps;
        const light = def.emissive ? 1.05 : f.shade;
        const ndx = target.p.length / 3;
        const top = b === WATER && f.dir[1] === 1 ? 0.88 : 1;
        for (const [px, py, pz, u, v] of f.corners) {
          target.p.push(x + px, y + (py === 1 ? top : 0), z + pz);
          target.uv.push(u ? u1 : u0, v ? v1 : v0);
          if (pend) target.c.push(light * 1.1, light * 0.92, light * 0.45); else target.c.push(light, light, light);
        }
        target.i.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
      }
    }
    const old = this.meshes.get(k);
    if (old) { this.scene.remove(old); old.children.forEach((m) => (m as THREE.Mesh).geometry.dispose()); }
    const group = new THREE.Group();
    for (const [key, mat] of [['o', this.opaqueMat], ['t', this.transMat]] as const) {
      const d = buf[key];
      if (!d.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(d.c, 3));
      g.setIndex(d.i);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      if (key === 't') m.renderOrder = 1;
      group.add(m);
    }
    this.meshes.set(k, group);
    this.scene.add(group);
  }

  /* ------------------------------------------------ decorations */
  private makeLabel(text: string, bg = 'rgba(18,22,36,0.8)', color = '#ffffff', scale = 1) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    const font = '700 28px Nunito, sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 28;
    c.width = w; c.height = 44;
    g.font = font;
    g.fillStyle = bg; g.beginPath(); (g as any).roundRect?.(0, 0, w, 44, 10); if (!(g as any).roundRect) g.rect(0, 0, w, 44); g.fill();
    g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 14, 23);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    s.scale.set((w / 44) * 0.55 * scale, 0.55 * scale, 1);
    return s;
  }

  private addLandmarkLabels() {
    for (const l of LANDMARKS) {
      if (l.kind === 'spawn') continue;
      const s = this.makeLabel(l.name, 'rgba(42,99,212,0.9)', '#fff', 1.6);
      s.position.set(l.x + 0.5, l.y + (l.kind === 'quest' ? 9 : 7), l.z + 0.5);
      this.scene.add(s);
    }
  }

  addPlotMarker(plot: { x0: number; z0: number; x1: number; z1: number }, label: string, y: number, color = 0xffd166) {
    const pts = [[plot.x0, plot.z0], [plot.x1 + 1, plot.z0], [plot.x1 + 1, plot.z1 + 1], [plot.x0, plot.z1 + 1], [plot.x0, plot.z0]].map(([x, z]) => new THREE.Vector3(x, y + 0.03, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
    this.scene.add(line);
    const s = this.makeLabel(label, 'rgba(18,22,36,0.75)', '#ffd166', 1.1);
    s.position.set((plot.x0 + plot.x1 + 1) / 2, y + 3.2, (plot.z0 + plot.z1 + 1) / 2);
    this.scene.add(s);
  }

  private makeClouds() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, fog: false });
    let s = this.seed || 1;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(8 + r() * 14, 2, 6 + r() * 10), mat);
      m.position.set(r() * WORLD_SIZE * 1.4 - WORLD_SIZE * 0.2, 72 + r() * 6, r() * WORLD_SIZE * 1.4 - WORLD_SIZE * 0.2);
      g.add(m);
    }
    return g;
  }

  private makeAvatar(p: PlayerState) {
    const look: Look = p.look ?? {};
    const color = look.shirt ?? p.color;
    const g = new THREE.Group();
    const mat = (c: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.35), mat(color));
    body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0xe0b48f));
    head.position.y = 1.72;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), mat(0x3a2a1c));
    hair.position.y = 1.99;
    const legMat = mat(0x2d3a5a);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.65, 0.3), legMat); l1.position.set(-0.15, 0.33, 0);
    const l2 = l1.clone(); l2.position.x = 0.15;
    const armMat = mat(new THREE.Color(color).multiplyScalar(0.8));
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.25), armMat); a1.position.set(-0.42, 1.05, 0);
    const a2 = a1.clone(); a2.position.x = 0.42;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.02), mat(0x1a1a1a));
    eyes.position.set(0, 1.76, -0.26);
    g.add(body, head, hair, l1, l2, a1, a2, eyes);
    // Cosmetics (bought in the shop or earned from quests and events).
    if (look.cape) {
      const cape = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.95, 0.04), mat(look.cape));
      cape.position.set(0, 0.98, 0.21); cape.rotation.x = -0.08;
      g.add(cape);
    }
    if (look.hat) {
      const hc = look.hatColor ?? '#444';
      const hat = new THREE.Group();
      if (look.hat === 'cap') {
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.54), mat(hc)); top.position.y = 2.04;
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.25), mat(hc)); brim.position.set(0, 1.97, -0.36);
        hat.add(top, brim);
      } else if (look.hat === 'headband') {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.09, 0.54), mat(hc)); band.position.y = 1.9; hat.add(band);
      } else if (look.hat === 'wizard') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 8), mat(hc)); cone.position.y = 2.42;
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 12), mat(hc)); brim.position.y = 2.02;
        hat.add(cone, brim);
      } else if (look.hat === 'tophat') {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.45, 12), mat(hc)); tube.position.y = 2.27;
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), mat(hc)); brim.position.y = 2.04;
        hat.add(tube, brim);
      } else if (look.hat === 'helmet') {
        const dome = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.58), mat(hc)); dome.position.y = 1.97;
        const plume = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.4), mat('#c8453c')); plume.position.y = 2.25;
        hat.add(dome, plume);
      } else if (look.hat === 'crown') {
        const ring = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.12, 0.54), mat(hc)); ring.position.y = 2.06;
        hat.add(ring);
        for (const [dx, dz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22], [0, -0.22]]) {
          const pt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), mat(hc)); pt.position.set(dx, 2.18, dz); hat.add(pt);
        }
      }
      g.add(hat);
    }
    const labelText = p.role === 'student' ? (look.title ? `${p.name} · ${look.title}` : p.name) : `${p.name} (Teacher)`;
    const label = this.makeLabel(labelText, p.role === 'student' ? 'rgba(18,22,36,0.8)' : 'rgba(184,53,42,0.9)', look.title ? '#ffd166' : '#ffffff');
    label.position.y = look.hat === 'wizard' ? 2.95 : 2.45;
    g.add(label);
    return g;
  }

  /* ------------------------------------------------ players */
  setSelf(p: PlayerState) {
    this.pos.set(p.x, p.y, p.z);
    this.yaw = p.yaw;
    this.canFly = p.role !== 'student';
    this.selfState = p;
    this.self = this.makeAvatar(p);
    this.self.visible = false;
    this.scene.add(this.self);
  }
  /** Cosmetics or level changed for a player (possibly us). */
  updateLook(id: number, look: Look, level: number) {
    if (this.selfState && this.selfState.id === id) {
      this.selfState = { ...this.selfState, look, level };
      if (this.self) this.scene.remove(this.self);
      this.self = this.makeAvatar(this.selfState); this.self.visible = false; this.scene.add(this.self);
      return;
    }
    const r = this.remotes.get(id);
    if (!r) return;
    const state = { ...r.state, look, level };
    const pos = r.group.position.clone();
    this.scene.remove(r.group);
    const group = this.makeAvatar(state);
    group.position.copy(pos);
    this.scene.add(group);
    this.remotes.set(id, { ...r, group, state });
  }
  addRemote(p: PlayerState) {
    this.removeRemote(p.id);
    const group = this.makeAvatar(p);
    group.position.set(p.x, p.y, p.z);
    this.scene.add(group);
    this.remotes.set(p.id, { group, target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, state: p });
  }
  moveRemote(id: number, x: number, y: number, z: number, yaw: number) {
    const r = this.remotes.get(id);
    if (r) { r.target.set(x, y, z); r.yaw = yaw; r.state = { ...r.state, x, y, z, yaw }; }
  }
  removeRemote(id: number) {
    const r = this.remotes.get(id);
    if (r) { this.scene.remove(r.group); this.remotes.delete(id); }
  }
  remotePlayers() { return [...this.remotes.values()].map((r) => r.state); }
  teleport(x: number, y: number, z: number) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); }

  /* ------------------------------------------------ input */
  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('click', () => { if (this.inputEnabled && !this.touchMode && document.pointerLockElement !== el) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mousedown', this.onMouseDown);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { if (this.locked) this.cb.onHotbarScroll(Math.sign(e.deltaY)); }, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }
  get locked() { return document.pointerLockElement === this.renderer.domElement; }
  releasePointer() { if (this.locked) document.exitPointerLock(); }
  requestPointer() { if (!this.touchMode) this.renderer.domElement.requestPointerLock?.(); }
  /** Whether the player is actively controlling the character (pointer locked, or touch controls on). */
  get active() { return this.locked || (this.touchMode && this.inputEnabled); }
  /** Touch: drag on the screen to look around. */
  lookBy(dx: number, dy: number) {
    const s = 0.005 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }
  /** Touch buttons. */
  placeAction() { if (this.target) this.tryPlace(); }
  removeAction() { if (this.target) this.cb.requestRemove(this.target.x, this.target.y, this.target.z); }
  private onLockChange = () => { this.cb.onPointerLock(this.locked); if (!this.locked) this.keys.clear(); };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    const s = 0.0022 * this.sensitivity;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked || !this.target) return;
    if (e.button === 0) this.cb.requestRemove(this.target.x, this.target.y, this.target.z);
    else if (e.button === 2) this.tryPlace();
  };
  private tryPlace() {
    if (!this.target) return;
    const x = this.target.x + this.target.nx, y = this.target.y + this.target.ny, z = this.target.z + this.target.nz;
    // Don't place a block inside yourself.
    const minX = this.pos.x - 0.3, maxX = this.pos.x + 0.3, minY = this.pos.y, maxY = this.pos.y + 1.8, minZ = this.pos.z - 0.3, maxZ = this.pos.z + 0.3;
    if (x + 1 > minX && x < maxX && y + 1 > minY && y < maxY && z + 1 > minZ && z < maxZ) { this.cb.onHint?.('Step back a little: that block would be inside you.'); return; }
    this.cb.requestPlace(x, y, z);
  }
  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!this.inputEnabled) return;
    const k = e.key.toLowerCase();
    if (/^[1-9]$/.test(k)) { this.cb.onHotbarKey(Number(k) - 1); return; }
    if (['e', 'i', 'c', 'm', 'k', 'j', 'h', 'q', 't', 'l', 'b'].includes(k)) { e.preventDefault(); this.cb.onHotkey(k); return; }
    if (k === 'v') { this.thirdPerson = !this.thirdPerson; return; }
    if (k === 'g' && this.canFly) { this.flying = !this.flying; this.vel.set(0, 0, 0); return; }
    if (k === 'f') { this.tryPlace(); return; }
    if (k === 'r' && this.target) { this.cb.requestRemove(this.target.x, this.target.y, this.target.z); return; }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  /* ------------------------------------------------ simulation */
  private collides(x: number, y: number, z: number) {
    const r = 0.3;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++)
      for (let by = Math.floor(y); by <= Math.floor(y + 1.79); by++)
        for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++)
          if (this.isSolid(bx, by, bz)) return true;
    return false;
  }

  private step(dt: number) {
    const k = this.keys;
    const inWater = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)) === WATER;
    // Arrow keys look around (keyboard-only play).
    if (k.has('arrowleft')) this.yaw += 2.2 * dt;
    if (k.has('arrowright')) this.yaw -= 2.2 * dt;
    if (k.has('arrowup')) this.pitch = Math.min(1.55, this.pitch + 1.6 * dt);
    if (k.has('arrowdown')) this.pitch = Math.max(-1.55, this.pitch - 1.6 * dt);
    let fx = 0, fz = 0;
    if (!this.frozen) {
      if (k.has('w')) fz -= 1; if (k.has('s')) fz += 1;
      if (k.has('a')) fx -= 1; if (k.has('d')) fx += 1;
      if (this.touchMode) { fx += this.touchMove.x; fz += this.touchMove.z; }
    }
    const jump = k.has(' ') || (this.touchMode && this.touchJump);
    const speed = (this.flying ? 12 : k.has('shift') ? 6.5 : 4.4) * (inWater ? 0.55 : 1);
    const len = Math.max(1, Math.hypot(fx, fz)); // joystick gives partial speed near the centre
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ((fx * cos + fz * sin) / len) * speed;
    const wz = ((-fx * sin + fz * cos) / len) * speed;
    this.vel.x = wx; this.vel.z = wz;
    if (this.flying) {
      this.vel.y = (jump ? speed : 0) - (k.has('control') || k.has('z') ? speed : 0);
    } else if (inWater) {
      this.vel.y = Math.max(this.vel.y - 10 * dt, -2.5);
      if (jump && !this.frozen) this.vel.y = 3;
    } else {
      this.vel.y = Math.max(this.vel.y - 28 * dt, -40);
      if (jump && this.onGround && !this.frozen) { this.vel.y = 8.6; this.onGround = false; }
    }
    // Axis-separated collision.
    const nx = this.pos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pos.y, this.pos.z)) this.pos.x = nx;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, this.pos.y, nz)) this.pos.z = nz;
    const ny = this.pos.y + this.vel.y * dt;
    if (!this.collides(this.pos.x, ny, this.pos.z)) { this.pos.y = ny; this.onGround = false; }
    else { if (this.vel.y < 0) this.onGround = true; this.vel.y = 0; }
    if (this.pos.y < -10) this.pos.y = WORLD_HEIGHT;
  }

  private raycast() {
    const origin = this.camera.position.clone();
    if (this.thirdPerson) origin.copy(this.eye());
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDX = Math.abs(1 / dir.x), tDY = Math.abs(1 / dir.y), tDZ = Math.abs(1 / dir.z);
    let tMX = (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDX;
    let tMY = (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDY;
    let tMZ = (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDZ;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t < 7) {
      const b = this.getBlock(x, y, z);
      if (b !== 0 && b !== WATER) return { x, y, z, nx, ny, nz };
      if (tMX < tMY && tMX < tMZ) { x += stepX; t = tMX; tMX += tDX; nx = -stepX; ny = 0; nz = 0; }
      else if (tMY < tMZ) { y += stepY; t = tMY; tMY += tDY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tMZ; tMZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  private eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z); }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.inputEnabled && this.active) this.step(dt); // no walking behind the "Click to play" card
    // Camera.
    const eye = this.eye();
    const rot = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    if (this.thirdPerson) {
      const back = new THREE.Vector3(0, 0.6, 4).applyEuler(rot);
      this.camera.position.copy(eye).add(back);
    } else this.camera.position.copy(eye);
    this.camera.quaternion.setFromEuler(rot);
    if (this.self) { this.self.visible = this.thirdPerson; this.self.position.copy(this.pos); this.self.rotation.y = this.yaw; }
    // Target highlight.
    this.target = this.active ? this.raycast() : null;
    this.highlight.visible = !!this.target;
    if (this.target) this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    // Remote players.
    for (const r of this.remotes.values()) {
      r.group.position.lerp(r.target, Math.min(1, dt * 10));
      r.group.rotation.y = r.yaw;
    }
    this.clouds.position.x = ((now / 1000) * 0.6) % 60;
    // Remesh edited chunks (a few per frame).
    let n = 0;
    for (const k of this.dirty) { this.meshChunk(k); this.dirty.delete(k); if (++n >= 4) break; }
    // Network + HUD callbacks.
    if (now - this.lastSent > 100) {
      this.lastSent = now;
      this.cb.onMove({ x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw });
      const region = regionAt(Math.floor(this.pos.x), Math.floor(this.pos.z));
      if (region !== this.lastRegion) { this.lastRegion = region; this.cb.onRegion(region); }
      const q = LANDMARKS.find((l) => l.kind === 'quest')!;
      const near = Math.hypot(this.pos.x - q.x, this.pos.z - q.z) < 9;
      if (near !== this.nearQuest) { this.nearQuest = near; this.cb.onNearQuestCenter(near); }
    }
    this.renderer.render(this.scene, this.camera);
  };

  start() { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }

  private resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.releasePointer();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
