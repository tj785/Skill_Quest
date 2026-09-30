/** Teacher pages for quests & daily challenges, special events, build approvals and chat moderation. */
import { useState } from 'react';
import { api, navigate } from '../api';
import { useLoad, Cls } from './TeacherApp';
import { BlockSelect } from './OtherPages';
import {
  BLOCK_BY_ID, COSMETICS, COSMETIC_BY_KEY, QUEST_STEP_KINDS, QUEST_STEP_LABEL, QuestStepKind, REGIONS, EVENT_GOALS, EVENT_GOAL_LABEL, STRUCTURES, STRUCTURE_BY_KEY,
  CHAT_MODES, CHAT_MODE_LABEL, CENTER, describeStep
} from '@cq/shared';

const SUBJECTS = ['Math', 'Reading', 'Science', 'Writing', 'Programming', 'Social Studies', 'Bible', 'Vocabulary'];
const REPEAT_LABEL: Record<string, string> = { none: 'One-time quest', daily: 'Daily challenge (resets every day)', weekly: 'Weekly challenge (resets every Monday)' };

function ItemSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {COSMETICS.map((c) => <option key={c.key} value={c.key}>{c.name}{c.price === null ? ' (reward only)' : ''}</option>)}
    </select>
  );
}

/* ---------------- Quests & daily challenges ---------------- */
interface StepForm { kind: QuestStepKind; amount: number; subject: string; topic: string; region: string; description: string; }
const blankStep = (): StepForm => ({ kind: 'correct_answers', amount: 3, subject: 'Math', topic: '', region: 'forest', description: '' });

export function QuestsPage({ cls }: { cls: Cls }) {
  const [rows, reload, err] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/quests`), [cls.id]);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  if (editing) return <QuestEditor cls={cls} quest={editing === 'new' ? null : editing} onDone={(saved) => { setEditing(null); if (saved) { setMsg('Quest saved. Students see it right away.'); reload(); } }} />;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Quests & daily challenges</h1>
        <button className="btn" onClick={() => setEditing('new')}>+ Create quest</button>
      </div>
      <p className="muted">A quest is a list of steps done in order (answer 3 fraction questions → visit the forest → build 10 blocks). Make it a <b>daily</b> or <b>weekly challenge</b> and it resets for everyone at midnight ({cls.timezone}). Progress is counted by the server from real actions.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Quest</th><th>Type</th><th>Steps</th><th>Reward</th><th>Completed</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((q) => (
              <tr key={q.id}>
                <td><b>{q.title}</b>{q.description && <div className="muted" style={{ fontSize: '0.85rem' }}>{q.description}</div>}</td>
                <td>{q.repeat === 'none' ? 'Quest' : q.repeat === 'daily' ? 'Daily' : 'Weekly'}</td>
                <td style={{ fontSize: '0.85rem' }}><ol style={{ margin: 0, paddingLeft: 18 }}>{q.steps.map((s: any) => <li key={s.id}>{s.description}</li>)}</ol></td>
                <td style={{ fontSize: '0.85rem' }}>{q.xp_reward} XP{q.coin_reward ? `, ${q.coin_reward} coins` : ''}{q.block_id && q.block_qty ? `, ${q.block_qty} ${BLOCK_BY_ID[q.block_id]?.name}` : ''}{q.item_key ? `, ${COSMETIC_BY_KEY[q.item_key]?.name}` : ''}</td>
                <td className="num">{q.completions}</td>
                <td><input type="checkbox" aria-label="Active" checked={q.active} onChange={async (e) => { await api.patch(`/api/teacher/classes/${cls.id}/quests/${q.id}`, { active: e.target.checked }); reload(); }} /></td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small secondary" onClick={() => setEditing(q)}>Edit</button>
                  <button className="btn small danger" onClick={async () => { if (confirm(`Delete “${q.title}” and everyone's progress on it?`)) { await api.del(`/api/teacher/classes/${cls.id}/quests/${q.id}`); reload(); } }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No quests yet. Create one to give students a goal beyond single questions.</p>}
      </div>
    </div>
  );
}

