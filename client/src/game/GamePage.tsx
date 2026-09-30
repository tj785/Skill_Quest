import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, Me, navigate } from '../api';
import { Engine } from './Engine';
import { QuestionCenter } from './QuestionCenter';
import { InventoryPanel, CharacterPanel, MapPanel, HelpPanel, SettingsPanel, drawMap, Modal } from './Panels';
import { loadPrefs, wantsTouch } from '../ui/prefs';
import { currentSearch } from '../nav';
import { QuestTracker, QuestLogPanel, ShopPanel, ChatBox, ApprovalBar, TouchControls, QuestData } from './Extras';
import {
  BLOCKS, BLOCK_BY_ID, TIER_LABEL, REGIONS, RegionKey, levelProgress, titleForLevel, TIERS, ServerToClient, ClientToServer, PlayerState, VILLAGE_Y, SPAWN, ChatMessage, CHAT_PRESETS
} from '@cq/shared';

type Menu = null | 'questions' | 'inventory' | 'character' | 'skills' | 'achievements' | 'map' | 'help' | 'settings' | 'world' | 'quests' | 'shop';
interface Toast { id: number; kind: 'info' | 'error' | 'reward'; text: string; }

const tierRank = (id: number) => TIERS.indexOf(BLOCK_BY_ID[id]?.tier as any);

