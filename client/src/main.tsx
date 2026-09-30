import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, Me, navigate } from './api';
import { Landing } from './ui/Landing';
import { GamePage } from './game/GamePage';
import { TeacherApp } from './teacher/TeacherApp';
import { AdminPage } from './teacher/AdminPage';
import { applyPrefs } from './ui/prefs';
import { currentPath, setAddress } from './nav';

function App() {
  const [path, setPath] = useState(currentPath());
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    applyPrefs();
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    api.get<{ user: Me | null }>('/api/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null));
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop); };
  }, []);

  if (me === undefined) return <div className="loading-screen"><h2>Character Quest</h2><p>Loading…</p></div>;

  const home = (u: Me) => (u.role === 'student' ? '/play' : u.role === 'admin' ? '/admin' : '/teacher');
  const onLogin = (u: Me) => { setMe(u); navigate(home(u)); };
  const onLogout = async () => { await api.post('/api/auth/logout'); setMe(null); navigate('/'); };

  if (!me) {
    if (path !== '/') setAddress('/', true);
    return <Landing onLogin={onLogin} />;
  }
  if (path.startsWith('/play')) return <GamePage me={me} onLogout={onLogout} />;
  if (path.startsWith('/teacher') && me.role !== 'student') return <TeacherApp me={me} onLogout={onLogout} />;
  if (path.startsWith('/admin') && me.role === 'admin') return <AdminPage me={me} onLogout={onLogout} />;
  // Anything else: go to this user's home.
  setTimeout(() => navigate(home(me)), 0);
  return null;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
