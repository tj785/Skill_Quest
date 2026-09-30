/**
 * Game UI for quests / daily challenges / events, the cosmetics shop, chat,
 * teacher-approval building and touch controls. All state changes go through the
 * server; these components only display what it sends back.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { BLOCK_BY_ID, ChatMessage, CosmeticKind } from '@cq/shared';
import { Modal } from './Panels';
import type { Engine } from './Engine';

export interface QuestInfo {
  id: number; title: string; description: string | null; repeat: 'none' | 'daily' | 'weekly';
  reward: { xp: number; coins: number; block_id: number | null; block_qty: number; item: string | null };
  completed: boolean; stepIndex: number; stepProgress: number; steps: { description: string; amount: number; kind: string }[];
}
export interface EventInfo {
  id: number; title: string; description: string | null; goal: number; progress: number; mine: number; completed: boolean;
  endsAt: string | null; unlock: string | null; reward: { xp: number; coins: number; item: string | null };
}
export interface QuestData { quests: QuestInfo[]; events: EventInfo[]; }

const repeatLabel = (r: QuestInfo['repeat']) => (r === 'daily' ? 'Daily challenge' : r === 'weekly' ? 'Weekly challenge' : 'Quest');
function rewardText(r: QuestInfo['reward'] | EventInfo['reward']) {
  const parts: string[] = [];
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.coins) parts.push(`${r.coins} coins`);
  if ('block_id' in r && r.block_id && r.block_qty) parts.push(`${r.block_qty} ${BLOCK_BY_ID[r.block_id]?.name ?? 'blocks'}`);
  if (r.item) parts.push(r.item);
  return parts.join(', ') || 'Bragging rights';
}

/** Compact tracker in the HUD: the next step of each unfinished quest plus live class events. */
export function QuestTracker({ data, onOpen }: { data: QuestData | null; onOpen: () => void }) {
  if (!data) return null;
  const open = data.quests.filter((q) => !q.completed).slice(0, 3);
  const events = data.events.filter((e) => !e.completed).slice(0, 2);
  if (!open.length && !events.length) return null;
  return (
    <div className="tracker">
      {open.map((q) => {
        const st = q.steps[q.stepIndex];
        return (
          <div className="q" key={`q${q.id}`}>
            <span className={`tag ${q.repeat !== 'none' ? 'daily' : ''}`}>{repeatLabel(q.repeat)}</span> <b>{q.title}</b>
            {st && <div style={{ fontSize: '0.8rem' }}>Step {q.stepIndex + 1}/{q.steps.length}: {st.description} {st.amount > 1 ? `(${q.stepProgress}/${st.amount})` : ''}</div>}
          </div>
        );
      })}
      {events.map((e) => (
        <div className="q" key={`e${e.id}`}>
          <span className="tag event">Class event</span> <b>{e.title}</b>
          <div className="xpbar" style={{ height: 8 }}><span style={{ width: `${(e.progress / e.goal) * 100}%`, background: '#e8a33b' }} /></div>
          <div style={{ fontSize: '0.8rem' }}>{e.progress}/{e.goal} as a class · you helped {e.mine}</div>
        </div>
      ))}
      <button className="btn small secondary" onClick={onOpen}>All quests <kbd>L</kbd></button>
    </div>
  );
}