export function GamePage({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const teacher = me.role !== 'student';
  const classId = teacher ? Number(new URLSearchParams(currentSearch()).get('class')) : me.classId;
  const mount = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sockRef = useRef<Socket<ServerToClient, ClientToServer> | null>(null);
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  const [locked, setLocked] = useState(false);
  const [menu, setMenuState] = useState<Menu>(null);
  const [profile, setProfile] = useState<any>(null);
  const [inventory, setInventory] = useState<Record<number, number>>({});
  const [hotbar, setHotbar] = useState<(number | null)[]>(Array(9).fill(null));
  const [sel, setSel] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [region, setRegion] = useState<RegionKey>('village');
  const [nearQuest, setNearQuest] = useState(false);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string } | null>(null);
  const [quests, setQuests] = useState<any>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [questData, setQuestData] = useState<QuestData | null>(null);
  const [chat, setChat] = useState<{ mode: string; muted: boolean; messages: ChatMessage[]; presets: string[] }>({ mode: 'off', muted: false, messages: [], presets: CHAT_PRESETS });
  const [chatOpen, setChatOpenState] = useState(false);
  const [pendingBlocks, setPendingBlocks] = useState(0);
  const [touch, setTouch] = useState(() => wantsTouch());
  const [navOpen, setNavOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1500);
  const [dropped, setDropped] = useState('');
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 1500); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const minimap = useRef<HTMLCanvasElement>(null);
  const menuRef = useRef<Menu>(null);
  const levelRef = useRef(0);

  const chatOpenRef = useRef(false);
  const setMenu = useCallback((m: Menu) => {
    menuRef.current = m;
    setMenuState(m);
    const e = engineRef.current;
    if (e) { e.inputEnabled = m === null && !chatOpenRef.current; if (m) e.releasePointer(); }
  }, []);
  const setChatOpen = useCallback((o: boolean) => {
    chatOpenRef.current = o;
    setChatOpenState(o);
    const e = engineRef.current;
    if (e) { e.inputEnabled = !o && menuRef.current === null; if (o) e.releasePointer(); }
  }, []);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 3500 : 4500);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (teacher) return;
    const p = await api.get('/api/student/me');
    setProfile(p);
    setInventory(p.inventory);
    if (levelRef.current && p.level > levelRef.current) setLevelUp({ level: p.level, title: p.title });
    levelRef.current = p.level;
  }, [teacher]);
  const refreshQuests = useCallback(() => { if (!teacher) api.get('/api/student/questions').then(setQuests).catch(() => {}); }, [teacher]);
  // Quest numbers can change on every block placed; coalesce bursts into one request.
  const questTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshQuestData = useCallback(() => {
    if (teacher || questTimer.current) return;
    questTimer.current = setTimeout(() => { questTimer.current = null; api.get('/api/student/quests').then(setQuestData).catch(() => {}); }, 300);
  }, [teacher]);
  const loadChat = useCallback(async () => {
    try {
      if (teacher) {
        const rows = await api.get(`/api/teacher/classes/${classId}/chat`);
        setChat((c) => ({ ...c, messages: rows.filter((m: any) => !m.hidden).reverse().slice(-40).map((m: any) => ({ id: m.id, userId: m.user_id, name: m.name ?? 'Someone', role: m.role, text: m.text, at: m.created_at })) }));
      } else {
        const r = await api.get('/api/student/chat');
        setChat({ mode: r.mode, muted: r.muted, messages: r.messages, presets: r.presets });
      }
    } catch { /* chat is optional */ }
  }, [teacher, classId]);
  const sendChat = useCallback((text: string) => new Promise<string | null>((resolve) => {
    const s = sockRef.current;
    if (!s) return resolve('Not connected.');
    s.emit('chat', { text }, (r) => resolve(r.ok ? null : r.error || 'Message not sent.'));
  }), []);
  const bumpPending = useCallback(() => setPendingBlocks(engineRef.current?.pendingCount ?? 0), []);

  // Fill empty hotbar slots with new blocks as they arrive (lowest tier first, so basics are easy to find).
  useEffect(() => {
    setHotbar((hb) => {
      const owned = teacher ? BLOCKS.filter((b) => b.tier !== 'natural').map((b) => b.id) : Object.keys(inventory).map(Number).filter((id) => inventory[id] > 0);
      const next = [...hb];
      const present = new Set(next.filter((x): x is number => x !== null));
      const add = owned.filter((id) => !present.has(id)).sort((a, b) => tierRank(a) - tierRank(b) || a - b);
      for (let i = 0; i < 9 && add.length; i++) if (next[i] === null) next[i] = add.shift()!;
      if (!teacher) for (let i = 0; i < 9 && add.length; i++) if (next[i] !== null && !(inventory[next[i]!] > 0)) next[i] = add.shift()!;
      return next;
    });
  }, [inventory, teacher]);

  /* ---------- boot: profile, socket, engine ---------- */
  useEffect(() => {
    let disposed = false;
    if (teacher && !classId) { setFatal('Open the world from the teacher dashboard so we know which class to enter.'); return; }
    (async () => {
      try {
        if (!teacher) { await refreshProfile(); refreshQuests(); refreshQuestData(); }
        else setZones(await api.get(`/api/teacher/classes/${classId}/zones`));
        loadChat();
        if (!teacher) api.get('/api/student/classmates').catch(() => []);
      } catch (e: any) { setFatal(e.message); return; }
      const sock: Socket<ServerToClient, ClientToServer> = io({ auth: { classId }, transports: ['websocket', 'polling'] });
      sockRef.current = sock;
      sock.on('connect_error', (e) => setFatal(`Could not connect to the world: ${e.message}`));
      sock.on('connect', () => setDropped(''));
      sock.on('disconnect', (reason) => {
        if (disposed) return;
        // The server closed it (signed out, account changed): don't pretend the world still works.
        if (reason === 'io server disconnect') setFatal('You have been signed out of the world. Log in again to keep playing.');
        else setDropped('Connection lost. Reconnecting…');
      });
      sock.on('welcome', async (w) => {
        if (disposed) return;
        engineRef.current?.dispose();
        const engine = new Engine(mount.current!, w.seed, {
          onMove: (p) => sock.emit('move', p),
          requestPlace: (x, y, z) => {
            const b = hotbarRef.current[selRef.current];
            if (!b) return toast('info', 'Pick a block in your hotbar first (1-9).');
            if (!teacher && !(invRef.current[b] > 0)) return toast('info', `No ${BLOCK_BY_ID[b].name} left. Answer questions to earn more.`);
            sock.emit('place', { x, y, z, b }, (r) => { if (!r.ok) toast('error', r.error || 'Could not place.'); });
          },
          requestRemove: (x, y, z) => sock.emit('remove', { x, y, z }, (r) => { if (!r.ok) toast('error', r.error || 'Could not remove.'); }),
          onRegion: (r) => setRegion(r),
          onHint: (t) => toast('info', t),
          onNearQuestCenter: (n) => setNearQuest(n),
          onPointerLock: (l) => setLocked(l),
          onHotbarKey: (i) => setSel(i),
          onHotbarScroll: (d) => setSel((s) => (s + d + 9) % 9),
          onHotkey: (k) => {
            if (k === 't') { setChatOpen(true); return; }
            const map: Record<string, Menu> = { q: 'questions', i: 'inventory', c: 'character', k: 'skills', j: 'achievements', m: 'map', h: 'help', l: 'quests', b: 'shop' };
            if (k === 'e') { if (engine && nearRef.current && !teacher) setMenu('questions'); else if (!teacher) toast('info', 'Walk to the Quest Center (blue label) and press E, or press Q anywhere.'); return; }
            if (teacher && ['q', 'c', 'k', 'j', 'l', 'b'].includes(k)) return;
            setMenu(map[k] ?? null);
          }
        });
        engineRef.current = engine;
        (window as any).__cqEngine = engine; // handy for debugging and automated tests; the server stays authoritative
        const prefs = loadPrefs();
        engine.sensitivity = prefs.sensitivity; engine.invertY = prefs.invertY;
        engine.setSelf(w.you);
        await engine.generate(w.edits, (p) => setLoading(p));
        if (disposed) return;
        for (const p of w.players) engine.addRemote(p);
        setPlayers(w.players);
        if (!teacher && profileRef.current) engine.addPlotMarker(profileRef.current.plot, `${me.displayName}'s plot`, VILLAGE_Y + 1);
        engine.start();
        bumpPending();
        setReady(true);
      });
      sock.on('playerJoined', (p) => { engineRef.current?.addRemote(p); setPlayers((ps) => [...ps.filter((x) => x.id !== p.id), p]); });
      sock.on('playerLeft', ({ id }) => { engineRef.current?.removeRemote(id); setPlayers((ps) => ps.filter((x) => x.id !== id)); });
      sock.on('playerMoved', (d) => engineRef.current?.moveRemote(d.id, d.x, d.y, d.z, d.yaw));
      sock.on('blockChanged', (e) => { engineRef.current?.applyEdit(e); bumpPending(); });
      sock.on('blockBatch', ({ edits }) => { for (const e of edits) engineRef.current?.applyEdit(e); bumpPending(); });
      sock.on('blocksReset', ({ edits }) => { engineRef.current?.resetEdits(edits); bumpPending(); });
      sock.on('playerUpdated', (p) => {
        engineRef.current?.updateLook(p.id, p.look, p.level);
        setPlayers((ps) => ps.map((x) => (x.id === p.id ? { ...x, look: p.look, level: p.level } : x)));
      });
      sock.on('chat', (m) => setChat((c) => ({ ...c, messages: [...c.messages.filter((x) => x.id !== m.id), m].slice(-60) })));
      sock.on('chatHidden', ({ id }) => setChat((c) => ({ ...c, messages: c.messages.filter((x) => x.id !== id) })));
      sock.on('chatConfig', ({ mode, muted }) => { setChat((c) => ({ ...c, mode, muted })); if (mode === 'off' && !teacher) setChatOpen(false); });
      sock.on('questUpdate', () => refreshQuestData());
      sock.on('inventory', ({ items }) => setInventory(items));
      sock.on('toast', ({ kind, text }) => toast(kind, text));
      sock.on('teleport', (p) => engineRef.current?.teleport(p.x, p.y, p.z));
      sock.on('frozen', ({ frozen }) => { setFrozen(frozen); if (engineRef.current) engineRef.current.frozen = frozen; });
      sock.on('progress', () => { refreshProfile(); refreshQuests(); refreshQuestData(); });
    })();
    return () => { disposed = true; sockRef.current?.disconnect(); engineRef.current?.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs so engine callbacks always see the latest React state.
  const hotbarRef = useRef(hotbar); hotbarRef.current = hotbar;
  const selRef = useRef(sel); selRef.current = sel;
  const invRef = useRef(inventory); invRef.current = inventory;
  const nearRef = useRef(nearQuest); nearRef.current = nearQuest;
  const profileRef = useRef(profile); profileRef.current = profile;

  // Esc closes menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuRef.current) setMenu(null);
      else if (chatOpenRef.current) setChatOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMenu, setChatOpen]);

  // Minimap refresh.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const e = engineRef.current, c = minimap.current;
      if (!e || !c) return;
      drawMap(c.getContext('2d')!, e, e.pos.x, e.pos.z, 36, 170, { plot: profileRef.current?.plot, zones, players: e.remotePlayers(), lockedRegions: lockedRegions });
    }, 250);
    return () => clearInterval(t);
  });

  useEffect(() => { if (levelUp) { const t = setTimeout(() => setLevelUp(null), 2700); return () => clearTimeout(t); } }, [levelUp]);

  const lockedRegions = useMemo(() => new Set<RegionKey>((profile?.regions ?? []).filter((r: any) => !r.unlocked).map((r: any) => r.key)), [profile]);
  const onRewarded = (r: any) => {
    if (r.reward) {
      toast('reward', r.message);
      if (r.reward.leveledUp) setLevelUp({ level: r.reward.level, title: r.reward.title });
    }
    refreshProfile(); refreshQuests(); refreshQuestData();
  };
  const icon = (id: number) => engineRef.current?.atlas.icon(id) ?? '';
  const lp = profile ? levelProgress(profile.xp) : null;
  const selBlock = hotbar[sel];

  const menus: [Menu, string, string][] = teacher
    ? [['inventory', 'Blocks', 'I'], ['map', 'Map', 'M'], ['world', 'World tools', ''], ['help', 'Help', 'H'], ['settings', 'Settings', '']]
    : [['questions', 'Questions', 'Q'], ['quests', 'Quests', 'L'], ['inventory', 'Inventory', 'I'], ['character', 'Character', 'C'], ['skills', 'Skills', 'K'], ['achievements', 'Achievements', 'J'], ['shop', 'Shop', 'B'], ['map', 'Map', 'M'], ['help', 'Help', 'H'], ['settings', 'Settings', '']];

  if (fatal) return (
    <div className="loading-screen"><h2>Character Quest</h2><p>{fatal}</p>
      <div className="row"><button className="btn" onClick={() => location.reload()}>Try again</button><button className="btn secondary" onClick={() => navigate(teacher ? '/teacher' : '/')}>Back</button><button className="btn secondary" onClick={onLogout}>Log out</button></div></div>
  );

  return (
    <div className={`game-root ${touch ? 'touch' : ''}`}>
      <div ref={mount} style={{ position: 'absolute', inset: 0 }} />
      {!ready && (
        <div className="loading-screen" role="status">
          <h2>Building the world…</h2>
          <div className="bar"><span style={{ width: `${Math.round(loading * 100)}%` }} /></div>
          <p className="muted" style={{ color: '#c9d1e8' }}>{Math.round(loading * 100)}%</p>
        </div>
      )}
      {ready && (<>
        <div className="crosshair" aria-hidden="true" />
        {/* Top left: character */}
        <section className="hud hud-panel hud-char" aria-label="Your character">
          <div className="name">{me.displayName}{teacher && <span className="tag" style={{ marginLeft: 8 }}>Teacher</span>}</div>
          {lp && profile && (<>
            <div style={{ fontWeight: 800 }}>Level {lp.level} · {titleForLevel(lp.level)}</div>
            <div className="xpbar" role="progressbar" aria-label="Experience" aria-valuenow={profile.xp} aria-valuemin={lp.levelStart} aria-valuemax={lp.nextLevelXp}><span style={{ width: `${lp.pct * 100}%` }} /></div>
            <div className="num" style={{ fontSize: '0.85rem' }}>{profile.xp.toLocaleString()} / {lp.nextLevelXp.toLocaleString()} XP · {profile.coins} coins</div>
          </>)}
          {teacher && <div style={{ fontSize: '0.85rem' }}>Unlimited blocks. Press G to fly.</div>}
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {teacher && <button className="btn small ghost" onClick={() => navigate('/teacher')}>Dashboard</button>}
            <button className="btn small ghost" onClick={onLogout}>Log out</button>
          </div>
        </section>
        {/* Top center: menu */}
        {touch || narrow ? (
          <nav className={`hud hud-panel hud-menu touch-menu ${navOpen ? 'open' : ''}`} aria-label="Game menu">
            <button aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>☰ Menu</button>
            {navOpen && menus.map(([k, label]) => <button key={k} aria-pressed={menu === k} onClick={() => { setNavOpen(false); setMenu(menu === k ? null : k); }}>{label}</button>)}
          </nav>
        ) : (
          <nav className="hud hud-panel hud-menu" aria-label="Game menu">
            {menus.map(([k, label, key]) => <button key={k} aria-pressed={menu === k} onClick={() => setMenu(menu === k ? null : k)}>{label}{key && <kbd>{key}</kbd>}</button>)}
          </nav>
        )}
        {/* Top right: minimap */}
        <section className="hud hud-panel hud-minimap" aria-label="Minimap">
          <canvas ref={minimap} width={170} height={170} aria-hidden="true" />
          <div className="region">{REGIONS[region].name}{lockedRegions.has(region) ? ' (locked)' : ''}</div>
        </section>
        {/* Right: quests */}
        {!teacher && quests && (
          <section className="hud hud-panel hud-quests" aria-label="Quests">
            <h3>Quests</h3>
            {quests.assignments.filter((a: any) => !a.completed).slice(0, 3).map((a: any) => (
              <div className="q" key={a.id}>
                <b>{a.title}</b>
                <div className="xpbar" style={{ height: 8 }}><span style={{ width: `${(Number(a.done) / Math.max(1, Number(a.total))) * 100}%` }} /></div>
                <div style={{ fontSize: '0.8rem' }}>{a.done}/{a.total} · +{a.xp_reward} XP</div>
              </div>
            ))}
            {quests.recommendations.slice(0, 2).map((r: any) => <div className="q" key={r.topic}>★ Practice: <b>{r.topic}</b></div>)}
            {(() => { const open = quests.questions.filter((q: any) => !q.earned).length; return <div className="q">{open ? `${open} questions waiting at the Quest Center` : 'All questions complete'}</div>; })()}
            <QuestTracker data={questData} onOpen={() => setMenu('quests')} />
            <button className="btn small gold" onClick={() => setMenu('questions')}>Open Question Center</button>
          </section>
        )}
        {!teacher && profile?.buildMode === 'teacher_approval' && <ApprovalBar pending={pendingBlocks} onSubmitted={() => {}} />}
        <ChatBox mode={chat.mode} muted={chat.muted} messages={chat.messages} presets={teacher ? [] : chat.presets} open={chatOpen} setOpen={setChatOpen} send={sendChat} teacher={teacher} />
        {touch && engineRef.current && !menu && <TouchControls engine={engineRef.current} canFly={teacher} onChat={teacher || chat.mode !== 'off' ? () => setChatOpen(!chatOpenRef.current) : undefined} />}
        {/* Bottom: hotbar */}
        {selBlock && <div className="hud hotbar-label">{BLOCK_BY_ID[selBlock].name}{!teacher && ` · ${inventory[selBlock] ?? 0} left`} · {TIER_LABEL[BLOCK_BY_ID[selBlock].tier]}</div>}
        <nav className="hud hud-panel hud-hotbar" aria-label="Hotbar">
          {hotbar.map((b, i) => (
            <button key={i} className={`slot ${i === sel ? 'sel' : ''}`} onClick={() => setSel(i)} aria-label={b ? `Slot ${i + 1}: ${BLOCK_BY_ID[b].name}${teacher ? '' : `, ${inventory[b] ?? 0} left`}` : `Slot ${i + 1}: empty`} aria-pressed={i === sel}>
              <span className="key">{i + 1}</span>
              {b && <img src={icon(b)} alt="" style={{ opacity: teacher || inventory[b] > 0 ? 1 : 0.35 }} />}
              {b && !teacher && <span className="cnt">{inventory[b] ?? 0}</span>}
            </button>
          ))}
        </nav>
        {nearQuest && !teacher && !menu && (touch
          ? <button className="hud hud-panel prompt" onClick={() => setMenu('questions')}>Tap here to enter the Question Center</button>
          : <div className="hud hud-panel prompt">Press <b>E</b> to enter the Question Center</div>)}
        {dropped && <div className="hud hud-panel prompt" role="status" style={{ top: '30%' }}>{dropped}</div>}
        {frozen && <div className="hud hud-panel prompt" style={{ top: '40%' }}>Your teacher has paused your character.</div>}
        {!locked && !menu && !touch && !chatOpen && (
          <div className="click-to-play">
            <div className="card">
              <h2>{teacher ? 'Teacher view' : `Welcome, ${me.displayName}!`}</h2>
              <p>{teacher ? 'Explore your class world, build with any block, and see students live.' : 'Answer questions at the Quest Center to earn blocks, then build in your plot.'}</p>
              <div className="keys" style={{ justifyContent: 'center' }}>
                <kbd>W A S D</kbd><span>Move · <kbd>Space</kbd> jump</span>
                <kbd>Right click</kbd><span>Place block</span>
                <kbd>Left click</kbd><span>Remove block</span>
                <kbd>{teacher ? 'M' : 'Q'}</kbd><span>{teacher ? 'Map' : 'Question Center'} · <kbd>H</kbd> all controls</span>
              </div>
              <button className="btn gold" onClick={() => engineRef.current?.requestPointer()}>Click to play</button>
            </div>
          </div>
        )}
        <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
        {levelUp && <div className="levelup" role="status"><h2>LEVEL {levelUp.level}!</h2><p>You are now a {levelUp.title}. New areas and materials may be unlocked.</p></div>}
      </>)}

      {menu === 'questions' && <QuestionCenter onClose={() => setMenu(null)} onRewarded={onRewarded} icon={icon} />}
      {menu === 'inventory' && <InventoryPanel inventory={inventory} hotbar={hotbar} selected={sel} icon={icon} teacher={teacher}
        onAssign={(id) => setHotbar((hb) => { const n = hb.map((x) => (x === id ? null : x)); n[sel] = id; return n; })} onClose={() => setMenu(null)} />}
      {(menu === 'character' || menu === 'skills' || menu === 'achievements') && profile && <CharacterPanel profile={profile} tab={menu} onClose={() => setMenu(null)} />}
      {menu === 'map' && engineRef.current && <MapPanel engine={engineRef.current} plot={profile?.plot} zones={zones} lockedRegions={lockedRegions} onClose={() => setMenu(null)} />}
      {menu === 'help' && <HelpPanel teacher={teacher} onClose={() => setMenu(null)} />}
      {menu === 'settings' && <SettingsPanel onClose={() => setMenu(null)} onChange={(p) => { if (engineRef.current) { engineRef.current.sensitivity = p.sensitivity; engineRef.current.invertY = p.invertY; } setTouch(wantsTouch(p)); }} />}
      {menu === 'quests' && !teacher && <QuestLogPanel data={questData} reload={refreshQuestData} onClose={() => setMenu(null)} />}
      {menu === 'shop' && !teacher && <ShopPanel onClose={() => setMenu(null)} onChanged={refreshProfile} />}
      {menu === 'world' && teacher && (
        <Modal title="World tools" onClose={() => setMenu(null)}>
          <p>Students online: {players.filter((p) => p.role === 'student').length}. Click a name to jump to them.</p>
          <div className="row">
            {players.map((p) => <button key={p.id} className="btn secondary" onClick={() => { const e = engineRef.current!; const s = e.remotePlayers().find((x) => x.id === p.id) ?? p; e.teleport(s.x, s.y + 2, s.z + 2); e.flying = true; setMenu(null); }}>{p.name}</button>)}
            {players.length === 0 && <span className="muted">No one else is in the world right now.</span>}
          </div>
          <p style={{ marginTop: '1rem' }}>Building permissions, resets and freezing are in the dashboard under <b>World</b>.</p>
          <button className="btn secondary" onClick={() => { engineRef.current!.teleport(SPAWN.x, SPAWN.y, SPAWN.z); setMenu(null); }}>Go to spawn</button>
        </Modal>
      )}
    </div>
  );
}
