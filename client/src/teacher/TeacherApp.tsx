import { useCallback, useEffect, useState } from 'react';
import { api, Me, navigate, download, downloadApi } from '../api';
import { currentPath, setAddress } from '../nav';
import { StudentsPage } from './StudentsPage';
import { QuestionsPage } from './QuestionsPage';
import { AssignmentsPage, RewardsPage, AchievementsPage, WorldPage, AnalyticsPage } from './OtherPages';
import { QuestsPage, EventsPage, ApprovalsPage, ChatPage } from './EngagePages';
import { BUILD_MODE_LABEL } from '@cq/shared';

export interface Cls { id: number; name: string; grade: string | null; join_code: string; build_mode: keyof typeof BUILD_MODE_LABEL; harvest_enabled: boolean; harvest_daily_cap: number; unlock_all_regions: boolean; adaptive_enabled: boolean; students: string; world_id: number; chat_mode: 'off' | 'preset' | 'free'; timezone: string; }

const PAGES = ['Dashboard', 'Students', 'Questions', 'Assignments', 'Quests', 'Events', 'Rewards', 'Achievements', 'World', 'Approvals', 'Chat', 'Analytics', 'Activity', 'Settings', 'Getting Started'] as const;
type Page = (typeof PAGES)[number];

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, () => void, string] {
  const [v, setV] = useState<T>();
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); fn().then(setV).catch((e) => setErr(e.message)); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [v, load, err];
}

export function TeacherApp({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [classes, reloadClasses] = useLoad<Cls[]>(() => api.get('/api/teacher/classes'), []);
  const [classId, setClassId] = useState<number | null>(() => Number(localStorage.getItem('cq_class')) || null);
  const initial = (currentPath().split('/')[2] ?? '').replace(/-/g, ' ');
  const [page, setPageState] = useState<Page>((PAGES.find((p) => p.toLowerCase() === initial) as Page) ?? 'Dashboard');
  const [creating, setCreating] = useState(false);
  const setPage = (p: Page) => { setPageState(p); setAddress(`/teacher/${p.toLowerCase().replace(/ /g, '-')}`, true); };

  const cls = classes?.find((c) => c.id === classId) ?? classes?.[0];
  useEffect(() => { if (cls) { try { localStorage.setItem('cq_class', String(cls.id)); } catch { /* ignore */ } } }, [cls]);
  useEffect(() => { if (classes && classes.length === 0) setPage('Getting Started'); }, [classes]);

  return (
    <div className="dash">
      <nav className="dash-nav" aria-label="Teacher dashboard">
        <div className="brand">Character Quest</div>
        {PAGES.map((p) => <button key={p} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>)}
        <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
          {me.role === 'admin' && <button onClick={() => navigate('/admin')}>Admin</button>}
          <button onClick={onLogout}>Log out ({me.displayName})</button>
        </div>
      </nav>
      <main className="dash-main">
        <div className="dash-top">
          <div className="row">
            <label className="label" htmlFor="cls">Class</label>
            <select id="cls" className="input" style={{ width: 280 }} value={cls?.id ?? ''} onChange={(e) => setClassId(Number(e.target.value))}>
              {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.grade ? ` (Grade ${c.grade})` : ''}</option>)}
              {classes?.length === 0 && <option value="">No classes yet</option>}
            </select>
            <button className="btn secondary" onClick={() => setCreating(true)}>+ New class</button>
          </div>
          {cls && <div className="row">
            <span className="tag" style={{ fontSize: '0.95rem' }}>Class code: <b style={{ letterSpacing: '0.1em' }}>{cls.join_code}</b></span>
            <button className="btn gold" onClick={() => navigate(`/play?class=${cls.id}`)}>Enter the world</button>
          </div>}
        </div>
        {creating && <NewClass onDone={(id) => { setCreating(false); if (id) { setClassId(id); reloadClasses(); } }} />}
        {page === 'Getting Started' ? <GettingStarted cls={cls} go={setPage} onCreate={() => setCreating(true)} /> :
          !cls ? <div className="card"><h2>Create your first class</h2><p>Classes have their own students, questions and shared world.</p><button className="btn" onClick={() => setCreating(true)}>Create a class</button></div> :
          page === 'Dashboard' ? <Dashboard cls={cls} go={setPage} /> :
          page === 'Students' ? <StudentsPage cls={cls} /> :
          page === 'Questions' ? <QuestionsPage cls={cls} /> :
          page === 'Assignments' ? <AssignmentsPage cls={cls} /> :
          page === 'Quests' ? <QuestsPage cls={cls} /> :
          page === 'Events' ? <EventsPage cls={cls} /> :
          page === 'Approvals' ? <ApprovalsPage cls={cls} onChanged={reloadClasses} /> :
          page === 'Chat' ? <ChatPage cls={cls} onChanged={reloadClasses} /> :
          page === 'Rewards' ? <RewardsPage cls={cls} /> :
          page === 'Achievements' ? <AchievementsPage cls={cls} /> :
          page === 'World' ? <WorldPage cls={cls} onChanged={reloadClasses} /> :
          page === 'Analytics' ? <AnalyticsPage cls={cls} /> :
          page === 'Activity' ? <ActivityPage cls={cls} /> :
          <SettingsPage cls={cls} onChanged={reloadClasses} />}
      </main>
    </div>
  );
}

