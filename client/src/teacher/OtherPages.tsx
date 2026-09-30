import { useState } from 'react';
import { api } from '../api';
import { useLoad, Cls } from './TeacherApp';
import { BLOCKS, BLOCK_BY_ID, DIFFICULTIES, TIER_LABEL, BUILD_MODES, BUILD_MODE_LABEL, REGIONS, plotBounds, CENTER, difficultyDef, COSMETICS } from '@cq/shared';

const rewardBlocks = BLOCKS.filter((b) => b.tier !== 'natural');
export function BlockSelect({ id, value, onChange }: { id: string; value: string | number; onChange: (v: string) => void }) {
  return <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}><option value="">No block</option>{rewardBlocks.map((b) => <option key={b.id} value={b.id}>{b.name} ({TIER_LABEL[b.tier]})</option>)}</select>;
}

/* ---------------- Assignments ---------------- */
export function AssignmentsPage({ cls }: { cls: Cls }) {
  const [rows, reload] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/assignments`), [cls.id]);
  const [qs] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/questions`), [cls.id]);
  const [students] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const [f, setF] = useState({ title: '', description: '', xp_reward: 500, block_id: '' as string | number, block_qty: 10, coin_reward: 50, target: 'class', due_date: '' });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [who, setWho] = useState<Set<number>>(new Set());
  const [topic, setTopic] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (s: Set<number>, id: number) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; };
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/teacher/classes/${cls.id}/assignments`, { ...f, xp_reward: Number(f.xp_reward), block_qty: Number(f.block_qty), coin_reward: Number(f.coin_reward), block_id: f.block_id === '' ? null : Number(f.block_id), question_ids: [...picked], student_ids: [...who], due_date: f.due_date || null });
      setMsg({ ok: true, text: 'Assignment created. Students see it in the Question Center.' }); setPicked(new Set()); setWho(new Set()); setF({ ...f, title: '', description: '' }); reload();
    } catch (x: any) { setMsg({ ok: false, text: x.message }); }
  }
  const visibleQs = (qs ?? []).filter((q) => !topic || `${q.subject} ${q.topic ?? ''}`.toLowerCase().includes(topic.toLowerCase()));
  return (
    <div className="stack">
      <h1>Assignments</h1>
      <p className="muted">An assignment groups questions. When a student answers all of them correctly, they get the bonus reward.</p>
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <div className="card" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Assignment</th><th>Questions</th><th>For</th><th>Bonus</th><th>Completed by</th><th></th></tr></thead>
          <tbody>{(rows ?? []).map((a) => (
            <tr key={a.id}><td><b>{a.title}</b><div className="muted">{a.description}</div></td><td className="num">{a.question_ids?.length ?? 0}</td>
              <td>{a.target === 'class' ? 'Whole class' : `${a.student_ids?.length ?? 0} students`}</td>
              <td style={{ fontSize: '0.85rem' }}>{a.xp_reward} XP{a.block_id ? `, ${a.block_qty} ${BLOCK_BY_ID[a.block_id]?.name}` : ''}{a.coin_reward ? `, ${a.coin_reward} coins` : ''}</td>
              <td className="num">{a.completed}</td>
              <td><button className="btn small danger" onClick={async () => { if (confirm('Delete this assignment?')) { await api.del(`/api/teacher/classes/${cls.id}/assignments/${a.id}`); reload(); } }}>Delete</button></td></tr>
          ))}</tbody></table>
        {rows?.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No assignments yet.</p>}
      </div>
      <form className="card" onSubmit={create}>
        <h3>New assignment</h3>
        <div className="grid2">
          <div className="field"><label htmlFor="at">Title</label><input id="at" className="input" placeholder="Fractions Challenge" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="ad">Description</label><input id="ad" className="input" placeholder="Complete 10 fraction questions." value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <div className="grid4">
          <div className="field"><label htmlFor="ax">Bonus XP</label><input id="ax" type="number" min={0} className="input" value={f.xp_reward} onChange={(e) => setF({ ...f, xp_reward: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="ab">Bonus block</label><BlockSelect id="ab" value={f.block_id} onChange={(v) => setF({ ...f, block_id: v })} /></div>
          <div className="field"><label htmlFor="aq">Quantity</label><input id="aq" type="number" min={0} className="input" value={f.block_qty} onChange={(e) => setF({ ...f, block_qty: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="ac">Bonus coins</label><input id="ac" type="number" min={0} className="input" value={f.coin_reward} onChange={(e) => setF({ ...f, coin_reward: Number(e.target.value) })} /></div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="label">Assign to:</span>
          <label className="row" style={{ gap: 4 }}><input type="radio" checked={f.target === 'class'} onChange={() => setF({ ...f, target: 'class' })} /> Whole class</label>
          <label className="row" style={{ gap: 4 }}><input type="radio" checked={f.target === 'students'} onChange={() => setF({ ...f, target: 'students' })} /> Chosen students</label>
          <label className="row" style={{ gap: 4 }}>Due <input type="date" className="input" style={{ width: 170 }} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
        </div>
        {f.target === 'students' && <div className="row" style={{ marginBottom: 10 }}>{(students ?? []).map((s) => <label key={s.id} className="tag" style={{ cursor: 'pointer' }}><input type="checkbox" checked={who.has(s.id)} onChange={() => setWho(toggle(who, s.id))} /> {s.display_name}</label>)}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="label">Questions ({picked.size} chosen)</span><input className="input" style={{ width: 240 }} placeholder="Filter by subject or topic" aria-label="Filter questions" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 8, margin: '8px 0 12px' }}>
          {visibleQs.map((q) => <label key={q.id} className="row" style={{ padding: '4px 0', cursor: 'pointer' }}><input type="checkbox" checked={picked.has(q.id)} onChange={() => setPicked(toggle(picked, q.id))} /> <span className="tag">{q.subject}{q.topic ? ` · ${q.topic}` : ''}</span> {q.prompt}</label>)}
        </div>
        <button className="btn" disabled={!picked.size || !f.title}>Create assignment</button>
      </form>
    </div>
  );
}

/* ---------------- Rewards ---------------- */
export function RewardsPage({ cls }: { cls: Cls }) {
  const [students] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const [skills, reloadSkills] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/skills`), [cls.id]);
  const [who, setWho] = useState<Set<number>>(new Set());
  const [f, setF] = useState({ xp: 100, coins: 0, skill_id: '', skill_amount: 0, block_id: '' as string | number, block_qty: 0, reason: '', item_key: '' });
  const [newSkill, setNewSkill] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function give(e: React.FormEvent) {
    e.preventDefault();
    try {
      for (const id of who) await api.post(`/api/teacher/students/${id}/reward`, { xp: Number(f.xp), coins: Number(f.coins), skill_id: f.skill_id ? Number(f.skill_id) : null, skill_amount: Number(f.skill_amount), block_id: f.block_id === '' ? null : Number(f.block_id), block_qty: Number(f.block_qty), reason: f.reason || undefined, item_key: f.item_key || null });
      setMsg({ ok: true, text: `Reward sent to ${who.size} student${who.size === 1 ? '' : 's'}.` });
    } catch (x: any) { setMsg({ ok: false, text: x.message }); }
  }
  return (
    <div className="stack">
      <h1>Rewards</h1>
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <form className="card" onSubmit={give}>
        <h3>Give a bonus reward</h3>
        <p className="muted">For participation, class events or real-world achievements. It goes through the same reward system as questions.</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <button type="button" className="btn small secondary" onClick={() => setWho(new Set((students ?? []).map((s) => s.id)))}>Select everyone</button>
          {(students ?? []).map((s) => <label key={s.id} className="tag" style={{ cursor: 'pointer' }}><input type="checkbox" checked={who.has(s.id)} onChange={() => { const n = new Set(who); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setWho(n); }} /> {s.display_name}</label>)}
        </div>
        <div className="grid4">
          <div className="field"><label htmlFor="rx">XP</label><input id="rx" type="number" min={0} className="input" value={f.xp} onChange={(e) => setF({ ...f, xp: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="rs">Skill</label><select id="rs" className="input" value={f.skill_id} onChange={(e) => setF({ ...f, skill_id: e.target.value })}><option value="">None</option>{(skills ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="rsa">Skill points</label><input id="rsa" type="number" min={0} className="input" value={f.skill_amount} onChange={(e) => setF({ ...f, skill_amount: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="rc">Coins</label><input id="rc" type="number" min={0} className="input" value={f.coins} onChange={(e) => setF({ ...f, coins: Number(e.target.value) })} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="rb">Block</label><BlockSelect id="rb" value={f.block_id} onChange={(v) => setF({ ...f, block_id: v })} /></div>
          <div className="field"><label htmlFor="rq">Quantity</label><input id="rq" type="number" min={0} className="input" value={f.block_qty} onChange={(e) => setF({ ...f, block_qty: Number(e.target.value) })} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="ri">Cosmetic item (optional)</label>
            <select id="ri" className="input" value={f.item_key} onChange={(e) => setF({ ...f, item_key: e.target.value })}>
              <option value="">None</option>{COSMETICS.map((c) => <option key={c.key} value={c.key}>{c.name}{c.price === null ? ' (reward only)' : ''}</option>)}
            </select></div>
          <div className="field"><label htmlFor="rr">Reason (shown to students)</label><input id="rr" className="input" placeholder="Walk-a-thon helper" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        <button className="btn gold" disabled={!who.size}>Send reward</button>
      </form>
      <div className="grid2">
        <div className="card">
          <h3>Skills</h3>
          <p className="muted">Questions can raise any of these. Add your own.</p>
          <div className="row" style={{ marginBottom: 10 }}>{(skills ?? []).map((s) => <span key={s.id} className="tag">{s.name} <button className="btn small ghost" style={{ minHeight: 24, padding: '0 6px' }} aria-label={`Remove ${s.name}`} onClick={async () => { if (confirm(`Remove the ${s.name} skill?`)) { await api.del(`/api/teacher/classes/${cls.id}/skills/${s.id}`); reloadSkills(); } }}>×</button></span>)}</div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!newSkill.trim()) return; await api.post(`/api/teacher/classes/${cls.id}/skills`, { name: newSkill }); setNewSkill(''); reloadSkills(); }}>
            <input className="input" style={{ width: 220 }} placeholder="e.g. Teamwork" aria-label="New skill" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} /><button className="btn">Add skill</button>
          </form>
        </div>
        <div className="card">
          <h3>Default rewards by difficulty</h3>
          <table className="table"><thead><tr><th>Level</th><th>XP</th><th>Skill</th><th>Block</th><th>Coins</th></tr></thead>
            <tbody>{DIFFICULTIES.map((d) => <tr key={d.level}><td>{d.level} · {d.name}</td><td>{d.xp}</td><td>+{d.skill}</td><td>{d.quantity} {BLOCKS.find((b) => b.key === d.blockKey)?.name} ({TIER_LABEL[d.tier]})</td><td>{d.coins}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Achievements ---------------- */
const CRITERIA: Record<string, string> = {
  questions_answered: 'Questions tried', correct_answers: 'Questions answered correctly', correct_in_subject: 'Correct answers in a subject',
  hard_correct: 'Difficult (level 3+) questions correct', blocks_placed: 'Blocks placed', xp_total: 'Total XP', assignments_completed: 'Assignments completed', manual: 'Given by teacher'
};
export function AchievementsPage({ cls }: { cls: Cls }) {
  const [rows, reload] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/achievements`), [cls.id]);
  const [f, setF] = useState({ name: '', description: '', criteria_type: 'correct_in_subject', criteria_subject: 'Math', threshold: 10, xp_reward: 100, coin_reward: 0 });
  const [err, setErr] = useState('');
  return (
    <div className="stack">
      <h1>Achievements</h1>
      <div className="card" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Achievement</th><th>How to earn</th><th>Reward</th><th>Earned by</th><th></th></tr></thead>
          <tbody>{(rows ?? []).map((a) => (
            <tr key={a.id}><td><b>{a.name}</b><div className="muted">{a.description}</div></td>
              <td>{CRITERIA[a.criteria_type]}{a.criteria_subject ? ` (${a.criteria_subject})` : ''}{a.criteria_type !== 'manual' ? `: ${a.threshold}` : ''}</td>
              <td>{a.xp_reward} XP{a.coin_reward ? `, ${a.coin_reward} coins` : ''}</td><td className="num">{a.earned_by}</td>
              <td>{String(a.key).startsWith('custom_') && <button className="btn small danger" onClick={async () => { if (confirm('Delete this achievement?')) { await api.del(`/api/teacher/classes/${cls.id}/achievements/${a.id}`); reload(); } }}>Delete</button>}</td></tr>
          ))}</tbody></table>
      </div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await api.post(`/api/teacher/classes/${cls.id}/achievements`, { ...f, threshold: Number(f.threshold), xp_reward: Number(f.xp_reward), coin_reward: Number(f.coin_reward), criteria_subject: f.criteria_type === 'correct_in_subject' ? f.criteria_subject : null }); setF({ ...f, name: '', description: '' }); reload(); } catch (x: any) { setErr(x.message); } }}>
        <h3>Create an achievement</h3>
        {err && <div className="error">{err}</div>}
        <div className="grid2">
          <div className="field"><label htmlFor="an">Name</label><input id="an" className="input" placeholder="Fraction Master" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="adesc">Description</label><input id="adesc" className="input" placeholder="Answer 20 fraction questions correctly." value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <div className="grid4">
          <div className="field"><label htmlFor="acr">Earned by</label><select id="acr" className="input" value={f.criteria_type} onChange={(e) => setF({ ...f, criteria_type: e.target.value })}>{Object.entries(CRITERIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {f.criteria_type === 'correct_in_subject' && <div className="field"><label htmlFor="asu">Subject</label><input id="asu" className="input" value={f.criteria_subject} onChange={(e) => setF({ ...f, criteria_subject: e.target.value })} /></div>}
          {f.criteria_type !== 'manual' && <div className="field"><label htmlFor="ath">Amount needed</label><input id="ath" type="number" min={1} className="input" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} /></div>}
          <div className="field"><label htmlFor="axp">Reward XP</label><input id="axp" type="number" min={0} className="input" value={f.xp_reward} onChange={(e) => setF({ ...f, xp_reward: Number(e.target.value) })} /></div>
        </div>
        <button className="btn" disabled={!f.name || !f.description}>Create achievement</button>
      </form>
    </div>
  );
}

/* ---------------- World ---------------- */
export function WorldPage({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [zones, reloadZones] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/zones`), [cls.id]);
  const [buildings, reloadB] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/buildings`), [cls.id]);
  const [students] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const [z, setZ] = useState({ name: '', x0: CENTER + 24, z0: CENTER + 24, x1: CENTER + 33, z1: CENTER + 33, bonus_xp_per_block: 2 });
  const [area, setArea] = useState({ x0: 0, z0: 0, x1: 0, z1: 0 });
  const [msg, setMsg] = useState('');
  const patch = async (v: any) => { await api.patch(`/api/teacher/classes/${cls.id}`, v); setMsg('World settings saved. Students are notified.'); onChanged(); };
  return (
    <div className="stack">
      <h1>World</h1>
      {msg && <div className="success" role="status">{msg}</div>}
      <div className="card">
        <h3>Building permissions</h3>
        <div role="radiogroup" aria-label="Building permissions">
          {BUILD_MODES.map((m) => <label key={m} className="row" style={{ padding: '4px 0' }}><input type="radio" name="bm" checked={cls.build_mode === m} onChange={() => patch({ build_mode: m })} /> <b>{BUILD_MODE_LABEL[m]}</b></label>)}
        </div>
        <p className="muted">Personal plots ring the village (8×8 blocks each). Village buildings are always protected. Students can never remove what a classmate built, except inside class project zones.</p>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="row"><input type="checkbox" checked={cls.harvest_enabled} onChange={(e) => patch({ harvest_enabled: e.target.checked })} /> Students can gather basic blocks from the land (dirt, sand, stone, wood)</label>
          <label className="row">Daily gathering limit <input type="number" min={0} className="input" style={{ width: 90 }} defaultValue={cls.harvest_daily_cap} onBlur={(e) => patch({ harvest_daily_cap: Number(e.target.value) })} aria-label="Daily gathering limit" /></label>
          <label className="row"><input type="checkbox" checked={cls.unlock_all_regions} onChange={(e) => patch({ unlock_all_regions: e.target.checked })} /> Unlock every region for everyone</label>
          <label className="row"><input type="checkbox" checked={cls.adaptive_enabled} onChange={(e) => patch({ adaptive_enabled: e.target.checked })} /> Recommend practice topics to students who are struggling</label>
        </div>
        <h3 style={{ marginTop: 14 }}>Regions</h3>
        <ul>{Object.values(REGIONS).map((r) => <li key={r.key}><b>{r.name}</b>: opens at level {r.minLevel}. {r.description}</li>)}</ul>
      </div>
      <div className="card">
        <h3>Class project zones</h3>
        <p className="muted">In “Personal area + class project zones” mode, everyone can build together inside these rectangles. Bonus XP is given for every block placed there. The world is 256×256; the village center is at ({CENTER}, {CENTER}).</p>
        <table className="table"><tbody>{(zones ?? []).map((zn) => <tr key={zn.id}><td><b>{zn.name}</b></td><td>({zn.x0}, {zn.z0}) to ({zn.x1}, {zn.z1})</td><td>+{zn.bonus_xp_per_block} XP per block</td><td><button className="btn small danger" onClick={async () => { await api.del(`/api/teacher/classes/${cls.id}/zones/${zn.id}`); reloadZones(); }}>Delete</button></td></tr>)}</tbody></table>
        <form className="row" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); await api.post(`/api/teacher/classes/${cls.id}/zones`, z); setZ({ ...z, name: '' }); reloadZones(); }}>
          <input className="input" style={{ width: 200 }} placeholder="Build the Future City" aria-label="Zone name" value={z.name} onChange={(e) => setZ({ ...z, name: e.target.value })} />
          {(['x0', 'z0', 'x1', 'z1'] as const).map((k) => <input key={k} type="number" className="input" style={{ width: 80 }} aria-label={k} title={k} value={z[k]} onChange={(e) => setZ({ ...z, [k]: Number(e.target.value) })} />)}
          <label className="row" style={{ gap: 4 }}>XP/block <input type="number" min={0} className="input" style={{ width: 70 }} value={z.bonus_xp_per_block} onChange={(e) => setZ({ ...z, bonus_xp_per_block: Number(e.target.value) })} /></label>
          <button className="btn" disabled={!z.name}>Add zone</button>
        </form>
      </div>
      <div className="card">
        <h3>Buildings</h3>
        <table className="table"><thead><tr><th>Builder</th><th>Blocks</th><th>Location</th><th></th></tr></thead>
          <tbody>{(buildings ?? []).map((b, i) => <tr key={i}><td>{b.ownerName}</td><td className="num">{b.blocks}</td><td>({b.x}, {b.y}, {b.z})</td>
            <td><button className="btn small danger" onClick={async () => { if (confirm(`Remove everything ${b.ownerName} has built?`)) { await api.post(`/api/teacher/students/${b.owner}/remove-builds`); reloadB(); } }}>Remove this student's builds</button></td></tr>)}</tbody></table>
        {buildings?.length === 0 && <p className="muted">No buildings yet.</p>}
      </div>
      <div className="card">
        <h3>Reset an area</h3>
        <p className="muted">Puts the land back to how it was generated inside a rectangle, removing everything built or dug there. Student plots are listed below for reference.</p>
        <div className="row">
          {(['x0', 'z0', 'x1', 'z1'] as const).map((k) => <label key={k} className="row" style={{ gap: 4 }}>{k}<input type="number" className="input" style={{ width: 80 }} value={area[k]} onChange={(e) => setArea({ ...area, [k]: Number(e.target.value) })} /></label>)}
          <button className="btn danger" onClick={async () => { if (confirm('Reset this area? Everything built there will be removed.')) { const r = await api.post(`/api/teacher/classes/${cls.id}/reset-area`, area); setMsg(`Reset done: ${r.removed} blocks restored.`); reloadB(); } }}>Reset area</button>
        </div>
        <details style={{ marginTop: 8 }}><summary>Student plot locations</summary><ul>{(students ?? []).map((s) => { const p = plotBounds(s.plot_index); return <li key={s.id}>{s.display_name}: ({p.x0}, {p.z0}) to ({p.x1}, {p.z1}) <button className="btn small secondary" onClick={() => setArea({ x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 })}>Use</button></li>; })}</ul></details>
      </div>
    </div>
  );
}

/* ---------------- Analytics ---------------- */
export function AnalyticsPage({ cls }: { cls: Cls }) {
  const [d] = useLoad<any>(() => api.get(`/api/teacher/classes/${cls.id}/analytics`), [cls.id]);
  if (!d) return <p>Loading…</p>;
  const maxDaily = Math.max(1, ...d.daily.map((x: any) => x.attempts));
  return (
    <div className="stack">
      <h1>Analytics</h1>
      <div className="card">
        <h3>Accuracy by topic</h3>
        <p className="muted">Lowest first. Topics under 60% are marked so you can assign more practice there.</p>
        {d.topics.length === 0 && <p className="muted">No answers yet.</p>}
        {d.topics.map((t: any) => (
          <div key={t.subject + t.topic} className="skill-row" style={{ gridTemplateColumns: '220px 1fr 220px' }}>
            <span><b>{t.topic}</b> <span className="muted">({t.subject})</span></span>
            <div className="bar"><span style={{ width: `${t.accuracy}%`, background: t.accuracy < 60 ? 'var(--bad)' : undefined }} /></div>
            <span className="num">{t.accuracy}% · {t.attempts} answers · {t.students} students{t.accuracy < 60 ? ' · needs practice' : ''}</span>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Accuracy by difficulty</h3>
          <table className="table"><thead><tr><th>Difficulty</th><th>Answers</th><th>Accuracy</th></tr></thead>
            <tbody>{d.byDifficulty.map((r: any) => <tr key={r.difficulty}><td>{r.difficulty} · {difficultyDef(r.difficulty).name}</td><td className="num">{r.attempts}</td><td className="num">{r.accuracy}%</td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h3>Students who need help</h3>
          {d.struggling.length === 0 ? <p className="muted">Nobody is below 60% on a topic (with 3+ answers).</p> :
            <table className="table"><thead><tr><th>Student</th><th>Topic</th><th>Accuracy</th></tr></thead>
              <tbody>{d.struggling.map((r: any, i: number) => <tr key={i}><td>{r.display_name}</td><td>{r.topic} <span className="muted">({r.subject})</span></td><td className="num">{r.accuracy}% of {r.attempts}</td></tr>)}</tbody></table>}
        </div>
      </div>
      <div className="card">
        <h3>Questions answered, last 30 days</h3>
        {d.daily.length === 0 ? <p className="muted">No activity yet.</p> : (
          <div role="img" aria-label="Answers per day" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
            {d.daily.map((x: any) => (
              <div key={x.day} title={`${x.day}: ${x.attempts} answers, ${x.correct} correct`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${((x.attempts - x.correct) / maxDaily) * 100}%`, background: '#e0a352' }} />
                <div style={{ height: `${(x.correct / maxDaily) * 100}%`, background: 'var(--brand)' }} />
                <div style={{ fontSize: '0.65rem', textAlign: 'center' }}>{x.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 6 }}>Blue = correct, orange = incorrect (hover a bar for numbers).</p>
      </div>
    </div>
  );
}
