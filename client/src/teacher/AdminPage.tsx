import { useRef, useState } from 'react';
import { api, Me, navigate, download } from '../api';
import { useLoad } from './TeacherApp';

export function AdminPage({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [ov] = useLoad<any>(() => api.get('/api/admin/overview'), []);
  const [teachers, reload] = useLoad<any[]>(() => api.get('/api/admin/teachers'), []);
  const [logs] = useLoad<any[]>(() => api.get('/api/admin/activity'), []);
  const [f, setF] = useState({ username: '', password: '', displayName: '', school: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>, text: string) => { try { await fn(); setMsg({ ok: true, text }); reload(); return true; } catch (e: any) { setMsg({ ok: false, text: e.message }); return false; } };

  return (
    <div className="dash">
      <nav className="dash-nav" aria-label="Admin">
        <div className="brand">Character Quest</div>
        <button aria-current="page">Administration</button>
        <button onClick={() => navigate('/teacher')}>Teacher dashboard</button>
        <div style={{ marginTop: 'auto' }}><button onClick={onLogout}>Log out ({me.displayName})</button></div>
      </nav>
      <main className="dash-main stack">
        <h1>Administration</h1>
        {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
        {ov && <div className="grid4">{Object.entries(ov).map(([k, v]) => <div key={k} className="stat"><div className="v">{String(v)}</div><div className="l">{k.replace(/_/g, ' ')}</div></div>)}</div>}
        <div className="grid2">
          <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/api/admin/teachers', f), `Teacher ${f.username} created.`).then((ok) => { if (ok) setF({ username: '', password: '', displayName: '', school: '' }); }); }}>
            <h3>Create a teacher account</h3>
            <div className="field"><label htmlFor="tn">Name</label><input id="tn" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
            <div className="field"><label htmlFor="tu">Username</label><input id="tu" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
            <div className="field"><label htmlFor="tp">Password (8+ characters)</label><input id="tp" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <div className="field"><label htmlFor="ts">School</label><input id="ts" className="input" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} /></div>
            <button className="btn">Create teacher</button>
          </form>
          <div className="card">
            <h3>Backups</h3>
            <p>Download everything (accounts, progress, questions and every world) as one file. Keep regular database backups too (see the README).</p>
            <button className="btn" onClick={async () => download(`character-quest-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await api.get('/api/admin/backup')))}>Download full backup</button>
            <h3 style={{ marginTop: '1.25rem' }}>Restore</h3>
            <p className="muted">Replaces ALL current data with a backup file and logs everyone out.</p>
            <button className="btn danger" onClick={() => file.current?.click()}>Restore from backup…</button>
            <input ref={file} type="file" accept=".json" hidden onChange={async (e) => {
              const fl = e.target.files?.[0]; e.target.value = '';
              if (!fl) return;
              if (prompt('This replaces all data. Type RESTORE to continue.') !== 'RESTORE') return;
              run(async () => api.post('/api/admin/restore', { confirm: 'RESTORE', backup: JSON.parse(await fl.text()) }), 'Backup restored.');
            }} />
          </div>
        </div>
        <div className="card">
          <h3>Teachers</h3>
          <table className="table"><thead><tr><th>Name</th><th>Username</th><th>School</th><th>Classes</th><th>Last login</th><th></th></tr></thead>
            <tbody>{(teachers ?? []).map((t) => (
              <tr key={t.id}><td>{t.display_name}</td><td>{t.username}</td><td>{t.school}</td><td className="num">{t.classes}</td><td>{t.last_login_at ? new Date(t.last_login_at).toLocaleString() : 'Never'}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small secondary" onClick={() => { const pw = prompt('New password (8+ characters):'); if (pw) run(() => api.patch(`/api/admin/users/${t.id}`, { password: pw }), 'Password reset.'); }}>Reset password</button>
                  <button className="btn small secondary" onClick={() => run(() => api.patch(`/api/admin/users/${t.id}`, { disabled: !t.disabled }), t.disabled ? 'Enabled.' : 'Disabled.')}>{t.disabled ? 'Enable' : 'Disable'}</button>
                </td></tr>
            ))}</tbody></table>
        </div>
        <div className="card">
          <h3>System activity</h3>
          <table className="table"><tbody>{(logs ?? []).slice(0, 60).map((l) => <tr key={l.id}><td>{new Date(l.created_at).toLocaleString()}</td><td>{l.actor ?? 'System'}</td><td>{l.action.replace(/_/g, ' ')}</td></tr>)}</tbody></table>
        </div>
      </main>
    </div>
  );
}
