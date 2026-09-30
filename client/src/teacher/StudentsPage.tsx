import { useState } from 'react';
import { api } from '../api';
import { useLoad, Cls } from './TeacherApp';
import { BLOCK_BY_ID } from '@cq/shared';

export function StudentsPage({ cls }: { cls: Cls }) {
  const [rows, reload, err] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/students`), [cls.id]);
  const [open, setOpen] = useState<number | null>(null);
  const [f, setF] = useState({ username: '', password: '', displayName: '' });
  const [bulk, setBulk] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (open) return <StudentDetail id={open} cls={cls} onBack={() => { setOpen(null); reload(); }} />;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post(`/api/teacher/classes/${cls.id}/students`, f); setMsg({ ok: true, text: `Added ${f.displayName || f.username}.` }); setF({ username: '', password: '', displayName: '' }); reload(); }
    catch (x: any) { setMsg({ ok: false, text: x.message }); }
  }
  async function addBulk() {
    const r = await api.post(`/api/teacher/classes/${cls.id}/students/bulk`, { text: bulk });
    const bad = r.results.filter((x: any) => !x.ok);
    setMsg({ ok: bad.length === 0, text: `Added ${r.results.length - bad.length} students.${bad.length ? ' Problems: ' + bad.map((b: any) => `line ${b.line} (${b.username || 'blank'}): ${b.error}`).join('; ') : ''}` });
    if (!bad.length) setBulk('');
    reload();
  }

  return (
    <div className="stack">
      <h1>Students</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <div className="card">
        <table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Level</th><th>XP</th><th>Answered</th><th>Accuracy</th><th>Blocks placed</th><th>Achievements</th><th>Status</th></tr></thead>
          <tbody>
            {(rows ?? []).map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(s.id); }}>
                <td><b>{s.display_name}</b></td><td>{s.username}</td><td className="num">{s.level}</td><td className="num">{s.xp}</td>
                <td className="num">{s.attempts}</td><td className="num">{s.accuracy === null ? '–' : `${s.accuracy}%`}</td><td className="num">{s.blocks_placed}</td><td className="num">{s.achievements}</td>
                <td>{s.disabled ? <span className="tag">Disabled</span> : s.frozen ? <span className="tag">Paused</span> : !s.can_build ? <span className="tag">No building</span> : <span className="muted">OK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <p className="muted">No students yet. Add them below, or share the class code <b>{cls.join_code}</b>.</p>}
      </div>
      <div className="grid2">
        <form className="card" onSubmit={add}>
          <h3>Add a student</h3>
          <div className="field"><label htmlFor="dn">Name students see</label><input id="dn" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
          <div className="field"><label htmlFor="un">Username</label><input id="un" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /><span className="hint">3-32 letters or numbers, no spaces.</span></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="hint">At least 4 characters. Write it down for the student.</span></div>
          <button className="btn">Add student</button>
        </form>
        <div className="card">
          <h3>Add many students</h3>
          <p className="muted">One student per line: <code>username, password, name</code></p>
          <textarea className="input" rows={7} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'mia, sun42, Mia\nleo, rocket7, Leo'} aria-label="Student list" />
          <button className="btn" style={{ marginTop: 8 }} onClick={addBulk} disabled={!bulk.trim()}>Add all</button>
        </div>
      </div>
    </div>
  );
}

function StudentDetail({ id, cls, onBack }: { id: number; cls: Cls; onBack: () => void }) {
  const [d, reload, err] = useLoad<any>(() => api.get(`/api/teacher/students/${id}`), [id]);
  const [ach] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/achievements`), [cls.id]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (fn: () => Promise<unknown>, text: string) => { try { await fn(); setMsg({ ok: true, text }); reload(); } catch (e: any) { setMsg({ ok: false, text: e.message }); } };
  if (err) return <div className="error">{err}</div>;
  if (!d) return <p>Loading…</p>;
  const p = d.profile;
  const incorrect = p.stats.attempts - p.stats.correct;
  return (
    <div className="stack">
      <button className="btn small secondary" onClick={onBack}>← All students</button>
      <h1>{p.displayName} <span className="muted" style={{ fontSize: '1rem' }}>@{p.username}</span></h1>
      {msg && <div className={msg.ok ? 'success' : 'error'} role="status">{msg.text}</div>}
      <div className="grid4">
        <div className="stat"><div className="v">{p.level}</div><div className="l">Level · {p.title}</div></div>
        <div className="stat"><div className="v">{p.xp.toLocaleString()}</div><div className="l">XP</div></div>
        <div className="stat"><div className="v">{p.stats.attempts ? Math.round((p.stats.correct / p.stats.attempts) * 100) + '%' : '–'}</div><div className="l">Accuracy ({p.stats.correct} correct, {incorrect} incorrect)</div></div>
        <div className="stat"><div className="v">{p.stats.solved}</div><div className="l">Questions solved</div></div>
        <div className="stat"><div className="v">{d.assignments.length}</div><div className="l">Assignments completed</div></div>
        <div className="stat"><div className="v">{p.achievements.filter((a: any) => a.earned).length}</div><div className="l">Achievements</div></div>
        <div className="stat"><div className="v">{p.blocksPlaced}</div><div className="l">Blocks placed</div></div>
        <div className="stat"><div className="v">{p.buildings.length}</div><div className="l">Buildings</div></div>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>By topic</h3>
          {d.topics.length === 0 && <p className="muted">No answers yet.</p>}
          {d.topics.map((t: any) => (
            <div key={t.subject + t.topic} className="skill-row" style={{ gridTemplateColumns: '170px 1fr 120px' }}>
              <span><b>{t.topic}</b> <span className="muted">({t.subject})</span></span>
              <div className="bar"><span style={{ width: `${t.accuracy}%`, background: t.accuracy < 60 ? 'var(--bad)' : undefined }} /></div>
              <span className="num">{t.accuracy}% of {t.attempts}{t.accuracy < 60 && t.attempts >= 3 ? ' · needs practice' : ''}</span>
            </div>
          ))}
          {d.weakTopics.length > 0 && <p style={{ marginTop: 8 }}><b>Suggestion:</b> assign more {d.weakTopics.map((w: any) => w.topic).join(', ')} practice.</p>}
        </div>
        <div className="card">
          <h3>Skills</h3>
          {p.skills.map((s: any) => <div key={s.id} className="skill-row"><b>{s.name}</b><div className="bar"><span style={{ width: `${Math.min(100, s.points)}%` }} /></div><span className="num">{s.points}</span></div>)}
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Inventory</h3>
          {Object.keys(p.inventory).length === 0 ? <p className="muted">Empty.</p> : <ul>{Object.entries(p.inventory).map(([b, n]) => <li key={b}>{BLOCK_BY_ID[Number(b)]?.name}: {String(n)}</li>)}</ul>}
          <h3>Buildings</h3>
          {p.buildings.length === 0 ? <p className="muted">None yet.</p> : <ul>{p.buildings.map((b: any) => <li key={b.name}>{b.name}: {b.blocks} blocks at ({b.x}, {b.z})</li>)}</ul>}
        </div>
        <div className="card">
          <h3>Recent answers</h3>
          <table className="table"><tbody>
            {d.recent.map((r: any, i: number) => <tr key={i}><td>{r.correct ? '✓' : '✗'} <span className="sr-only">{r.correct ? 'correct' : 'incorrect'}</span></td><td>{r.prompt}<div className="muted" style={{ fontSize: '0.8rem' }}>Answered “{r.answer_text}” · try {r.attempt_no} · {new Date(r.created_at).toLocaleString()}</div></td></tr>)}
          </tbody></table>
          {d.recent.length === 0 && <p className="muted">No answers yet.</p>}
        </div>
      </div>
      <div className="card">
        <h3>Manage</h3>
        <div className="row">
          <button className="btn secondary" onClick={() => { const pw = prompt('New password for ' + p.displayName + ' (at least 4 characters):'); if (pw) act(() => api.patch(`/api/teacher/students/${id}`, { password: pw }), 'Password changed.'); }}>Reset password</button>
          <button className="btn secondary" onClick={() => act(() => api.patch(`/api/teacher/students/${id}`, { frozen: !p.frozen }), p.frozen ? 'Unpaused.' : 'Paused. The character cannot move or build.')}>{p.frozen ? 'Unpause character' : 'Pause (freeze) character'}</button>
          <button className="btn secondary" onClick={() => act(() => api.patch(`/api/teacher/students/${id}`, { can_build: !p.canBuild }), 'Building permission updated.')}>{p.canBuild ? 'Turn off building' : 'Allow building'}</button>
          <button className="btn secondary" onClick={() => act(() => api.post(`/api/teacher/students/${id}/teleport-home`), 'Sent to their plot.')}>Send to their plot</button>
          <button className="btn secondary" onClick={() => act(() => api.patch(`/api/teacher/students/${id}`, { muted: !p.muted }), p.muted ? 'Chat turned back on for this student.' : 'Chat paused for this student.')}>{p.muted ? 'Unmute chat' : 'Mute chat'}</button>
          <button className="btn danger" onClick={() => { if (confirm(`Remove every block ${p.displayName} has placed?`)) act(() => api.post(`/api/teacher/students/${id}/remove-builds`), 'Buildings removed.'); }}>Remove their buildings</button>
          <button className="btn danger" onClick={async () => { if (confirm(`Delete ${p.displayName}'s account and all progress? This cannot be undone.`)) { await api.del(`/api/teacher/students/${id}`); onBack(); } }}>Delete student</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="aw">Award achievement</label>
          <select id="aw" className="input" style={{ width: 260 }} defaultValue="" onChange={(e) => { const v = Number(e.target.value); if (v) act(() => api.post(`/api/teacher/students/${id}/achievements/${v}`), 'Achievement awarded.'); e.target.value = ''; }}>
            <option value="">Choose…</option>
            {(ach ?? []).filter((a) => !p.achievements.find((x: any) => x.id === a.id && x.earned)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
