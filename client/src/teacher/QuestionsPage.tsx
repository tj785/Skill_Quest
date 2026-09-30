import { useMemo, useRef, useState } from 'react';
import { api, downloadApi } from '../api';
import { useLoad, Cls } from './TeacherApp';
import { BLOCKS, BLOCK_BY_ID, DIFFICULTIES, difficultyDef, defaultBlockId, TIER_LABEL, QUESTION_TYPES } from '@cq/shared';

const TYPE_LABEL: Record<string, string> = { multiple_choice: 'Multiple choice', true_false: 'True / false', short_answer: 'Short answer', numeric: 'Number', matching: 'Matching pairs' };
const SUBJECTS = ['Math', 'Reading', 'Science', 'Writing', 'Programming', 'Social Studies', 'Bible', 'Vocabulary'];

export function QuestionsPage({ cls }: { cls: Cls }) {
  const [rows, reload, err] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/questions`), [cls.id]);
  const [skills] = useLoad<any[]>(() => api.get(`/api/teacher/classes/${cls.id}/skills`), [cls.id]);
  const [editing, setEditing] = useState<any | null>(null);
  const [filter, setFilter] = useState({ subject: 'All', text: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const subjects = useMemo(() => ['All', ...new Set((rows ?? []).map((r) => r.subject))], [rows]);
  if (editing) return <QuestionBuilder cls={cls} skills={skills ?? []} q={editing === 'new' ? null : editing} subjects={subjects.filter((s) => s !== 'All')}
    onDone={(saved) => { setEditing(null); if (saved) { setMsg({ ok: true, text: 'Question saved. Students can see it in the Question Center now.' }); reload(); } }} />;

  const list = (rows ?? []).filter((r) => (filter.subject === 'All' || r.subject === filter.subject) && (!filter.text || r.prompt.toLowerCase().includes(filter.text.toLowerCase()) || (r.topic ?? '').toLowerCase().includes(filter.text.toLowerCase())));

  async function importCsv(f: File) {
    const r = await api.post(`/api/teacher/classes/${cls.id}/questions/import`, { csv: await f.text() });
    const bad = r.results.filter((x: any) => !x.ok);
    setMsg({ ok: !bad.length, text: `Imported ${r.imported} questions.${bad.length ? ' Skipped: ' + bad.map((b: any) => `row ${b.row} (${b.error})`).join('; ') : ''}` });
    reload();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Question bank</h1>
        <div className="row">
          <button className="btn" onClick={() => setEditing('new')}>+ Create question</button>
          <button className="btn secondary" onClick={() => downloadApi(`/api/teacher/classes/${cls.id}/questions.csv`, `questions-class-${cls.id}.csv`)}>Export CSV</button>
          <button className="btn secondary" onClick={() => file.current?.click()}>Import CSV</button>
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 800 }}>CSV format</summary>
        <p>First row: column names. Needed: <code>Question</code>, <code>Answer</code>. Optional: <code>Type, Option A, Option B, Option C, Option D, Subject, Topic, Grade, Difficulty, XP, Skill, Skill Amount, Reward Block, Block Quantity, Coins, Explanation</code>.
          For multiple choice, put the correct option's text (or its letter) in Answer. Separate several accepted answers with <code>|</code>. For matching (Type <code>matching</code>), write the pairs in Answer like <code>cat=gato | dog=perro</code>. Blank reward cells use the difficulty defaults.</p>
      </details>
      <div className="row">
        <select className="input" style={{ width: 200 }} aria-label="Filter by subject" value={filter.subject} onChange={(e) => setFilter({ ...filter, subject: e.target.value })}>{subjects.map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input" style={{ width: 280 }} placeholder="Search questions or topics" aria-label="Search" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        <span className="muted">{list.length} questions</span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Question</th><th>Subject / topic</th><th>Difficulty</th><th>Reward</th><th>Accuracy</th><th>Solved by</th><th>Visible</th><th></th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 360 }}><b>{r.prompt}</b><div className="muted" style={{ fontSize: '0.8rem' }}>{TYPE_LABEL[r.type]} · Answer: {r.type === 'matching' ? r.answers.map((a: any) => `${a.text} → ${a.match_text}`).join(', ') : r.answers.filter((a: any) => a.is_correct).map((a: any) => a.text).join(' / ')}</div></td>
                <td>{r.subject}{r.topic ? <div className="muted">{r.topic}</div> : null}</td>
                <td>{r.difficulty} · {difficultyDef(r.difficulty).name}</td>
                <td style={{ fontSize: '0.85rem' }}>{r.xp_reward} XP{r.skill_name ? `, +${r.skill_amount} ${r.skill_name}` : ''}{r.block_id ? `, ${r.block_qty} ${BLOCK_BY_ID[r.block_id]?.name}` : ''}{r.coin_reward ? `, ${r.coin_reward} coins` : ''}</td>
                <td className="num">{r.accuracy === null ? '–' : `${r.accuracy}% (${r.attempts})`}</td>
                <td className="num">{r.solved_by}</td>
                <td><input type="checkbox" aria-label="Visible to students" checked={r.active} onChange={async (e) => { await api.patch(`/api/teacher/classes/${cls.id}/questions/${r.id}`, { active: e.target.checked }); reload(); }} /></td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn small secondary" onClick={() => setEditing(r)}>Edit</button>
                  <button className="btn small danger" onClick={async () => { if (confirm('Delete this question and its answer history?')) { await api.del(`/api/teacher/classes/${cls.id}/questions/${r.id}`); reload(); } }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No questions yet. Create one or import a CSV file.</p>}
      </div>
    </div>
  );
}

function QuestionBuilder({ cls, skills, q, subjects, onDone }: { cls: Cls; skills: any[]; q: any | null; subjects: string[]; onDone: (saved: boolean) => void }) {
  const mathSkill = skills.find((s) => s.name === 'Mathematics');
  const initialOptions = q?.type === 'multiple_choice' ? q.answers.map((a: any) => a.text) : ['', '', '', ''];
  const [f, setF] = useState({
    type: q?.type ?? 'multiple_choice', prompt: q?.prompt ?? '', subject: q?.subject ?? 'Math', topic: q?.topic ?? '', grade_level: q?.grade_level ?? (cls.grade ?? ''),
    difficulty: q?.difficulty ?? 1, explanation: q?.explanation ?? '', time_limit_sec: q?.time_limit_sec ?? '',
    xp_reward: q?.xp_reward ?? difficultyDef(1).xp, skill_id: q ? q.skill_id ?? '' : mathSkill?.id ?? '', skill_amount: q?.skill_amount ?? difficultyDef(1).skill,
    block_id: q ? q.block_id ?? '' : defaultBlockId(1), block_qty: q?.block_qty ?? difficultyDef(1).quantity, coin_reward: q?.coin_reward ?? difficultyDef(1).coins,
    numeric_tolerance: q?.numeric_tolerance ?? 0
  });
  const [options, setOptions] = useState<string[]>(initialOptions.length >= 2 ? initialOptions : ['', '', '', '']);
  const [correctIdx, setCorrectIdx] = useState<number>(q?.type === 'multiple_choice' ? Math.max(0, q.answers.findIndex((a: any) => a.is_correct)) : 0);
  const [tf, setTf] = useState<boolean>(q?.type === 'true_false' ? q.answers.find((a: any) => a.is_correct)?.text === 'True' : true);
  const [answerText, setAnswerText] = useState<string>(q && ['short_answer', 'numeric'].includes(q.type) ? q.answers.map((a: any) => a.text).join(' | ') : '');
  const [pairs, setPairs] = useState<{ left: string; right: string }[]>(q?.type === 'matching' ? q.answers.map((a: any) => ({ left: a.text, right: a.match_text ?? '' })) : [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }]);
  const [touched, setTouched] = useState(!!q);
  const [err, setErr] = useState('');
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const setReward = (k: string, v: unknown) => { setTouched(true); set(k, v); };

  function setDifficulty(d: number) {
    const def = difficultyDef(d);
    setF((x) => ({ ...x, difficulty: d, ...(touched ? {} : { xp_reward: def.xp, skill_amount: def.skill, block_id: defaultBlockId(d), block_qty: def.quantity, coin_reward: def.coins }) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    let answers: { text: string; is_correct: boolean; match_text?: string }[];
    if (f.type === 'matching') {
      answers = pairs.map((p) => ({ text: p.left.trim(), match_text: p.right.trim(), is_correct: true })).filter((a) => a.text || a.match_text);
      if (answers.some((a) => !a.text || !a.match_text)) { setErr('Fill in both sides of every pair (or clear the row).'); return; }
    } else if (f.type === 'multiple_choice') answers = options.map((t, i) => ({ text: t.trim(), is_correct: i === correctIdx })).filter((a) => a.text);
    else if (f.type === 'true_false') answers = [{ text: 'True', is_correct: tf }, { text: 'False', is_correct: !tf }];
    else answers = answerText.split('|').map((t) => ({ text: t.trim(), is_correct: true })).filter((a) => a.text);
    if (f.type === 'multiple_choice' && !options[correctIdx]?.trim()) { setErr('The option marked correct is empty.'); return; }
    const body = {
      ...f, answers, topic: f.topic || null, grade_level: f.grade_level || null, explanation: f.explanation || null,
      time_limit_sec: f.time_limit_sec === '' ? null : Number(f.time_limit_sec), skill_id: f.skill_id === '' ? null : Number(f.skill_id),
      block_id: f.block_id === '' ? null : Number(f.block_id), xp_reward: Number(f.xp_reward), skill_amount: Number(f.skill_amount), block_qty: Number(f.block_qty), coin_reward: Number(f.coin_reward),
      numeric_tolerance: Number(f.numeric_tolerance) || 0
    };
    try {
      if (q) await api.put(`/api/teacher/classes/${cls.id}/questions/${q.id}`, body);
      else await api.post(`/api/teacher/classes/${cls.id}/questions`, body);
      onDone(true);
    } catch (x: any) { setErr(x.message); }
  }

  const allSubjects = [...new Set([...SUBJECTS, ...subjects])];
  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 900 }}>
      <button type="button" className="btn small secondary" onClick={() => onDone(false)}>← Question bank</button>
      <h1>{q ? 'Edit question' : 'Create question'}</h1>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="card">
        <div className="grid4">
          <div className="field"><label htmlFor="sub">Subject</label>
            <input id="sub" className="input" list="subjects" value={f.subject} onChange={(e) => set('subject', e.target.value)} />
            <datalist id="subjects">{allSubjects.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="field"><label htmlFor="top">Topic</label><input id="top" className="input" placeholder="e.g. Fractions" value={f.topic} onChange={(e) => set('topic', e.target.value)} /></div>
          <div className="field"><label htmlFor="gr">Grade</label><input id="gr" className="input" value={f.grade_level} onChange={(e) => set('grade_level', e.target.value)} /></div>
          <div className="field"><label htmlFor="dif">Difficulty</label>
            <select id="dif" className="input" value={f.difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
              {DIFFICULTIES.map((d) => <option key={d.level} value={d.level}>{d.level} — {d.name}</option>)}
            </select></div>
        </div>
        <div className="field"><label htmlFor="typ">Question type</label>
          <select id="typ" className="input" style={{ maxWidth: 260 }} value={f.type} onChange={(e) => set('type', e.target.value)}>
            {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="pr">Question</label><textarea id="pr" className="input" value={f.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="What is 3/4 + 1/8?" /></div>
        {f.type === 'multiple_choice' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Possible answers (choose the correct one)</legend>
            {options.map((o, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <label className="row" style={{ gap: 4, width: 110 }}><input type="radio" name="correct" checked={correctIdx === i} onChange={() => setCorrectIdx(i)} /> {'ABCDEF'[i]}{correctIdx === i ? ' (correct)' : ''}</label>
                <input className="input" style={{ flex: 1 }} aria-label={`Option ${'ABCDEF'[i]}`} value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
            {options.length < 6 && <button type="button" className="btn small secondary" onClick={() => setOptions([...options, ''])}>+ Add option</button>}
          </fieldset>
        )}
        {f.type === 'matching' && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Pairs to match (students see the right side shuffled)</legend>
            {pairs.map((p, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input className="input" style={{ flex: 1 }} aria-label={`Pair ${i + 1} item`} placeholder="Item, e.g. Mercury" value={p.left} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)))} />
                <span aria-hidden="true">→</span>
                <input className="input" style={{ flex: 1 }} aria-label={`Pair ${i + 1} match`} placeholder="Match, e.g. Closest to the Sun" value={p.right} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)))} />
                {pairs.length > 2 && <button type="button" className="btn small secondary" aria-label={`Remove pair ${i + 1}`} onClick={() => setPairs(pairs.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            {pairs.length < 8 && <button type="button" className="btn small secondary" onClick={() => setPairs([...pairs, { left: '', right: '' }])}>+ Add pair</button>}
            <p className="hint">Students must match every pair correctly to earn the reward.</p>
          </fieldset>
        )}
        {f.type === 'true_false' && (
          <div className="row"><span className="label">Answer:</span>
            <label className="row" style={{ gap: 4 }}><input type="radio" checked={tf} onChange={() => setTf(true)} /> True</label>
            <label className="row" style={{ gap: 4 }}><input type="radio" checked={!tf} onChange={() => setTf(false)} /> False</label></div>
        )}
        {(f.type === 'short_answer' || f.type === 'numeric') && (
          <div className="grid2">
            <div className="field"><label htmlFor="ans">Answer</label><input id="ans" className="input" value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder={f.type === 'numeric' ? '56' : 'antonym | opposite'} />
              <span className="hint">{f.type === 'numeric' ? 'A number. Commas and spaces are ignored.' : 'Capital letters and extra spaces are ignored. Separate other accepted answers with |'}</span></div>
            {f.type === 'numeric' && <div className="field"><label htmlFor="tol">Allowed difference</label><input id="tol" type="number" step="any" min={0} className="input" value={f.numeric_tolerance} onChange={(e) => set('numeric_tolerance', e.target.value)} /><span className="hint">0 means exact. 0.01 accepts 3.14 for 3.1416.</span></div>}
          </div>
        )}
        <div className="field" style={{ marginTop: 10 }}><label htmlFor="ex">Explanation shown after a correct answer (optional)</label><input id="ex" className="input" value={f.explanation} onChange={(e) => set('explanation', e.target.value)} /></div>
      </div>
      <div className="card">
        <h3>Reward</h3>
        <p className="muted">Filled in from the difficulty. Change any value to override it.</p>
        <div className="grid4">
          <div className="field"><label htmlFor="xp">XP</label><input id="xp" type="number" min={0} className="input" value={f.xp_reward} onChange={(e) => setReward('xp_reward', e.target.value)} /></div>
          <div className="field"><label htmlFor="sk">Skill</label>
            <select id="sk" className="input" value={f.skill_id} onChange={(e) => setReward('skill_id', e.target.value)}>
              <option value="">None</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="ska">Skill points</label><input id="ska" type="number" min={0} className="input" value={f.skill_amount} onChange={(e) => setReward('skill_amount', e.target.value)} /></div>
          <div className="field"><label htmlFor="co">Coins</label><input id="co" type="number" min={0} className="input" value={f.coin_reward} onChange={(e) => setReward('coin_reward', e.target.value)} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label htmlFor="bl">Block</label>
            <select id="bl" className="input" value={f.block_id} onChange={(e) => setReward('block_id', e.target.value)}>
              <option value="">No block</option>
              {BLOCKS.filter((b) => b.tier !== 'natural').map((b) => <option key={b.id} value={b.id}>{b.name} ({TIER_LABEL[b.tier]})</option>)}
            </select></div>
          <div className="field"><label htmlFor="bq">Quantity</label><input id="bq" type="number" min={0} className="input" value={f.block_qty} onChange={(e) => setReward('block_qty', e.target.value)} /></div>
          <div className="field"><label htmlFor="tl">Time limit (seconds)</label><input id="tl" type="number" min={0} className="input" placeholder="None" value={f.time_limit_sec} onChange={(e) => set('time_limit_sec', e.target.value)} /></div>
        </div>
        <p style={{ marginBottom: 0 }}>Students earn: <b>+{f.xp_reward} XP</b>{f.skill_id ? `, +${f.skill_amount} ${skills.find((s) => s.id === Number(f.skill_id))?.name}` : ''}{f.block_id ? `, ${f.block_qty} ${BLOCK_BY_ID[Number(f.block_id)]?.name}` : ''}{Number(f.coin_reward) ? `, ${f.coin_reward} coins` : ''}. Rewards are given once, the first time a student answers correctly.</p>
      </div>
      <div className="row"><button className="btn gold">Save question</button><button type="button" className="btn secondary" onClick={() => onDone(false)}>Cancel</button></div>
    </form>
  );
}
