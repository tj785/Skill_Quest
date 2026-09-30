import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { BLOCK_BY_ID, TIER_LABEL, TIER_COLOR } from '@cq/shared';
import { Trophy } from '../ui/icons';

export interface PubQuestion {
  id: number; type: string; prompt: string; subject: string; topic: string | null; difficulty: number; difficultyName: string;
  time_limit_sec: number | null; options?: string[]; left?: string[]; right?: string[]; attempts: number; earned: boolean; recommended: boolean;
  reward: { xp: number; coins: number; skill_amount: number; block_id: number | null; block_qty: number };
}
export interface Assignment { id: number; title: string; description: string | null; total: string | number; done: string | number; completed: boolean; question_ids: number[] | null; xp_reward: number; block_id: number | null; block_qty: number; coin_reward: number; }

export function QuestionCenter({ onClose, onRewarded, icon, focusAssignment }: {
  onClose: () => void; onRewarded: (r: any) => void; icon: (id: number) => string; focusAssignment?: number | null;
}) {
  const [data, setData] = useState<{ questions: PubQuestion[]; assignments: Assignment[]; recommendations: { topic: string; accuracy: number; text: string }[] } | null>(null);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<PubQuestion | null>(null);
  const [subject, setSubject] = useState('All');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [assignment, setAssignment] = useState<number | null>(focusAssignment ?? null);

  const load = () => api.get('/api/student/questions').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const subjects = useMemo(() => ['All', ...new Set((data?.questions ?? []).map((q) => q.subject))], [data]);
  const list = (data?.questions ?? []).filter((q) =>
    (subject === 'All' || q.subject === subject) && (show === 'all' || !q.earned) &&
    (!assignment || data!.assignments.find((a) => a.id === assignment)?.question_ids?.includes(q.id)));
  list.sort((a, b) => Number(b.recommended) - Number(a.recommended));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="qc-title">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2 id="qc-title" style={{ margin: 0 }}>Question Center</h2>
            <div className="muted">Answer questions to earn XP, skills and building blocks. Wrong answers never cost you anything, so try again.</div>
          </div>
          <button className="btn secondary" onClick={onClose}>Back to world <span className="muted">(Esc)</span></button>
        </div>
        {err && <div className="error">{err}</div>}
        {active ? (
          <QuestionView q={active} icon={icon} onBack={() => { setActive(null); load(); }} onRewarded={onRewarded} />
        ) : !data ? <p>Loading questions…</p> : (
          <div className="stack">
            {data.recommendations.length > 0 && (
              <div className="card" style={{ background: '#eef3fe', borderColor: '#bcd0f7' }}>
                <b>Recommended practice:</b> {data.recommendations.map((r) => `${r.text} (${r.accuracy}% so far)`).join(', ')}. Questions marked ★ help most.
              </div>
            )}
            {data.assignments.length > 0 && (
              <div>
                <h3>Assignments</h3>
                <div className="qlist">
                  {data.assignments.map((a) => (
                    <button key={a.id} className={`qitem ${a.completed ? 'done' : ''}`} aria-pressed={assignment === a.id} onClick={() => setAssignment(assignment === a.id ? null : a.id)}
                      style={assignment === a.id ? { borderColor: 'var(--brand)', background: '#eef3fe' } : undefined}>
                      <div style={{ fontWeight: 800 }}>{a.completed ? '✓ ' : ''}{a.title}</div>
                      <div className="muted" style={{ fontSize: '0.9rem' }}>{a.description}</div>
                      <div className="bar" style={{ margin: '6px 0' }}><span style={{ width: `${(Number(a.done) / Math.max(1, Number(a.total))) * 100}%` }} /></div>
                      <div style={{ fontSize: '0.85rem' }}>{a.done}/{a.total} done · Bonus: {a.xp_reward} XP{a.block_id ? `, ${a.block_qty} ${BLOCK_BY_ID[a.block_id]?.name}` : ''}{a.coin_reward ? `, ${a.coin_reward} coins` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row">
              <label className="label" htmlFor="qs">Subject</label>
              <select id="qs" className="input" style={{ width: 180 }} value={subject} onChange={(e) => setSubject(e.target.value)}>
                {subjects.map((s) => <option key={s}>{s}</option>)}
              </select>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={show === 'all'} onChange={(e) => setShow(e.target.checked ? 'all' : 'open')} /> Show completed</label>
              {assignment && <button className="btn small secondary" onClick={() => setAssignment(null)}>Show all questions</button>}
            </div>
            {list.length === 0 && <p className="muted">{show === 'open' ? 'You have completed every question here. Check back when your teacher adds more.' : 'No questions yet.'}</p>}
            <div className="qlist">
              {list.map((q) => (
                <button key={q.id} className={`qitem ${q.earned ? 'done' : ''}`} onClick={() => setActive(q)}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <span className="tag">{q.subject}{q.topic ? ` · ${q.topic}` : ''}</span>
                    <span className="tag" title="Difficulty">Level {q.difficulty} · {q.difficultyName}</span>
                  </div>
                  <div style={{ fontWeight: 700, margin: '6px 0' }}>{q.recommended ? '★ ' : ''}{q.earned ? '✓ ' : ''}{q.prompt}</div>
                  <RewardLine q={q} icon={icon} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RewardLine({ q, icon }: { q: PubQuestion; icon: (id: number) => string }) {
  const b = q.reward.block_id ? BLOCK_BY_ID[q.reward.block_id] : null;
  return (
    <div className="row" style={{ gap: 8, fontSize: '0.85rem' }}>
      <span>+{q.reward.xp} XP</span>
      {b && q.reward.block_qty > 0 && (
        <span className="row" style={{ gap: 4 }}>
          <img src={icon(b.id)} alt="" width={18} height={18} style={{ imageRendering: 'pixelated' }} />
          {q.reward.block_qty} {b.name}
          <span className="tag" style={{ background: TIER_COLOR[b.tier], color: '#111' }}>{TIER_LABEL[b.tier]}</span>
        </span>
      )}
      {q.reward.coins > 0 && <span>+{q.reward.coins} coins</span>}
      {q.attempts > 0 && !q.earned && <span className="muted">{q.attempts} tries so far</span>}
    </div>
  );
}

function QuestionView({ q, icon, onBack, onRewarded }: { q: PubQuestion; icon: (id: number) => string; onBack: () => void; onRewarded: (r: any) => void }) {
  const [answer, setAnswer] = useState('');
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const matching = q.type === 'matching' && !!q.left && !!q.right;
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const started = useRef(Date.now());
  const [left, setLeft] = useState(q.time_limit_sec || 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (!q.time_limit_sec) return;
    const t = setInterval(() => setLeft(Math.max(0, q.time_limit_sec! - Math.floor((Date.now() - started.current) / 1000))), 250);
    return () => clearInterval(t);
  }, [q, result]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    let given = answer;
    if (matching) {
      if (q.left!.some((l) => !pairs[l])) { setErr('Match every item on the left before submitting.'); return; }
      given = JSON.stringify(pairs);
    } else if (!answer.trim()) { setErr('Choose or type an answer first.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/student/questions/${q.id}/answer`, { answer: given, timeSpentMs: Date.now() - started.current });
      setResult(r);
      if (r.reward || r.notices?.length) onRewarded(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const retry = () => { setResult(null); setAnswer(''); setPairs({}); started.current = Date.now(); setLeft(q.time_limit_sec || 0); };
  const timeUp = !!q.time_limit_sec && left === 0 && !result;
  const master = result?.correct && result.reward && q.difficulty >= 4;
  const block = result?.reward?.gained?.block;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn small secondary" onClick={onBack}>← All questions</button>
        <div className="row"><span className="tag">{q.subject}{q.topic ? ` · ${q.topic}` : ''}</span><span className="tag">Level {q.difficulty} · {q.difficultyName}</span>
          {q.time_limit_sec ? <span className="tag" aria-live="polite">⏱ {left}s</span> : null}</div>
      </div>
      <h2 style={{ fontSize: '1.6rem' }}>{q.prompt}</h2>
      {err && <div className="error" role="alert">{err}</div>}
      {result ? (
        result.correct ? (
          <div className={`reward-card ${master ? 'master' : ''}`} role="status">
            <h2>{result.alreadyEarned ? 'Correct!' : master ? (q.difficulty >= 5 ? 'MASTER QUESTION COMPLETE!' : 'ADVANCED QUESTION COMPLETE!') : 'Correct!'}</h2>
            <p style={{ fontWeight: 800 }}>{result.gains ?? result.message}</p>
            {result.reward?.leveledUp && <p className="levelup-line">⭐ LEVEL UP! You are now level {result.reward.level}: {result.reward.title}.</p>}
            {block && (
              <div className="row" style={{ justifyContent: master ? 'center' : 'flex-start', fontWeight: 800 }}>
                <img src={icon(block.id)} alt="" width={40} height={40} style={{ imageRendering: 'pixelated' }} />
                {['rare', 'epic', 'legendary'].includes(block.tier) ? `${TIER_LABEL[block.tier as 'rare']} block unlocked: ` : 'You earned '}{block.qty} {block.name}
              </div>
            )}
            {result.reward?.achievements?.map((a: any) => <p key={a.name} className="row" style={{ gap: 6, justifyContent: master ? 'center' : 'flex-start' }}><Trophy /> Achievement unlocked: <b>{a.name}</b></p>)}
            {result.assignmentsCompleted?.map((a: any) => <p key={a.title}>✓ Assignment complete: <b>{a.title}</b> (+{a.reward.gained.xp} XP)</p>)}
            {result.notices?.map((n: any, i: number) => <p key={i} style={{ fontWeight: n.kind === 'reward' ? 800 : 600 }}>{n.kind === 'reward' ? '★ ' : '→ '}{n.text}</p>)}
            {result.explanation && <p>{result.explanation}</p>}
            <div className="row" style={{ justifyContent: master ? 'center' : 'flex-start' }}>
              <button className="btn" onClick={onBack}>Next question</button>
            </div>
          </div>
        ) : (
          <div className="card" role="status" style={{ background: '#fff5e8', borderColor: '#f0c792' }}>
            <h3>Not quite yet</h3>
            <p>{result.message} Every try helps you learn.</p>
            {result.notices?.map((n: any, i: number) => <p key={i} style={{ fontWeight: 800 }}>★ {n.text}</p>)}
            <button className="btn" onClick={retry}>Try again</button>
          </div>
        )
      ) : timeUp ? (
        <div className="card"><h3>Time's up</h3><p>No problem. Take a breath and try again.</p><button className="btn" onClick={retry}>Restart timer</button></div>
      ) : (
        <form onSubmit={submit}>
          {matching ? (
            <div className="stack" style={{ gap: 8 }} role="group" aria-label="Match each item">
              <p className="muted" style={{ margin: 0 }}>Choose the matching answer for each item. Each answer is used once.</p>
              {q.left!.map((l, i) => {
                const used = new Set(Object.entries(pairs).filter(([k]) => k !== l).map(([, v]) => v));
                return (
                  <div key={l} className="match-row">
                    <label htmlFor={`m${i}`} className="match-left">{l}</label>
                    <span aria-hidden="true">→</span>
                    <select id={`m${i}`} className="input" value={pairs[l] ?? ''} onChange={(e) => setPairs((p) => ({ ...p, [l]: e.target.value }))}>
                      <option value="">Choose…</option>
                      {q.right!.map((r) => <option key={r} value={r} disabled={used.has(r)}>{r}{used.has(r) ? ' (used)' : ''}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : q.options ? (
            <div role="radiogroup" aria-label="Answer choices">
              {q.options.map((o, i) => (
                <button type="button" key={o} className="option" role="radio" aria-checked={answer === o} aria-pressed={answer === o} onClick={() => setAnswer(o)}>
                  <span className="tag" style={{ marginRight: 10 }}>{'ABCDEFGH'[i]}</span>{o}
                </button>
              ))}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="ans">{q.type === 'numeric' ? 'Your answer (a number)' : 'Your answer'}</label>
              <input ref={inputRef} id="ans" className="input" inputMode={q.type === 'numeric' ? 'decimal' : 'text'} value={answer} onChange={(e) => setAnswer(e.target.value)} autoComplete="off" style={{ fontSize: '1.3rem' }} />
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn gold" disabled={busy}>{busy ? 'Checking…' : 'Submit answer'}</button>
            <RewardLine q={q} icon={icon} />
          </div>
        </form>
      )}
    </div>
  );
}