function NewClass({ onDone }: { onDone: (id?: number) => void }) {
  const [name, setName] = useState(''); const [grade, setGrade] = useState(''); const [err, setErr] = useState('');
  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <h3>New class</h3>
      {err && <div className="error">{err}</div>}
      <form className="row" onSubmit={async (e) => { e.preventDefault(); try { const c = await api.post('/api/teacher/classes', { name, grade: grade || null }); onDone(c.id); } catch (x: any) { setErr(x.message); } }}>
        <input className="input" style={{ width: 280 }} placeholder="Class name, e.g. Room 12 Explorers" value={name} onChange={(e) => setName(e.target.value)} aria-label="Class name" />
        <input className="input" style={{ width: 120 }} placeholder="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Grade" />
        <button className="btn">Create class</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancel</button>
      </form>
      <p className="muted" style={{ marginTop: 8 }}>Each class gets its own world with a village, forest, desert, ocean and mountains.</p>
    </div>
  );
}

function Stat({ v, l }: { v: React.ReactNode; l: string }) { return <div className="stat"><div className="v">{v}</div><div className="l">{l}</div></div>; }

function Dashboard({ cls, go }: { cls: Cls; go: (p: Page) => void }) {
  const [o] = useLoad<any>(() => api.get(`/api/teacher/classes/${cls.id}/overview`), [cls.id]);
  const [levels] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/levels`), [cls.id]);
  const [act] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/activity`), [cls.id]);
  if (!o) return <p>Loading…</p>;
  return (
    <div className="stack">
      <h1>{cls.name}</h1>
      <div className="grid4">
        <Stat v={o.students} l="Students" /><Stat v={o.questionsCompleted.toLocaleString()} l="Questions completed" />
        <Stat v={o.accuracy === null ? '–' : `${o.accuracy}%`} l="Average accuracy" /><Stat v={o.xpEarned.toLocaleString()} l="XP earned" />
        <Stat v={o.buildings} l="Buildings created" /><Stat v={o.achievements} l="Achievements earned" />
        <Stat v={o.questions} l="Questions in bank" /><Stat v={o.blocksPlaced.toLocaleString()} l="Blocks placed" />
      </div>
      <div className="grid2">
        <div className="card">
          <h3>Levels</h3>
          {(levels ?? []).length === 0 && <p className="muted">No students yet. <button className="btn small" onClick={() => go('Students')}>Add students</button></p>}
          {(levels ?? []).map((s) => (
            <div key={s.name} className="skill-row" style={{ gridTemplateColumns: '120px 1fr 110px' }}>
              <b>{s.name}</b><div className="bar"><span style={{ width: `${s.pct * 100}%` }} /></div><span className="num">Lv {s.level} · {s.xp} XP</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Recent activity</h3>
          <ActivityList rows={(act ?? []).slice(0, 12)} />
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => go('Questions')}>Create a question</button>
        <button className="btn secondary" onClick={() => go('Analytics')}>See where students struggle</button>
        <button className="btn secondary" onClick={() => go('World')}>World settings</button>
      </div>
    </div>
  );
}

const ACTION_TEXT: Record<string, (d: any) => string> = {
  reward: (d) => `earned ${d.xp} XP${d.block ? `, ${d.block.qty} ${d.block.name}` : ''}${d.achievements?.length ? ` and the ${d.achievements.join(', ')} achievement` : ''}`,
  question_created: (d) => `created a question: “${d.prompt}”`,
  student_added: (d) => `added student ${d.username}`,
  student_joined: (d) => `joined the class as ${d.username}`,
  class_settings: () => 'changed world settings',
  teacher_bonus: (d) => `gave ${d.name ?? 'a student'} a bonus reward${d.reason ? ` (${d.reason})` : ''}`,
  remove_student_builds: (d) => `removed ${d.blocks} block${d.blocks === 1 ? '' : 's'} built by ${d.name ?? 'a student'}`,
  reset_area: (d) => `reset an area (${d.blocks} blocks)`,
  assignment_created: (d) => `created assignment “${d.title}”`,
  achievement_awarded: (d) => `awarded “${d.achievement}”`,
  questions_imported: (d) => `imported ${d.imported} questions`,
  quest_created: (d) => `created ${d.repeat === 'none' ? 'quest' : `${d.repeat} challenge`} “${d.title}”`,
  event_created: (d) => `started the event “${d.title}”`,
  event_points: (d) => `added ${d.points} points to “${d.event}”`,
  event_completed: (d) => `— class event “${d.title}” completed by ${d.helpers} helper${d.helpers === 1 ? '' : 's'}${d.structure ? `, unlocking the ${d.structure}` : ''}`,
  build_approved: (d) => `approved ${d.name ? `${d.name}'s` : 'a'} build (${d.blocks} blocks)`,
  build_rejected: (d) => `sent back ${d.name ? `${d.name}'s` : 'a'} build (${d.blocks} blocks)`,
  item_bought: (d) => `bought ${d.item} for ${d.price} coins`,
  chat_message_hidden: () => 'hid a chat message',
  chat_message_restored: () => 'restored a chat message',
  student_updated: (d) => `changed ${d.name ?? 'a student'}: ${[d.password && 'reset password', d.frozen === true && 'paused', d.frozen === false && 'unpaused', d.can_build === false && 'building off', d.can_build === true && 'building on', d.muted === true && 'chat muted', d.muted === false && 'chat unmuted', d.disabled === true && 'disabled', d.disabled === false && 'enabled', d.displayName && `renamed to ${d.displayName}`].filter(Boolean).join(', ') || 'settings'}`,
  student_deleted: (d) => `deleted student ${d.name ?? ''}`.trim(),
  teleport_student: (d) => `sent ${d.name ?? 'a student'} to their plot`,
  students_bulk_added: (d) => `added ${d.added} student${d.added === 1 ? '' : 's'} from a list`,
  zone_created: (d) => `created the project zone “${d.name}”`,
  question_updated: () => 'edited a question',
  question_deleted: (d) => `deleted the question “${d.prompt ?? ''}”`,
  question_hidden: (d) => `hid the question “${d.prompt}”`,
  question_shown: (d) => `showed the question “${d.prompt}”`,
  class_created: (d) => `created the class “${d.name}”`,
  quest_updated: (d) => `edited the quest “${d.title}”`,
  quest_deleted: (d) => `deleted the quest “${d.title}”`,
  quest_activated: (d) => `turned on the quest “${d.title}”`,
  quest_deactivated: (d) => `turned off the quest “${d.title}”`,
  event_deleted: (d) => `deleted the event “${d.title}”`
};
function ActivityList({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="muted">Nothing yet.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {rows.map((r) => (
        <li key={r.id} style={{ padding: '0.35em 0', borderBottom: '1px solid var(--line)' }}>
          <b>{r.actor ?? 'System'}</b> {(ACTION_TEXT[r.action] ?? ((_d: any) => r.action.replace(/_/g, ' ')))(r.details)}
          <div className="muted" style={{ fontSize: '0.8rem' }}>{new Date(r.created_at).toLocaleString()}</div>
        </li>
      ))}
    </ul>
  );
}

function ActivityPage({ cls }: { cls: Cls }) {
  const [rows, reload] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/activity`), [cls.id]);
  return <div className="stack"><div className="row" style={{ justifyContent: 'space-between' }}><h1>Activity log</h1><button className="btn secondary" onClick={reload}>Refresh</button></div>
    <p className="muted">Every reward, teacher change and moderation action is recorded here.</p><div className="card"><ActivityList rows={rows ?? []} /></div></div>;
}

function SettingsPage({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [name, setName] = useState(cls.name); const [grade, setGrade] = useState(cls.grade ?? ''); const [tz, setTz] = useState(cls.timezone); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { setName(cls.name); setGrade(cls.grade ?? ''); setTz(cls.timezone); }, [cls.id]);
  const zones = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
  return (
    <div className="stack">
      <h1>Class settings</h1>
      {msg && <div className="success">{msg}</div>}
      <div className="card">
        <div className="grid2">
          <div className="field"><label htmlFor="n">Class name</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="g">Grade</label><input id="g" className="input" value={grade} onChange={(e) => setGrade(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="tz">Time zone (daily challenges reset at midnight here)</label>
          <input id="tz" className="input" list="tzlist" value={tz} onChange={(e) => setTz(e.target.value)} style={{ maxWidth: 320 }} />
          {zones && <datalist id="tzlist">{zones.map((z) => <option key={z} value={z} />)}</datalist>}</div>
        {err && <div className="error">{err}</div>}
        <button className="btn" onClick={async () => { setErr(''); try { await api.patch(`/api/teacher/classes/${cls.id}`, { name, grade: grade || null, timezone: tz }); setMsg('Saved.'); onChanged(); } catch (x: any) { setErr(x.message); } }}>Save</button>
      </div>
      <div className="card">
        <h3>Class code</h3>
        <p>Students can create their own account at the login page with <b>Join a class</b> and the code <b style={{ letterSpacing: '0.1em' }}>{cls.join_code}</b>. Or add them yourself under Students.</p>
      </div>
      <div className="card">
        <h3>Export data</h3>
        <div className="row">
          <button className="btn secondary" onClick={async () => download(`class-${cls.id}-student-data.json`, JSON.stringify(await api.get(`/api/admin/classes/${cls.id}/export`), null, 2))}>Export student data (JSON)</button>
          <button className="btn secondary" onClick={() => downloadApi(`/api/teacher/classes/${cls.id}/questions.csv`, `questions-class-${cls.id}.csv`)}>Export question bank (CSV)</button>
        </div>
      </div>
    </div>
  );
}

function GettingStarted({ cls, go, onCreate }: { cls?: Cls; go: (p: Page) => void; onCreate: () => void }) {
  const steps: [string, string, React.ReactNode][] = [
    ['Create your teacher account', 'Done: you are logged in.', null],
    ['Create a class', 'Each class gets its own shared world.', <button className="btn small" onClick={onCreate}>Create class</button>],
    ['Add students', `Add students one by one or paste a list. Or give them the class code${cls ? ` ${cls.join_code}` : ''} to join themselves.`, <button className="btn small" onClick={() => go('Students')}>Students</button>],
    ['Choose your subjects and skills', 'Skills like Mathematics and Reading are ready. Add your own under Rewards.', <button className="btn small" onClick={() => go('Rewards')}>Skills</button>],
    ['Create questions', 'Use the question builder or import a CSV file.', <button className="btn small" onClick={() => go('Questions')}>Questions</button>],
    ['Set difficulty', 'Levels 1-5. Harder levels give more XP and rarer blocks.', null],
    ['Choose rewards', 'Every question has XP, a skill, a block and coins. Leave them blank to use the defaults for its difficulty.', null],
    ['Assign questions', 'Active questions appear in the Question Center. Group them into assignments for bonus rewards.', <button className="btn small" onClick={() => go('Assignments')}>Assignments</button>],
    ['Have students log in', 'Students log in with their username and password and enter the world.', null],
    ['Students answer and build', 'Watch progress on the Dashboard and Analytics, and visit the world yourself.', cls ? <button className="btn small gold" onClick={() => navigate(`/play?class=${cls.id}`)}>Enter world</button> : null]
  ];
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>Getting started</h1>
      <p>Character Quest turns learning into building: students answer your questions to earn XP and blocks, then build a world together. Here is the whole setup.</p>
      <ol className="steps">
        {steps.map(([t, d, a]) => <li key={t}><div><b>{t}</b><div className="muted">{d}</div>{a && <div style={{ marginTop: 6 }}>{a}</div>}</div></li>)}
      </ol>
      <div className="card"><h3>Try the demo</h3><p>The demo class “Grade 5 Adventure Class” has students Alex, Jordan, Sam and Taylor (password <b>quest123</b>). Open a private window and log in as <b>jordan</b> to see the student side.</p></div>
    </div>
  );
}
