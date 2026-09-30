/**
 * Procedural pixel-art textures for every block, drawn once into a texture atlas.
 * No image files are needed; each block's look comes from its catalog color + pattern.
 */
import * as THREE from 'three';
import { BLOCKS, BlockDef } from '@cq/shared';

export const TILE = 16;
export const ATLAS_COLS = 16;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
}
function hexToRgb(hex: string) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex: string, f: number) {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

function drawTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, b: BlockDef, face: 'side' | 'top' | 'bottom') {
  const base = face === 'top' ? b.top ?? b.color : face === 'bottom' ? b.bottom ?? b.color : b.color;
  const r = rng(b.id * 97 + (face === 'top' ? 7 : face === 'bottom' ? 13 : 1));
  const px = (x: number, y: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(ox + x, oy + y, 1, 1); };
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, shade(base, 0.88 + r() * 0.24));

  if (b.key === 'grass' && face === 'side') {
    for (let x = 0; x < TILE; x++) { const h = 3 + Math.floor(r() * 3); for (let y = 0; y < h; y++) px(x, y, shade(b.top!, 0.85 + r() * 0.25)); }
    return;
  }
  switch (b.pattern) {
    case 'bricks': {
      const mortar = shade(base, 0.62);
      for (let y = 0; y < TILE; y += 4) { for (let x = 0; x < TILE; x++) px(x, y, mortar); const off = (y / 4) % 2 ? 4 : 0; for (let yy = y; yy < y + 4; yy++) { px((off) % TILE, yy, mortar); px((off + 8) % TILE, yy, mortar); } }
      break;
    }
    case 'planks': {
      for (let y = 0; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(x, y, shade(base, 0.7));
      for (let y = 0; y < TILE; y += 4) { const k = (y * 5) % TILE; for (let yy = y + 1; yy < y + 4; yy++) px(k, yy, shade(base, 0.72)); }
      break;
    }
    case 'log': {
      if (face === 'side') for (let x = 0; x < TILE; x += 3) for (let y = 0; y < TILE; y++) if (r() > 0.3) px(x, y, shade(base, 0.72));
      else { for (let i = 2; i < 8; i += 2) { ctx.strokeStyle = shade(base, 0.7); ctx.strokeRect(ox + 8 - i + 0.5, oy + 8 - i + 0.5, i * 2 - 1, i * 2 - 1); } }
      break;
    }
    case 'glass': {
      ctx.clearRect(ox, oy, TILE, TILE);
      ctx.fillStyle = `rgba(${hexToRgb(base).join(',')},0.35)`; ctx.fillRect(ox, oy, TILE, TILE);
      ctx.fillStyle = shade(base, 0.75);
      ctx.fillRect(ox, oy, TILE, 1); ctx.fillRect(ox, oy + TILE - 1, TILE, 1); ctx.fillRect(ox, oy, 1, TILE); ctx.fillRect(ox + TILE - 1, oy, 1, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 4; i++) ctx.fillRect(ox + 3 + i, oy + 3 + i, 1, 1);
      break;
    }
    case 'leaves': {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) if (r() > 0.72) px(x, y, shade(base, 0.6));
      break;
    }
    case 'ore': {
      for (let i = 0; i < 18; i++) px(Math.floor(r() * TILE), Math.floor(r() * TILE), shade(base, r() > 0.5 ? 0.65 : 1.3));
      break;
    }
    case 'tiles': {
      ctx.fillStyle = shade(base, 0.7);
      ctx.fillRect(ox, oy, TILE, 1); ctx.fillRect(ox, oy, 1, TILE);
      ctx.fillStyle = shade(base, 1.18); ctx.fillRect(ox + 1, oy + 1, TILE - 2, 1); ctx.fillRect(ox + 1, oy + 1, 1, TILE - 2);
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 12) + 2, y = Math.floor(r() * 12) + 2; px(x, y, '#ffffff'); px(x + 1, y, shade(base, 1.4)); px(x, y + 1, shade(base, 1.4)); }
      ctx.fillStyle = shade(base, 0.7); ctx.fillRect(ox, oy, TILE, 1); ctx.fillRect(ox, oy + TILE - 1, TILE, 1);
      break;
    }
    case 'books': {
      if (face === 'side') {
        const cols = ['#b8352a', '#2a63d4', '#23804d', '#e8a33b', '#6b3fa0'];
        for (const row of [2, 9]) for (let x = 1; x < TILE - 1; x += 2) { const c = cols[Math.floor(r() * cols.length)]; for (let y = row; y < row + 5; y++) { px(x, y, c); } }
        for (let x = 0; x < TILE; x++) { px(x, 0, shade(base, 0.7)); px(x, 7, shade(base, 0.7)); px(x, 15, shade(base, 0.7)); }
      }
      break;
    }
    case 'column': {
      for (let x = 2; x < TILE; x += 4) for (let y = 0; y < TILE; y++) px(x, y, shade(base, 0.82));
      for (let x = 0; x < TILE; x++) { px(x, 0, shade(base, 0.75)); px(x, 15, shade(base, 0.75)); }
      break;
    }
    case 'rainbow': {
      const cols = ['#e04f4f', '#f29e3c', '#f2d53c', '#4fc36f', '#3c8ce0', '#7a4fe0'];
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, cols[Math.floor(((x + y) / (TILE * 2)) * cols.length) % cols.length]);
      break;
    }
    case 'star': {
      for (let i = 0; i < 10; i++) px(Math.floor(r() * TILE), Math.floor(r() * TILE), '#ffffff');
      const c = '#ffd166'; [[8, 4], [8, 5], [8, 6], [8, 7], [8, 8], [8, 9], [8, 10], [5, 7], [6, 7], [7, 7], [9, 7], [10, 7], [11, 7]].forEach(([x, y]) => px(x, y, c));
      break;
    }
    default: break;
  }
}

export interface Atlas { texture: THREE.CanvasTexture; tileOf: (id: number, face: 'side' | 'top' | 'bottom') => number; icon: (id: number) => string; }

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  const rows = Math.ceil((BLOCKS.length * 3) / ATLAS_COLS);
  canvas.width = ATLAS_COLS * TILE; canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d')!;
  const index: Record<string, number> = {};
  let n = 0;
  for (const b of BLOCKS) for (const face of ['side', 'top', 'bottom'] as const) {
    const ox = (n % ATLAS_COLS) * TILE, oy = Math.floor(n / ATLAS_COLS) * TILE;
    drawTile(ctx, ox, oy, b, face);
    index[`${b.id}:${face}`] = n++;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const iconCache = new Map<number, string>();
  return {
    texture,
    tileOf: (id, face) => index[`${id}:${face}`] ?? 0,
    icon: (id) => {
      if (iconCache.has(id)) return iconCache.get(id)!;
      // Little isometric-ish icon: top face over side face.
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
      const t = index[`${id}:top`], s = index[`${id}:side`];
      g.drawImage(canvas, (s % ATLAS_COLS) * TILE, Math.floor(s / ATLAS_COLS) * TILE, TILE, TILE, 2, 10, 28, 20);
      g.drawImage(canvas, (t % ATLAS_COLS) * TILE, Math.floor(t / ATLAS_COLS) * TILE, TILE, TILE, 2, 2, 28, 9);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(2, 10, 28, 1);
      const url = c.toDataURL(); iconCache.set(id, url); return url;
    }
  };
}