function QuestEditor({ cls, quest, onDone }: { cls: Cls; quest: any | null; onDone: (saved: boolean) => void }) {
  const [f, setF] = useState({
    title: quest?.title ?? '', description: quest?.description ?? '', repeat: quest?.repeat ?? 'none', active: quest?.active ?? true,
    xp_reward: quest?.xp_reward ?? 100, coin_reward: quest?.coin_reward ?? 10, block_id: (quest?.block_id ?? '') as string | number, block_qty: quest?.block_qty ?? 0, item_key: quest?.item_key ?? ''
  });
  // Descriptions the server filled in automatically are shown as blank, so changing the step also changes its text.
  const autoText = (s: any) => describeStep({ ...s, region: REGIONS[s.region as keyof typeof REGIONS]?.name ?? s.region });
  const [steps, setSteps] = useState<StepForm[]>(quest ? quest.steps.map((s: any) => ({ kind: s.kind, amount: s.amount, subject: s.subject ?? 'Math', topic: s.topic ?? '', region: s.region ?? 'forest', description: s.description && s.description !== autoText(s) ? s.description : '' })) : [blankStep()]);
  const [err, setErr] = useState('');
  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSteps(n); };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const body = {
      ...f, xp_reward: Number(f.xp_reward), coin_reward: Number(f.coin_reward), block_id: f.block_id === '' ? null : Number(f.block_id), block_qty: Number(f.block_qty), item_key: f.item_key || null,
      description: f.description || null,
      steps: steps.map((s) => ({ kind: s.kind, amount: Number(s.amount) || 1, subject: s.kind === 'subject_correct' ? s.subject : null, topic: s.kind === 'topic_correct' ? s.topic : null, region: s.kind === 'visit_region' ? s.region : null, description: s.description || null }))
    };
    try {
      if (quest) { if (!confirm('Saving changes restarts the quest for students who are part-way through it. Continue?')) return; await api.put(`/api/teacher/classes/${cls.id}/quests/${quest.id}`, body); }
      else await api.post(`/api/teacher/classes/${cls.id}/quests`, body);
      onDone(true);
    } catch (x: any) { setErr(x.message); }
  }
  return (
    <form className="stack" style={{ maxWidth: 900 }} onSubmit={save}>
      <button type="button" className="btn small secondary" onClick={() => onDone(false)}>← Quests</button>
      <h1>{quest ? 'Edit quest' : 'Create quest'}</h1>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card">
        <div className="grid2">
          <div className="field"><label htmlFor="qt">Title</label><input id="qt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="The Explorer's Journey" /></div>
          <div className="field"><label htmlFor="qr">Type</label>
            <select id="qr" className="input" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}>
              {Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        <div className="field"><label htmlFor="qd">Description (optional)</label><input id="qd" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <div className="card">
        <h3>Steps (done in order)</h3>
        {steps.map((s, i) => (
          <div key={i} className="card" style={{ background: '#fbf7ef', marginBottom: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>Step {i + 1}</b>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn small secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" className="btn small secondary" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                {steps.length > 1 && <button type="button" className="btn small danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            </div>
            <div className="grid4">
              <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor={`sk${i}`}>What to do</label>
                <select id={`sk${i}`} className="input" value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as QuestStepKind })}>
                  {QUEST_STEP_KINDS.map((k) => <option key={k} value={k}>{QUEST_STEP_LABEL[k]}</option>)}
                </select></div>
              {s.kind !== 'visit_region' && <div className="field"><label htmlFor={`sa${i}`}>How many</label><input id={`sa${i}`} type="number" min={1} className="input" value={s.amount} onChange={(e) => setStep(i, { amount: Number(e.target.value) })} /></div>}
              {s.kind === 'subject_correct' && <div className="field"><label htmlFor={`ss${i}`}>Subject</label><input id={`ss${i}`} list="qsubjects" className="input" value={s.subject} onChange={(e) => setStep(i, { subject: e.target.value })} /></div>}
              {s.kind === 'topic_correct' && <div className="field"><label htmlFor={`st${i}`}>Topic</label><input id={`st${i}`} className="input" placeholder="Fractions" value={s.topic} onChange={(e) => setStep(i, { topic: e.target.value })} /></div>}
              {s.kind === 'visit_region' && <div className="field"><label htmlFor={`sr${i}`}>Region</label>
                <select id={`sr${i}`} className="input" value={s.region} onChange={(e) => setStep(i, { region: e.target.value })}>
                  {Object.values(REGIONS).map((r) => <option key={r.key} value={r.key}>{r.name} (level {r.minLevel}+)</option>)}
                </select></div>}
            </div>
            <div className="field"><label htmlFor={`sd${i}`}>Text students see (optional)</label>
              <input id={`sd${i}`} className="input" value={s.description} placeholder={describeStep({ ...s, region: REGIONS[s.region as keyof typeof REGIONS]?.name })} onChange={(e) => setStep(i, { description: e.target.value })} /></div>
          </div>
        ))}
        <datalist id="qsubjects">{SUBJECTS.map((x) => <option key={x} value={x} />)}</datalist>
        {steps.length < 10 && <button type="button" className="btn small secondary" onClick={() => setSteps([...steps, blankStep()])}>+ Add step</button>}
      </div>
      <div className="card">
        <h3>Reward when every step is done</h3>
        <div className="grid4">
          <div className="field"><label htmlFor="qx">XP</label><input id="qx" type="number" min={0} className="input" value={f.xp_reward} onChange={(e) => setF({ ...f, xp_reward: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="qc">Coins</label><input id="qc" type="number" min={0} className="input" value={f.coin_reward} onChange={(e) => setF({ ...f, coin_reward: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="qb">Block</label><BlockSelect id="qb" value={f.block_id} onChange={(v) => setF({ ...f, block_id: v })} /></div>
          <div className="field"><label htmlFor="qq">Block quantity</label><input id="qq" type="number" min={0} className="input" value={f.block_qty} onChange={(e) => setF({ ...f, block_qty: Number(e.target.value) })} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="qi">Cosmetic item</label><ItemSelect id="qi" value={f.item_key} onChange={(v) => setF({ ...f, item_key: v })} /></div>
        </div>
        <label className="row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (students can see and work on it)</label>
      </div>
      <div className="row"><button className="btn gold">Save quest</button><button type="button" className="btn secondary" onClick={() => onDone(false)}>Cancel</button></div>
    </form>
  );
}

/* ---------------- Special events ---------------- */
export function EventsPage({ cls }: { cls: Cls }) {
  const [rows, reload, err] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/events`), [cls.id]);
  const [students] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const blank = { title: '', description: '', goal_kind: 'correct_answers', subject: 'Math', goal_amount: 25, ends_at: '', reward_xp: 50, reward_coins: 10, reward_item: '', unlock_structure: 'fountain', structure_x: CENTER - 12, structure_z: CENTER + 10 };
  const [f, setF] = useState<any>(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pts, setPts] = useState<Record<number, { points: number; student: string }>>({});
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); setMsg({ ok: true, text: ok }); reload(); } catch (x: any) { setMsg({ ok: false, text: x.message }); } };
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/teacher/classes/${cls.id}/events`, {
        ...f, subject: f.goal_kind === 'subject_correct' ? f.subject : null, goal_amount: Number(f.goal_amount), reward_xp: Number(f.reward_xp), reward_coins: Number(f.reward_coins),
        reward_item: f.reward_item || null, unlock_structure: f.unlock_structure || null, structure_x: Number(f.structure_x), structure_z: Number(f.structure_z),
        ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null, description: f.description || null
      });
      setMsg({ ok: true, text: 'Event started. Students see it in their quest list.' });
      setF(blank); reload();
    } catch (x: any) { setMsg({ ok: false, text: x.message }); } // keep what the teacher typed
  }
  return (
    <div className="stack">
      <h1>Special events</h1>
      <p className="muted">A class-wide goal everyone works on together, like “answer 100 questions as a class this week”. When the goal is reached, everyone who helped gets the reward and an optional structure appears in the world. Use <b>points you add</b> for real-world events like a walk-a-thon or reading minutes.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      {(rows ?? []).map((e) => (
        <div key={e.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><b style={{ fontSize: '1.1rem' }}>{e.completed_at ? '✓ ' : ''}{e.title}</b> <span className="tag">{EVENT_GOAL_LABEL[e.goal_kind as keyof typeof EVENT_GOAL_LABEL]}{e.subject ? `: ${e.subject}` : ''}</span></div>
            <div className="row" style={{ gap: 4 }}>
              {!e.completed_at && <button className="btn small secondary" onClick={() => { if (confirm('Finish this event now and give everyone who helped the reward?')) run(() => api.post(`/api/teacher/classes/${cls.id}/events/${e.id}/complete`), 'Event completed.'); }}>Finish now</button>}
              <button className="btn small danger" onClick={() => { if (confirm('Delete this event?')) run(() => api.del(`/api/teacher/classes/${cls.id}/events/${e.id}`), 'Event deleted.'); }}>Delete</button>
            </div>
          </div>
          {e.description && <p style={{ margin: '4px 0' }}>{e.description}</p>}
          <div className="bar" style={{ margin: '6px 0' }}><span style={{ width: `${Math.min(100, (e.progress / e.goal_amount) * 100)}%`, background: '#e8a33b' }} /></div>
          <div className="muted" style={{ fontSize: '0.9rem' }}>
            {Math.min(e.progress, e.goal_amount)} / {e.goal_amount} · {e.helpers} helpers · Reward: {e.reward_xp} XP, {e.reward_coins} coins{e.reward_item ? `, ${COSMETIC_BY_KEY[e.reward_item]?.name}` : ''}
            {e.unlock_structure ? ` · Builds the ${STRUCTURE_BY_KEY[e.unlock_structure]?.name} at (${e.structure_x}, ${e.structure_z})` : ''}
            {e.ends_at ? ` · Ends ${new Date(e.ends_at).toLocaleString()}` : ''}{e.completed_at ? ` · Completed ${new Date(e.completed_at).toLocaleString()}` : ''}
          </div>
          {!e.completed_at && (
            <form className="row" style={{ marginTop: 8 }} onSubmit={(ev) => {
              ev.preventDefault();
              const p = pts[e.id] ?? { points: 1, student: '' };
              run(() => api.post(`/api/teacher/classes/${cls.id}/events/${e.id}/points`, { points: Number(p.points) || 1, student_id: p.student ? Number(p.student) : null }), `Added ${p.points || 1} points.`);
            }}>
              <label className="row" style={{ gap: 4 }}>Add points <input type="number" min={1} className="input" style={{ width: 90 }} value={pts[e.id]?.points ?? 1} onChange={(ev) => setPts({ ...pts, [e.id]: { ...(pts[e.id] ?? { student: '' }), points: Number(ev.target.value) } })} /></label>
              <select className="input" style={{ width: 200 }} aria-label="Credit a student" value={pts[e.id]?.student ?? ''} onChange={(ev) => setPts({ ...pts, [e.id]: { ...(pts[e.id] ?? { points: 1 }), student: ev.target.value } })}>
                <option value="">Whole class (no one credited)</option>{(students ?? []).map((s) => <option key={s.id} value={s.id}>Credit {s.display_name}</option>)}
              </select>
              <button className="btn small">Add</button>
            </form>
          )}
        </div>
      ))}
      <form className="card" onSubmit={create}>
        <h3>Start a new event</h3>
        <div className="grid2">
          <div className="field"><label htmlFor="et">Title</label><input id="et" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Fountain of Knowledge" /></div>
          <div className="field"><label htmlFor="ed">Description</label><input id="ed" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Answer 50 questions as a class to build a fountain!" /></div>
        </div>
        <div className="grid4">
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="eg">Goal</label>
            <select id="eg" className="input" value={f.goal_kind} onChange={(e) => setF({ ...f, goal_kind: e.target.value })}>{EVENT_GOALS.map((g) => <option key={g} value={g}>{EVENT_GOAL_LABEL[g]}</option>)}</select></div>
          {f.goal_kind === 'subject_correct' && <div className="field"><label htmlFor="es">Subject</label><input id="es" className="input" list="esubjects" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /><datalist id="esubjects">{SUBJECTS.map((x) => <option key={x} value={x} />)}</datalist></div>}
          <div className="field"><label htmlFor="ea">Target</label><input id="ea" type="number" min={1} className="input" value={f.goal_amount} onChange={(e) => setF({ ...f, goal_amount: e.target.value })} /></div>
          <div className="field"><label htmlFor="ee">Ends (optional)</label><input id="ee" type="datetime-local" className="input" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></div>
          <div className="field"><label htmlFor="ex">XP for each helper</label><input id="ex" type="number" min={0} className="input" value={f.reward_xp} onChange={(e) => setF({ ...f, reward_xp: e.target.value })} /></div>
          <div className="field"><label htmlFor="ec">Coins for each helper</label><input id="ec" type="number" min={0} className="input" value={f.reward_coins} onChange={(e) => setF({ ...f, reward_coins: e.target.value })} /></div>
          <div className="field"><label htmlFor="ei">Cosmetic for each helper</label><ItemSelect id="ei" value={f.reward_item} onChange={(v) => setF({ ...f, reward_item: v })} /></div>
          <div className="field"><label htmlFor="eu">Structure unlocked</label>
            <select id="eu" className="input" value={f.unlock_structure} onChange={(e) => setF({ ...f, unlock_structure: e.target.value })}>
              <option value="">None</option>{STRUCTURES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select></div>
          {f.unlock_structure && <>
            <div className="field"><label htmlFor="esx">Structure x</label><input id="esx" type="number" className="input" value={f.structure_x} onChange={(e) => setF({ ...f, structure_x: e.target.value })} /></div>
            <div className="field"><label htmlFor="esz">Structure z</label><input id="esz" type="number" className="input" value={f.structure_z} onChange={(e) => setF({ ...f, structure_z: e.target.value })} /></div>
          </>}
        </div>
        {f.unlock_structure && <p className="hint">The village center is at ({CENTER}, {CENTER}). The default spot is an open area west of the spawn.</p>}
        <button className="btn gold" disabled={!f.title}>Start event</button>
      </form>
    </div>
  );
}

/* ---------------- Build approvals ---------------- */
export function ApprovalsPage({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [d, reload, err] = useLoad<any>(() => api.get(`/api/teacher/classes/${cls.id}/approvals`), [cls.id]);
  const [fb, setFb] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  const act = async (id: number, what: 'approve' | 'reject', name: string) => {
    if (what === 'reject' && !confirm(`Send ${name}'s new blocks back to their inventory?`)) return;
    try {
      const r = await api.post(`/api/teacher/students/${id}/${what}`, { feedback: fb[id] || null });
      setMsg(what === 'approve' ? `Approved ${r.approved} blocks from ${name}. Everyone can see them now.` : `Returned ${r.removed} blocks to ${name}.`);
    } catch (x: any) { setMsg(x.message); }
    reload();
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h1 style={{ margin: 0 }}>Build approvals</h1><button className="btn secondary" onClick={reload}>Refresh</button></div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="success">{msg}</div>}
      {d && d.buildMode !== 'teacher_approval' && (
        <div className="card">
          <p>Approval mode is <b>off</b>. Turn it on to review builds before classmates can see them. Students build in their own plot; new blocks show with a gold tint to the builder and to you until you approve them.</p>
          <button className="btn" onClick={async () => { await api.patch(`/api/teacher/classes/${cls.id}`, { build_mode: 'teacher_approval' }); onChanged(); reload(); }}>Turn on approval mode</button>
        </div>
      )}
      {d && d.buildMode === 'teacher_approval' && <p className="muted">Pending blocks are visible to you (gold tint) when you enter the world. Visit a plot to look at the build before you decide.</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Student</th><th>New blocks</th><th>Plot</th><th>Note</th><th>Feedback</th><th></th></tr></thead>
          <tbody>
            {(d?.pending ?? []).map((p: any) => {
              const sub = d.submissions.find((s: any) => s.student_id === p.studentId && s.status === 'pending');
              return (
                <tr key={p.studentId}>
                  <td><b>{p.name}</b>{p.submitted && <div><span className="tag">Submitted</span></div>}</td>
                  <td className="num">{p.blocks}</td>
                  <td>{p.plot ? `(${p.plot.x0}, ${p.plot.z0})` : '–'}</td>
                  <td style={{ maxWidth: 240 }}>{sub?.note ?? <span className="muted">–</span>}</td>
                  <td><input className="input" style={{ width: 200 }} placeholder="Optional message" aria-label={`Feedback for ${p.name}`} value={fb[p.studentId] ?? ''} onChange={(e) => setFb({ ...fb, [p.studentId]: e.target.value })} /></td>
                  <td className="row" style={{ gap: 4 }}>
                    <button className="btn small" onClick={() => act(p.studentId, 'approve', p.name)}>Approve</button>
                    <button className="btn small danger" onClick={() => act(p.studentId, 'reject', p.name)}>Send back</button>
                    <button className="btn small secondary" onClick={() => navigate(`/play?class=${cls.id}`)}>View in world</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d && d.pending.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No builds waiting for approval.</p>}
      </div>
      {d && d.submissions.some((s: any) => s.status !== 'pending') && (
        <div className="card">
          <h3>Recent decisions</h3>
          <ul>{d.submissions.filter((s: any) => s.status !== 'pending').slice(0, 20).map((s: any) => <li key={s.id}><b>{s.display_name}</b>: {s.status === 'approved' ? 'approved' : 'sent back'} ({s.blocks} blocks) {s.feedback ? `— “${s.feedback}”` : ''} <span className="muted">{s.reviewed_at ? new Date(s.reviewed_at).toLocaleString() : ''}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ---------------- Chat moderation ---------------- */
export function ChatPage({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [rows, reload] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/chat`), [cls.id]);
  const [students, reloadS] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const [msg, setMsg] = useState('');
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h1 style={{ margin: 0 }}>Chat</h1><button className="btn secondary" onClick={() => { reload(); reloadS(); }}>Refresh</button></div>
      {msg && <div className="success">{msg}</div>}
      <div className="card">
        <h3>Chat setting</h3>
        <div role="radiogroup" aria-label="Chat mode">
          {CHAT_MODES.map((m) => <label key={m} className="row" style={{ padding: '4px 0' }}><input type="radio" name="cm" checked={cls.chat_mode === m} onChange={async () => { await api.patch(`/api/teacher/classes/${cls.id}`, { chat_mode: m }); setMsg('Chat setting saved.'); onChanged(); }} /> <b>{CHAT_MODE_LABEL[m]}</b></label>)}
        </div>
        <p className="muted">Chat is class-only: students never see or message anyone outside the class, and there are no private messages. Typed messages are filtered for unkind words, links and phone numbers. You see every message, including the original text of filtered ones. Students can send one message every 3 seconds.</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Messages</h3>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            {(rows ?? []).length === 0 && <p className="muted">No messages yet.</p>}
            {(rows ?? []).map((m) => (
              <div key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', opacity: m.hidden ? 0.5 : 1 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span><b>{m.name ?? 'Deleted user'}</b>{m.role !== 'student' ? ' (Teacher)' : ''}: {m.text}</span>
                  <button className="btn small secondary" onClick={async () => { await api.patch(`/api/teacher/classes/${cls.id}/chat/${m.id}`, { hidden: !m.hidden }); reload(); }}>{m.hidden ? 'Show' : 'Hide'}</button>
                </div>
                {m.original && <div className="muted" style={{ fontSize: '0.8rem' }}>Original (filtered): “{m.original}”</div>}
                <div className="muted" style={{ fontSize: '0.75rem' }}>{new Date(m.created_at).toLocaleString()}{m.hidden ? ' · hidden from students' : ''}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Mute a student</h3>
          <p className="muted">Muted students can still play; they just cannot send chat messages.</p>
          {(students ?? []).map((s) => <MuteRow key={s.id} s={s} onDone={(t) => { setMsg(t); reloadS(); }} />)}
        </div>
      </div>
    </div>
  );
}
function MuteRow({ s, onDone }: { s: any; onDone: (t: string) => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
      <span>{s.display_name}{s.muted && <span className="tag" style={{ marginLeft: 6 }}>Muted</span>}</span>
      <button className="btn small secondary" onClick={async () => { await api.patch(`/api/teacher/students/${s.id}`, { muted: !s.muted }); onDone(s.muted ? `${s.display_name} can chat again.` : `${s.display_name} is muted.`); }}>{s.muted ? 'Unmute' : 'Mute'}</button>
    </div>
  );
}