export function QuestLogPanel({ data, onClose, reload }: { data: QuestData | null; onClose: () => void; reload: () => void }) {
  useEffect(() => { reload(); /* fresh numbers every time it opens */ }, [reload]);
  const [tab, setTab] = useState<'quests' | 'events'>('quests');
  const quests = data?.quests ?? [];
  const groups: [string, QuestInfo[]][] = [
    ['Daily & weekly challenges', quests.filter((q) => q.repeat !== 'none')],
    ['Quests', quests.filter((q) => q.repeat === 'none')]
  ];
  return (
    <Modal title="Quests & events" onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'quests'} onClick={() => setTab('quests')}>Quests & challenges</button>
        <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>Class events</button>
      </div>
      {!data && <p>Loading…</p>}
      {data && tab === 'quests' && (
        <div className="stack">
          {quests.length === 0 && <p className="muted">Your teacher has not added any quests yet. Questions in the Question Center still earn rewards.</p>}
          {groups.map(([title, list]) => list.length > 0 && (
            <div key={title}>
              <h3>{title}</h3>
              {title.startsWith('Daily') && <p className="muted" style={{ marginTop: -6 }}>Challenges reset every day (or week). Come back tomorrow for a new one.</p>}
              {list.map((q) => (
                <div key={q.id} className={`card quest-card ${q.completed ? 'done' : ''}`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b style={{ fontSize: '1.1rem' }}>{q.completed ? '✓ ' : ''}{q.title}</b>
                    <span className="tag">Reward: {rewardText(q.reward)}</span>
                  </div>
                  {q.description && <p style={{ margin: '4px 0 8px' }}>{q.description}</p>}
                  <ol className="qsteps">
                    {q.steps.map((s, i) => {
                      const done = q.completed || i < q.stepIndex;
                      const current = !q.completed && i === q.stepIndex;
                      return (
                        <li key={i} className={done ? 'done' : current ? 'current' : ''}>
                          <span>{done ? '✓' : current ? '▶' : '○'}</span> {s.description}
                          {current && s.amount > 1 && <span className="muted"> — {q.stepProgress}/{s.amount}</span>}
                        </li>
                      );
                    })}
                  </ol>
                  {q.completed && <div className="muted">{q.repeat === 'none' ? 'Completed!' : `Completed for this ${q.repeat === 'daily' ? 'day' : 'week'}. A fresh one starts soon.`}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {data && tab === 'events' && (
        <div className="stack">
          {data.events.length === 0 && <p className="muted">No class events right now. When your teacher starts one, everyone works together toward a goal.</p>}
          {data.events.map((e) => (
            <div key={e.id} className={`card quest-card ${e.completed ? 'done' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b style={{ fontSize: '1.1rem' }}>{e.completed ? '✓ ' : ''}{e.title}</b>
                {e.endsAt && !e.completed && <span className="tag">Ends {new Date(e.endsAt).toLocaleDateString()}</span>}
              </div>
              {e.description && <p style={{ margin: '4px 0 8px' }}>{e.description}</p>}
              <div className="bar"><span style={{ width: `${(e.progress / e.goal) * 100}%`, background: '#e8a33b' }} /></div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: '0.9rem', marginTop: 4 }}>
                <span>{e.progress} / {e.goal} as a class · you added {e.mine}</span>
                <span>Everyone who helps: {rewardText(e.reward)}{e.unlock ? ` · unlocks the ${e.unlock}` : ''}</span>
              </div>
              {e.completed && <p style={{ fontWeight: 800 }}>Goal reached! {e.unlock ? `Find the ${e.unlock} in the village.` : ''}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- shop ---------------- */
interface ShopItem { key: string; kind: CosmeticKind; name: string; price: number | null; color?: string; hat?: string; title?: string; minLevel?: number; owned: boolean; equipped: boolean; locked: boolean; }
const KIND_LABEL: Record<CosmeticKind, string> = { shirt: 'Shirts', hat: 'Hats', cape: 'Capes', title: 'Titles' };

export function ShopPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ coins: number; level: number; items: ShopItem[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const load = () => api.get('/api/student/shop').then(setData).catch((e) => setMsg({ kind: 'err', text: e.message }));
  useEffect(() => { load(); }, []);
  const act = async (item: ShopItem, what: 'buy' | 'equip' | 'unequip') => {
    setBusy(item.key); setMsg(null);
    try {
      if (what === 'buy') { await api.post(`/api/student/shop/${item.key}/buy`); setMsg({ kind: 'ok', text: `You bought ${item.name}. It is on your character now.` }); }
      else await api.post(`/api/student/shop/${item.key}/equip`, { on: what === 'equip' });
      await load(); onChanged();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(''); }
  };
  return (
    <Modal title="Cosmetics Shop" onClose={onClose} wide>
      <p className="muted">Spend coins on looks for your character. Cosmetics are just for fun: they never change XP, levels or answers. {data && <b style={{ color: 'var(--ink)' }}>You have {data.coins} coins.</b>}</p>
      {msg && <div className={msg.kind === 'err' ? 'error' : 'okmsg'} role="status">{msg.text}</div>}
      {!data ? <p>Loading…</p> : (Object.keys(KIND_LABEL) as CosmeticKind[]).map((kind) => {
        const items = data.items.filter((i) => i.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} style={{ marginBottom: '1rem' }}>
            <h3>{KIND_LABEL[kind]}</h3>
            <div className="shop-grid">
              {items.map((i) => (
                <div key={i.key} className={`shop-item ${i.equipped ? 'equipped' : ''}`}>
                  <Swatch item={i} />
                  <div style={{ fontWeight: 800 }}>{i.name}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {i.price === null ? 'Reward only (quests and events)' : `${i.price} coins`}{i.minLevel ? ` · Level ${i.minLevel}+` : ''}
                  </div>
                  {i.owned ? (
                    i.equipped
                      ? <button className="btn small secondary" disabled={busy === i.key} onClick={() => act(i, 'unequip')}>Take off</button>
                      : <button className="btn small" disabled={busy === i.key} onClick={() => act(i, 'equip')}>Wear</button>
                  ) : i.price !== null && (
                    <button className="btn small gold" disabled={busy === i.key || i.locked || data.coins < i.price}
                      title={i.locked ? `Reach level ${i.minLevel}` : data.coins < i.price ? 'Not enough coins yet' : ''} onClick={() => act(i, 'buy')}>
                      {i.locked ? `Level ${i.minLevel}` : data.coins < i.price ? `Need ${i.price - data.coins} more` : 'Buy'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
function Swatch({ item }: { item: ShopItem }) {
  if (item.kind === 'title') return <div className="swatch title">“{item.title}”</div>;
  const glyph = item.kind === 'hat' ? ({ cap: '🧢', crown: '👑', wizard: '🧙', tophat: '🎩', helmet: '⛑', headband: '🎗' } as Record<string, string>)[item.hat ?? ''] ?? '🎩' : item.kind === 'cape' ? '🦸' : '👕';
  return <div className="swatch" style={{ background: item.color }} aria-hidden="true"><span>{glyph}</span></div>;
}

/* ---------------- chat ---------------- */
export function ChatBox({ mode, muted, messages, presets, open, setOpen, send, teacher }: {
  mode: string; muted: boolean; messages: ChatMessage[]; presets: string[]; open: boolean; setOpen: (o: boolean) => void;
  send: (text: string) => Promise<string | null>; teacher: boolean;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [messages, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  if (mode === 'off' && !teacher) return null;
  const typed = teacher || mode === 'free';
  const doSend = async (t: string) => {
    setErr('');
    const e = await send(t);
    if (e) setErr(e); else setText('');
  };
  const recent = open ? messages.slice(-30) : messages.slice(-4);
  return (
    <section className={`hud hud-panel chat ${open ? 'open' : ''}`} aria-label="Class chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {recent.length === 0 && open && <div className="muted">No messages yet.</div>}
        {recent.map((m) => <div key={m.id} className={`chat-msg ${m.role !== 'student' ? 'teacher' : ''}`}><b>{m.name}{m.role !== 'student' ? ' (Teacher)' : ''}:</b> {m.text}</div>)}
      </div>
      {open ? (
        <div className="chat-input">
          {mode === 'off' && teacher && <div className="muted" style={{ fontSize: '0.8rem' }}>Chat is off for students. Your messages still show as announcements.</div>}
          {muted && !teacher ? <div className="muted">Your teacher has paused your chat.</div> : (<>
            {!typed || presets.length ? (
              <div className="presets">{presets.map((p) => <button key={p} className="chip" onClick={() => doSend(p)}>{p}</button>)}</div>
            ) : null}
            {typed && (
              <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) doSend(text); }}>
                <input ref={inputRef} className="input" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder={teacher ? 'Message the class…' : 'Be kind. Your teacher can see every message.'} aria-label="Chat message"
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} />
                <button className="btn small">Send</button>
              </form>
            )}
          </>)}
          {err && <div className="error" style={{ marginTop: 4 }}>{err}</div>}
          <button className="btn small ghost" onClick={() => setOpen(false)}>Close chat</button>
        </div>
      ) : (
        <button className="btn small ghost" onClick={() => setOpen(true)}>Chat <kbd>T</kbd></button>
      )}
    </section>
  );
}

/* ---------------- teacher-approval building ---------------- */
export function ApprovalBar({ pending, onSubmitted }: { pending: number; onSubmitted: () => void }) {
  const [info, setInfo] = useState<any>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/api/student/submissions').then(setInfo).catch(() => {});
  useEffect(() => { load(); setMsg(''); }, [pending]);
  if (!info || info.buildMode !== 'teacher_approval') return null;
  const waiting = info.submissions.find((s: any) => s.status === 'pending');
  const last = info.submissions[0];
  const submit = async () => {
    setMsg('');
    try { const r = await api.post('/api/student/submissions', { note }); setMsg(`Sent ${r.blocks} blocks to your teacher.`); setOpen(false); setNote(''); load(); onSubmitted(); }
    catch (e: any) { setMsg(e.message); }
  };
  return (
    <section className="hud hud-panel approval" aria-label="Build approval">
      <b>Approval building</b>
      <div style={{ fontSize: '0.85rem' }}>
        {info.pendingBlocks ? `${info.pendingBlocks} new block${info.pendingBlocks === 1 ? '' : 's'} (gold tint) only you and your teacher can see.` : 'Build in your plot. New blocks wait for your teacher.'}
      </div>
      {waiting && <div style={{ fontSize: '0.85rem' }}>✓ Sent for review. You can keep building.</div>}
      {!waiting && last?.status === 'rejected' && last.feedback && <div style={{ fontSize: '0.85rem' }}>Teacher: “{last.feedback}”</div>}
      {info.pendingBlocks > 0 && !open && <button className="btn small gold" onClick={() => setOpen(true)}>{waiting ? 'Update submission' : 'Submit build for approval'}</button>}
      {open && (
        <div className="stack" style={{ gap: 4 }}>
          <input className="input" maxLength={300} placeholder="Tell your teacher about your build (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for your teacher" />
          <div className="row" style={{ gap: 6 }}><button className="btn small gold" onClick={submit}>Send</button><button className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      )}
      {msg && <div style={{ fontSize: '0.85rem' }}>{msg}</div>}
    </section>
  );
}

/* ---------------- touch controls ---------------- */
export function TouchControls({ engine, canFly, onChat }: { engine: Engine; canFly: boolean; onChat?: () => void }) {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(engine.flying);
  useEffect(() => {
    engine.touchMode = true;
    const el = engine.renderer.domElement;
    // Drag anywhere on the world (outside the joystick) to look around.
    let lookId: number | null = null, lx = 0, ly = 0;
    const down = (e: PointerEvent) => { if (e.pointerType === 'mouse' || lookId !== null) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; };
    const move = (e: PointerEvent) => { if (e.pointerId !== lookId) return; engine.lookBy(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; };
    const up = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = null; };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.style.touchAction = 'none';
    return () => {
      engine.touchMode = false; engine.touchMove = { x: 0, z: 0 }; engine.touchJump = false;
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
  }, [engine]);

  // Joystick.
  const stickId = useRef<number | null>(null);
  const setStick = (e: React.PointerEvent) => {
    const r = stickRef.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knobRef.current!.style.transform = `translate(${dx}px, ${dy}px)`;
    const dead = 0.12;
    const nx = dx / R, nz = dy / R;
    engine.touchMove = { x: Math.abs(nx) < dead ? 0 : nx, z: Math.abs(nz) < dead ? 0 : nz };
  };
  const endStick = () => { stickId.current = null; engine.touchMove = { x: 0, z: 0 }; if (knobRef.current) knobRef.current.style.transform = ''; };
  const hold = (on: () => void, off: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); on(); },
    onPointerUp: off, onPointerCancel: off, onPointerLeave: off
  });
  return (
    <div className="touch-ui">
      <div ref={stickRef} className="stick" aria-label="Movement joystick"
        onPointerDown={(e) => { e.preventDefault(); stickId.current = e.pointerId; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setStick(e); }}
        onPointerMove={(e) => { if (e.pointerId === stickId.current) setStick(e); }}
        onPointerUp={endStick} onPointerCancel={endStick}>
        <div ref={knobRef} className="knob" />
      </div>
      <div className="touch-buttons">
        <button className="tbtn place" aria-label="Place block" onPointerDown={(e) => { e.preventDefault(); engine.placeAction(); }}>＋<small>Place</small></button>
        <button className="tbtn remove" aria-label="Remove block" onPointerDown={(e) => { e.preventDefault(); engine.removeAction(); }}>⛏<small>Remove</small></button>
        <button className="tbtn jump" aria-label={flying ? 'Fly up' : 'Jump'} {...hold(() => { engine.touchJump = true; }, () => { engine.touchJump = false; })}>⤒<small>{flying ? 'Up' : 'Jump'}</small></button>
        {canFly && <button className="tbtn" aria-label="Toggle flying" onPointerDown={(e) => { e.preventDefault(); engine.flying = !engine.flying; setFlying(engine.flying); }}>✈<small>{flying ? 'Walk' : 'Fly'}</small></button>}
        <button className="tbtn" aria-label="Switch camera" onPointerDown={(e) => { e.preventDefault(); engine.thirdPerson = !engine.thirdPerson; }}>👁<small>View</small></button>
        {onChat && <button className="tbtn" aria-label="Open chat" onPointerDown={(e) => { e.preventDefault(); onChat(); }}>💬<small>Chat</small></button>}
      </div>
    </div>
  );
}
