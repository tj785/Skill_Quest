import { useEffect, useRef, useState } from 'react';
import {
  BLOCKS, BLOCK_BY_ID, TIER_LABEL, TIER_COLOR, TIERS, WORLD_SIZE, LANDMARKS, REGIONS, regionAt, RegionKey
} from '@cq/shared';
import { Trophy } from '../ui/icons';
import { loadPrefs, savePrefs, Prefs } from '../ui/prefs';
import type { Engine } from './Engine';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={ref} tabIndex={-1} style={wide ? { width: 'min(1100px, 96vw)' } : undefined}>
        <div className="modal-head"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn secondary" onClick={onClose}>Close <span className="muted">(Esc)</span></button></div>
        {children}
      </div>
    </div>
  );
}

export function InventoryPanel({ inventory, hotbar, selected, icon, onAssign, teacher, onClose }: {
  inventory: Record<number, number>; hotbar: (number | null)[]; selected: number; icon: (id: number) => string;
  onAssign: (blockId: number) => void; teacher: boolean; onClose: () => void;
}) {
  const ids = teacher ? BLOCKS.filter((b) => b.tier !== 'natural').map((b) => b.id) : Object.keys(inventory).map(Number).filter((id) => inventory[id] > 0);
  const byTier = TIERS.map((t) => ({ t, list: ids.filter((id) => BLOCK_BY_ID[id]?.tier === t) })).filter((g) => g.list.length);
  return (
    <Modal title="Inventory" onClose={onClose}>
      <p className="muted">Click a block to put it in hotbar slot {selected + 1}. Earn more blocks by answering questions in the Question Center.</p>
      {byTier.length === 0 && <p>Your inventory is empty. Visit the Question Center to earn blocks.</p>}
      {byTier.map(({ t, list }) => (
        <div key={t} style={{ marginBottom: '1rem' }}>
          <h3 className="row" style={{ gap: 8 }}><span className="tag" style={{ background: TIER_COLOR[t], color: '#111' }}>{TIER_LABEL[t]}</span></h3>
          <div className="inv-grid">
            {list.map((id) => (
              <button key={id} className="inv-item" onClick={() => onAssign(id)} style={hotbar[selected] === id ? { borderColor: 'var(--brand)' } : undefined}>
                <img src={icon(id)} alt="" />
                <div style={{ fontWeight: 800 }}>{BLOCK_BY_ID[id].name}</div>
                <div className="t">{teacher ? 'Unlimited' : `Amount: ${inventory[id]}`}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

export function CharacterPanel({ profile, tab, onClose }: { profile: any; tab: 'character' | 'skills' | 'achievements'; onClose: () => void }) {
  const [t, setT] = useState(tab);
  const earned = profile.achievements.filter((a: any) => a.earned);
  const maxSkill = Math.max(100, ...profile.skills.map((s: any) => s.points));
  return (
    <Modal title={profile.displayName} onClose={onClose}>
      <div className="tabs" role="tablist">
        {(['character', 'skills', 'achievements'] as const).map((k) => <button key={k} role="tab" aria-selected={t === k} onClick={() => setT(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      {t === 'character' && (
        <div className="stack">
          <div className="grid3">
            <div className="card"><div className="muted">Level</div><div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem' }}>{profile.level}</div><div className="tag">{profile.title}</div></div>
            <div className="card"><div className="muted">Experience</div><div className="num" style={{ fontFamily: 'var(--display)', fontSize: '1.6rem' }}>{profile.xp.toLocaleString()} XP</div>
              <div className="bar"><span style={{ width: `${profile.pct * 100}%` }} /></div><div className="muted num" style={{ fontSize: '0.85rem' }}>{(profile.nextLevelXp - profile.xp).toLocaleString()} XP to level {profile.level + 1}</div></div>
            <div className="card"><div className="muted">Coins</div><div className="num" style={{ fontFamily: 'var(--display)', fontSize: '2rem' }}>{profile.coins}</div></div>
          </div>
          <div className="grid3">
            <div className="card"><div className="muted">Questions solved</div><b className="num" style={{ fontSize: '1.4rem' }}>{profile.stats.solved}</b></div>
            <div className="card"><div className="muted">Accuracy</div><b className="num" style={{ fontSize: '1.4rem' }}>{profile.stats.attempts ? Math.round((profile.stats.correct / profile.stats.attempts) * 100) + '%' : '–'}</b></div>
            <div className="card"><div className="muted">Blocks placed</div><b className="num" style={{ fontSize: '1.4rem' }}>{profile.blocksPlaced}</b></div>
          </div>
          <div className="card">
            <h3>Achievements</h3>
            {earned.length ? <div className="row">{earned.map((a: any) => <span key={a.id} className="tag row" style={{ gap: 4 }}><Trophy size={16} />{a.name}</span>)}</div> : <p className="muted">Answer your first question to earn “First Steps”.</p>}
          </div>
          <div className="card">
            <h3>Buildings</h3>
            {profile.buildings.length ? <ul>{profile.buildings.map((b: any) => <li key={b.name}>{b.name}: {b.blocks} blocks near ({b.x}, {b.z})</li>)}</ul> : <p className="muted">Build something with 8 or more connected blocks and it shows up here.</p>}
          </div>
          <div className="card">
            <h3>Regions</h3>
            <ul style={{ margin: 0 }}>{profile.regions.map((r: any) => <li key={r.key}>{r.name}: {r.unlocked ? 'Unlocked' : `Locked until level ${r.minLevel}`}</li>)}</ul>
          </div>
        </div>
      )}
      {t === 'skills' && (
        <div>
          {profile.skills.map((s: any) => (
            <div key={s.id} className="skill-row">
              <b>{s.name}</b>
              <div className="bar" role="progressbar" aria-valuenow={s.points} aria-valuemin={0} aria-valuemax={maxSkill} aria-label={s.name}><span style={{ width: `${Math.min(100, (s.points / maxSkill) * 100)}%` }} /></div>
              <span className="num" style={{ fontWeight: 800 }}>{s.points}</span>
            </div>
          ))}
          <p className="muted">Skills grow when you answer questions in that subject.</p>
        </div>
      )}
      {t === 'achievements' && (
        <div className="grid2">
          {profile.achievements.map((a: any) => (
            <div key={a.id} className={`ach ${a.earned ? '' : 'locked'}`}>
              <div className="icon"><Trophy locked={!a.earned} /></div>
              <div style={{ flex: 1 }}>
                <b>{a.name}</b> {a.earned ? <span className="tag">Earned</span> : <span className="tag">Locked</span>}
                <div className="muted" style={{ fontSize: '0.9rem' }}>{a.description}</div>
                {!a.earned && a.threshold > 1 && <><div className="bar" style={{ marginTop: 6 }}><span style={{ width: `${(a.progress / a.threshold) * 100}%` }} /></div><div className="muted num" style={{ fontSize: '0.8rem' }}>{a.progress}/{a.threshold}</div></>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Draws a top-down view of the world from the engine's column data. */
export function drawMap(ctx: CanvasRenderingContext2D, engine: Engine, cx: number, cz: number, radius: number, size: number, opts: { plot?: any; zones?: any[]; players?: { x: number; z: number; name: string }[]; showLabels?: boolean; lockedRegions?: Set<RegionKey> }) {
  const scale = size / (radius * 2);
  const img = ctx.createImageData(size, size);
  const colorCache: Record<number, number[]> = {};
  const colorOf = (id: number) => {
    if (!colorCache[id]) { const hex = BLOCK_BY_ID[id]?.top ?? BLOCK_BY_ID[id]?.color ?? '#000000'; const n = parseInt(hex.slice(1), 16); colorCache[id] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    return colorCache[id];
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const wx = Math.floor(cx - radius + px / scale), wz = Math.floor(cz - radius + py / scale);
    const i = (px + py * size) * 4;
    if (wx < 0 || wz < 0 || wx >= WORLD_SIZE || wz >= WORLD_SIZE) { img.data[i] = 20; img.data[i + 1] = 24; img.data[i + 2] = 36; img.data[i + 3] = 255; continue; }
    const col = colorOf(engine.topBlock[wx + wz * WORLD_SIZE]);
    const h = engine.topHeight[wx + wz * WORLD_SIZE];
    let f = 0.75 + (h / 64) * 0.5;
    if (opts.lockedRegions?.has(regionAt(wx, wz))) f *= 0.55;
    img.data[i] = Math.min(255, col[0] * f); img.data[i + 1] = Math.min(255, col[1] * f); img.data[i + 2] = Math.min(255, col[2] * f); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tx = (x: number) => (x - (cx - radius)) * scale, tz = (z: number) => (z - (cz - radius)) * scale;
  ctx.lineWidth = 2;
  for (const zn of opts.zones ?? []) { ctx.strokeStyle = '#4cc3ff'; ctx.setLineDash([4, 3]); ctx.strokeRect(tx(Math.min(zn.x0, zn.x1)), tz(Math.min(zn.z0, zn.z1)), (Math.abs(zn.x1 - zn.x0) + 1) * scale, (Math.abs(zn.z1 - zn.z0) + 1) * scale); ctx.setLineDash([]); }
  if (opts.plot) { ctx.strokeStyle = '#ffd166'; ctx.strokeRect(tx(opts.plot.x0), tz(opts.plot.z0), (opts.plot.x1 - opts.plot.x0 + 1) * scale, (opts.plot.z1 - opts.plot.z0 + 1) * scale); }
  ctx.font = `700 ${Math.max(10, Math.min(14, size / 14))}px Nunito, sans-serif`;
  for (const l of LANDMARKS) {
    if (l.kind === 'spawn') continue;
    ctx.fillStyle = '#2a63d4'; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(tx(l.x), tz(l.z), Math.max(3, scale * 1.5), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (opts.showLabels) {
      // Labels point away from the village center so neighbours don't overlap.
      const left = l.x < WORLD_SIZE / 2 - 2, below = l.z > WORLD_SIZE / 2 + 2, above = l.z < WORLD_SIZE / 2 - 2;
      const lx = tx(l.x) + (left ? -8 : 8), lz = tz(l.z) + (above ? -8 : below ? 16 : 4);
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(l.name, lx, lz); ctx.fillText(l.name, lx, lz); ctx.lineWidth = 2;
      ctx.textAlign = 'left';
    }
  }
  for (const p of opts.players ?? []) { ctx.fillStyle = '#ffffff'; ctx.fillRect(tx(p.x) - 2, tz(p.z) - 2, 4, 4); }
  // You: arrow pointing where you look.
  const ex = tx(engine.pos.x), ez = tz(engine.pos.z);
  ctx.save(); ctx.translate(ex, ez); ctx.rotate(-engine.yaw);
  ctx.fillStyle = '#ff5a4e'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function MapPanel({ engine, plot, zones, lockedRegions, onClose }: { engine: Engine; plot?: any; zones: any[]; lockedRegions: Set<RegionKey>; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    drawMap(ctx, engine, WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE / 2, 640, { plot, zones, players: engine.remotePlayers(), showLabels: true, lockedRegions });
  }, []);
  return (
    <Modal title="World map" onClose={onClose} wide>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <canvas ref={ref} width={640} height={640} style={{ width: 'min(640px, 70vw)', borderRadius: 12 }} aria-label="Map of the whole world" />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3>Regions</h3>
          <ul>{Object.values(REGIONS).map((r) => <li key={r.key}><b>{r.name}</b>: {r.description} {lockedRegions.has(r.key) ? <span className="tag">Locked: level {r.minLevel}</span> : <span className="tag">Open</span>}</li>)}</ul>
          <h3>Legend</h3>
          <ul>
            <li><span style={{ color: '#ff5a4e', fontWeight: 900 }}>▲</span> You</li>
            <li><span style={{ color: '#2a63d4', fontWeight: 900 }}>●</span> Village buildings</li>
            <li><span style={{ color: '#b8860b', fontWeight: 900 }}>□</span> Your plot (yellow outline)</li>
            <li><span style={{ color: '#1f8fd1', fontWeight: 900 }}>▭</span> Class project zones (dashed blue)</li>
            <li>▪ Classmates</li>
            <li>Darker areas are locked regions.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

export function HelpPanel({ onClose, teacher }: { onClose: () => void; teacher: boolean }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="grid2">
        <div className="card">
          <h3>Controls</h3>
          <div className="keys">
            <kbd>Click</kbd><span>Take control (Esc to let go)</span>
            <kbd>W A S D</kbd><span>Walk</span>
            <kbd>Space</kbd><span>Jump / swim up</span>
            <kbd>Shift</kbd><span>Run</span>
            <kbd>Mouse / Arrows</kbd><span>Look around</span>
            <kbd>Right click / F</kbd><span>Place selected block</span>
            <kbd>Left click / R</kbd><span>Remove block</span>
            <kbd>1-9 / Wheel</kbd><span>Choose hotbar block</span>
            <kbd>V</kbd><span>Switch first / third person</span>
            {teacher && <><kbd>G</kbd><span>Fly on/off (Space up, Z down)</span></>}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>On a tablet or phone: drag the left circle to walk, drag anywhere else to look, and use the buttons on the right to jump, place and remove blocks.</p>
        </div>
        <div className="card">
          <h3>Menus</h3>
          <div className="keys">
            <kbd>Q</kbd><span>Question Center</span>
            <kbd>E</kbd><span>Question Center (when standing near it)</span>
            <kbd>I</kbd><span>Inventory</span>
            <kbd>C</kbd><span>Character</span>
            <kbd>K</kbd><span>Skills</span>
            <kbd>J</kbd><span>Achievements</span>
            <kbd>M</kbd><span>Map</span>
            <kbd>L</kbd><span>Quests, daily challenges and events</span>
            <kbd>B</kbd><span>Cosmetics shop</span>
            <kbd>T</kbd><span>Chat (when your teacher turns it on)</span>
            <kbd>H</kbd><span>This help</span>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>The quest loop</h3>
        <p>Learn → earn → build → achieve → level up → learn. Answer questions to earn XP and blocks, build in your plot (yellow outline), and unlock new regions as you level up. Harder questions give rarer blocks.</p>
      </div>
    </Modal>
  );
}

export function SettingsPanel({ onClose, onChange }: { onClose: () => void; onChange: (p: Prefs) => void }) {
  const [p, setP] = useState(loadPrefs());
  const upd = (patch: Partial<Prefs>) => { const n = { ...p, ...patch }; setP(n); savePrefs(n); onChange(n); };
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="field"><label htmlFor="ts">Text size</label>
        <select id="ts" className="input" value={p.textScale} onChange={(e) => upd({ textScale: Number(e.target.value) })}>
          <option value={0.9}>Small</option><option value={1}>Normal</option><option value={1.15}>Large</option><option value={1.3}>Extra large</option>
        </select></div>
      <div className="field"><label htmlFor="ms">Mouse sensitivity: {p.sensitivity.toFixed(1)}</label>
        <input id="ms" type="range" min={0.3} max={2.5} step={0.1} value={p.sensitivity} onChange={(e) => upd({ sensitivity: Number(e.target.value) })} /></div>
      <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={p.invertY} onChange={(e) => upd({ invertY: e.target.checked })} /> Invert look up/down</label>
      <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={p.reduceMotion} onChange={(e) => upd({ reduceMotion: e.target.checked })} /> Reduce motion (fewer animations)</label>
      <div className="field"><label htmlFor="tc">Touch controls (joystick and buttons)</label>
        <select id="tc" className="input" value={p.touch} onChange={(e) => upd({ touch: e.target.value as Prefs['touch'] })}>
          <option value="auto">Automatic (on for tablets and phones)</option><option value="on">Always on</option><option value="off">Off (keyboard and mouse)</option>
        </select></div>
    </Modal>
  );
}
