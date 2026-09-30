import { useEffect, useState } from 'react';
import { api, Me } from '../api';

type Mode = 'login' | 'join' | 'teacher';

export function Landing({ onLogin }: { onLogin: (u: Me) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [f, setF] = useState({ username: '', password: '', joinCode: '', displayName: '', signupCode: '', school: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<{ demo: boolean; teacherSignup: boolean }>({ demo: false, teacherSignup: false });
  useEffect(() => { api.get('/api/auth/config').then(setCfg).catch(() => {}); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      let r: { user: Me };
      if (mode === 'login') r = await api.post('/api/auth/login', { username: f.username, password: f.password });
      else if (mode === 'join') r = await api.post('/api/auth/join', { joinCode: f.joinCode, username: f.username, password: f.password, displayName: f.displayName });
      else r = await api.post('/api/auth/teacher-signup', { username: f.username, password: f.password, displayName: f.displayName, school: f.school, signupCode: f.signupCode });
      const me = await api.get<{ user: Me }>('/api/auth/me');
      onLogin(me.user ?? r.user);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="landing">
      <section className="landing-art" aria-label="About Character Quest">
        <h1>Character Quest</h1>
        <p>Answer questions, earn blocks, and build a world together with your class.</p>
        <div className="landing-loop" aria-label="How it works">
          {['Learn', 'Earn', 'Build', 'Achieve', 'Level up'].map((s) => <span key={s}>{s}</span>)}
        </div>
      </section>
      <main className="landing-form">
        <div style={{ maxWidth: 420, width: '100%', margin: '0 auto' }}>
          <div className="tabs" role="tablist" aria-label="Sign in options">
            <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>Log in</button>
            <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>Join a class</button>
            {cfg.teacherSignup && <button role="tab" aria-selected={mode === 'teacher'} onClick={() => setMode('teacher')}>New teacher</button>}
          </div>
          <form onSubmit={submit} noValidate>
            <h2>{mode === 'login' ? 'Welcome back' : mode === 'join' ? 'Join your class' : 'Create a teacher account'}</h2>
            {err && <div className="error" role="alert">{err}</div>}
            {mode === 'join' && (
              <div className="field"><label htmlFor="jc">Class code</label>
                <input id="jc" className="input" value={f.joinCode} onChange={set('joinCode')} autoComplete="off" placeholder="e.g. DEMO5A" required />
                <span className="hint">Your teacher gives you this code.</span></div>
            )}
            {mode !== 'login' && (
              <div className="field"><label htmlFor="dn">{mode === 'join' ? 'Your first name' : 'Your name'}</label>
                <input id="dn" className="input" value={f.displayName} onChange={set('displayName')} required /></div>
            )}
            <div className="field"><label htmlFor="un">Username</label>
              <input id="un" className="input" value={f.username} onChange={set('username')} autoComplete="username" required /></div>
            <div className="field"><label htmlFor="pw">Password</label>
              <input id="pw" type="password" className="input" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></div>
            {mode === 'teacher' && (<>
              <div className="field"><label htmlFor="sc">School (optional)</label><input id="sc" className="input" value={f.school} onChange={set('school')} /></div>
              <div className="field"><label htmlFor="tc">Teacher sign-up code</label>
                <input id="tc" className="input" value={f.signupCode} onChange={set('signupCode')} />
                <span className="hint">From your school's Character Quest administrator.</span></div>
            </>)}
            <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'join' ? 'Join and play' : 'Create account'}</button>
          </form>
          {cfg.demo && <p className="muted" style={{ marginTop: '1.25rem', fontSize: '0.9rem' }}>
            Demo: teacher <b>teacher</b> / <b>teacher123</b> · students <b>alex</b>, <b>jordan</b>, <b>sam</b>, <b>taylor</b> / <b>quest123</b>
          </p>}
        </div>
      </main>
    </div>
  );
}
