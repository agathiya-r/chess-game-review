'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartNoAxesCombined, ChevronRight, Database, ListChecks } from 'lucide-react';
import { collectHistory, dateLabel, dayEnd, dayStart, gameDate } from '@/lib/analytics/history';
import { analyticsStore, StorageError } from '@/lib/analytics/store';
import { analysisId, MAX_BATCH_GAMES, playerColor, completedResult, PRESET_ORDER, type BatchJob } from '@/lib/analytics/model';
import { defaultPoolSize } from '@/lib/engine/stockfish';
import type { GameRecord, TimeClass } from '@/lib/games/types';
import { DEPTH_PRESETS, type AnalysisDepth } from '@/lib/settings';
import type { AnalyticsState } from '@/hooks/useAnalytics';
import { Empty, Field, Section, Table, platform, TIME_CLASSES, titleCase, type OpenReview } from './shared';

const COUNTS = ['10', '25', '50', '100', '250', '500', '1000', 'custom', 'all'];
const PAGE = 20;

export function BulkPanel({ analytics, initialSource, initialName, onDashboard, onReview }: {
  analytics: AnalyticsState;
  initialSource: BatchJob['source'];
  initialName: string;
  onDashboard: (source: BatchJob['source'], name: string, depth: AnalysisDepth) => void;
  onReview: OpenReview;
}) {
  const [source, setSource] = useState(initialSource);
  const [username, setUsername] = useState(initialName);
  const [time, setTime] = useState<TimeClass | ''>('');
  const [rated, setRated] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [count, setCount] = useState('100');
  const [custom, setCustom] = useState(100);
  const [depth, setDepth] = useState<AnalysisDepth>('standard');
  const [maxWorkers, setMaxWorkers] = useState(1);
  const [workers, setWorkers] = useState(1);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<{ source: BatchJob['source']; username: string }>();
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('latest');
  const [jobId, setJobId] = useState('');
  const request = useRef<AbortController>(null);
  useEffect(() => {
    queueMicrotask(() => {
      const n = defaultPoolSize();
      setMaxWorkers(n);
      setWorkers(Math.min(n, 2));
    });
    return () => request.current?.abort();
  }, []);

  const search = async () => {
    const name = username.trim();
    const limit = count === 'all' ? MAX_BATCH_GAMES : count === 'custom' ? custom : Number(count);
    if (!name || !Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_GAMES || (from && to && from > to)) {
      setLoadError(`Enter a username, a valid date range, and a limit from 1 to ${MAX_BATCH_GAMES}.`);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError('');
    setNotice('');
    setMessage('Looking up game history…');
    setGames([]);
    setSelected(new Set());
    setLoaded({ source, username: name });
    setPage(0);
    setQuery('');
    let latest: GameRecord[] = [];
    try {
      latest = await collectHistory(source, name, {
        limit, signal: controller.signal, since: dayStart(from), until: dayEnd(to), timeClass: time || undefined,
        rated: rated ? rated === 'rated' : undefined,
        onGames: (games) => { latest = games; },
        onPage: (found, pages) => setMessage(`${found} matching · ${pages} history pages checked`),
        onBackoff: (seconds) => setMessage(seconds ? `Rate limited. Retrying in about ${seconds} seconds…` : 'Retrying…'),
      });
      if (count === 'all' && latest.length === MAX_BATCH_GAMES) setNotice(`Showing the first ${MAX_BATCH_GAMES} matches. Use date ranges for a larger history.`);
    } catch (err) {
      if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : 'Could not load game history.');
      if (latest.length) setNotice('Showing the matches fetched so far. This is a partial list.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
        setMessage('');
        setGames(latest);
        setSelected(new Set(latest.map((g) => g.id)));
      }
    }
  };
  const matches = useMemo(() => games.filter((g) => `${g.white.name} ${g.black.name} ${g.opening ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => order === 'earliest' ? (gameDate(a) ?? 0) - (gameDate(b) ?? 0) : (gameDate(b) ?? 0) - (gameDate(a) ?? 0)),
  [games, query, order]);
  const pageNumber = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE) - 1));
  const jobs = [...analytics.jobs].sort((a, b) => b.createdAt - a.createdAt);
  const job = jobs.find((j) => j.id === jobId) ?? jobs[0];
  const start = async () => {
    if (!loaded || starting) return;
    setStarting(true);
    try {
      const created = await analytics.start(games.filter((g) => selected.has(g.id)), loaded.source, loaded.username, depth, workers);
      if (created) {
        setJobId(created.id);
        if (!analytics.active) void analytics.run(created.id);
      }
    } finally { setStarting(false); }
  };

  return <div className="grid gap-5">
    <div className="analytics-hero">
      <span className="analytics-eyebrow"><ListChecks size={16} /> ANALYSIS WORKSPACE</span>
      <h1>Bulk analysis</h1>
      <p>Build a sample from your game history. Stockfish analyzes each game on this device and saves it to your library.</p>
      <button className="btn btn-ghost mt-4 border border-line" onClick={() => onDashboard(source, username, depth)}><ChartNoAxesCombined size={16} /> Open dashboard <ChevronRight size={16} /></button>
    </div>
    <Section title="Find games" detail="Date filters use UTC. For Lichess, the date is when the game started; Chess.com supplies the finish date.">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <fieldset disabled={loading} className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Platform"><select className="input" value={source} onChange={(e) => setSource(e.target.value as BatchJob['source'])}><option value="chesscom">Chess.com</option><option value="lichess">Lichess</option></select></Field>
          <Field label="Username"><input className="input min-w-0" value={username} placeholder="Player handle" required maxLength={40} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Time control"><select className="input" value={time} onChange={(e) => setTime(e.target.value as TimeClass | '')}><option value="">Any time control</option>{TIME_CLASSES.map((t) => <option value={t} key={t}>{titleCase(t)}</option>)}</select></Field>
          <Field label="Rated status"><select className="input" value={rated} onChange={(e) => setRated(e.target.value)}><option value="">Rated and unrated</option><option value="rated">Rated only</option><option value="casual">Unrated only</option></select></Field>
          <Field label="From (UTC)"><input className="input min-w-0" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Through (UTC)"><input className="input min-w-0" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Latest matching games"><select className="input" value={count} onChange={(e) => setCount(e.target.value)}>{COUNTS.map((n) => <option key={n} value={n}>{n === 'all' ? 'All matching' : n === 'custom' ? 'Custom count' : Number(n).toLocaleString()}</option>)}</select></Field>
          {count === 'custom' && <Field label="Custom count"><input className="input" type="number" min={1} max={MAX_BATCH_GAMES} value={custom} onChange={(e) => setCustom(e.target.valueAsNumber || 0)} /></Field>}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" type="submit" disabled={loading}>Fetch games</button>
          {loading && <button className="btn btn-ghost border border-line" type="button" onClick={() => request.current?.abort()}>Stop fetching</button>}
          {message && <span role="status" className="text-sm text-muted">{message}</span>}
        </div>
      </form>
      {loadError && <p role="alert" className="mt-4 text-sm text-danger">{loadError}</p>}
      {notice && <p className="mt-4 text-sm text-muted">{notice}</p>}
      {!loading && loaded && !games.length && !loadError && <p className="mt-4 text-sm text-muted">No finished standard games matched these filters.</p>}
    </Section>

    {!!games.length && loaded && <Section title="Select and analyze" detail={`${loaded.username} · ${platform(loaded.source)} · ${games.length.toLocaleString()} matching games`}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Search fetched games"><input className="input" placeholder="Player or opening" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></Field>
        <Field label="Sort games"><select className="input" value={order} onChange={(e) => { setOrder(e.target.value); setPage(0); }}><option value="latest">Newest first</option><option value="earliest">Oldest first</option></select></Field>
        <button className="btn btn-ghost border border-line" onClick={() => setSelected((prev) => new Set([...prev, ...matches.map((g) => g.id)]))}>Select all matches</button>
        <button className="btn btn-ghost border border-line" onClick={() => setSelected(new Set())}>Clear selection</button>
      </div>
      <Table headers={['Include', 'Game', 'Date', 'Time control', 'Result']}>
        {matches.slice(pageNumber * PAGE, (pageNumber + 1) * PAGE).map((g) => {
          const color = playerColor(g, loaded.username)!;
          return <tr key={g.id}><td><input type="checkbox" aria-label={`Select ${g.white.name} vs ${g.black.name} on ${dateLabel(gameDate(g))}`} checked={selected.has(g.id)}
            onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(g.id); else next.delete(g.id); return next; })} /></td>
            <td className="font-semibold">{g.white.name} <span className="text-muted">vs</span> {g.black.name}</td><td>{dateLabel(gameDate(g))}</td>
            <td>{titleCase(g.timeClass)}</td><td>{titleCase(completedResult(g, color) ?? 'Unknown')}</td></tr>;
        })}
      </Table>
      <Pager total={matches.length} page={pageNumber} setPage={setPage} />
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="Analysis preset"><select className="input" value={depth} onChange={(e) => setDepth(e.target.value as AnalysisDepth)}>{PRESET_ORDER.map((p) => <option key={p} value={p}>{DEPTH_PRESETS[p].label}</option>)}</select></Field>
        <Field label="Engine workers"><select className="input" value={workers} onChange={(e) => setWorkers(Number(e.target.value))}>{Array.from({ length: maxWorkers }, (_, i) => <option value={i + 1} key={i}>{i + 1}</option>)}</select></Field>
        <button className="btn btn-primary" disabled={!selected.size || starting || !analytics.ready} onClick={() => void start()}>
          {analytics.active ? 'Queue' : 'Analyze'} {selected.size.toLocaleString()} selected
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">{DEPTH_PRESETS[depth].hint}. Finished games at this preset are reused. Choose a deeper preset to analyze the same selection again.</p>
    </Section>}

    <Section title="Batch queue" detail="Analysis runs while this app is open. After a reload, resume an unfinished batch to continue.">
      {analytics.error && <div role="alert" className="mb-4 rounded-lg border border-danger/50 p-3 text-sm">{analytics.error}
        {!analytics.ready && <button className="ml-2 underline" onClick={() => void analytics.reload()}>Retry loading</button>}
      </div>}
      {job ? <>
        <Field label="Batch"><select className="input w-full max-w-xl" value={job.id} onChange={(e) => setJobId(e.target.value)}>
          {jobs.map((j) => <option value={j.id} key={j.id}>{j.username} · {platform(j.source)} · {titleCase(j.spec.depth)} · {j.items.length} games · {new Date(j.createdAt).toLocaleString()}</option>)}
        </select></Field>
        <JobStatus key={job.id} job={job} analytics={analytics} onDashboard={onDashboard} onReview={onReview} />
      </> : <Empty><Database className="mx-auto mb-3" size={24} />{analytics.ready ? 'No batches yet. Fetch games to start your first analysis.' : 'Loading the local library…'}</Empty>}
    </Section>
    <ImportPanel onSaved={analytics.saved} />
  </div>;
}

function Pager({ total, page, setPage }: { total: number; page: number; setPage: (n: number) => void }) {
  if (total <= PAGE) return null;
  return <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
    <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
    <button className="btn btn-ghost border border-line" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
    <button className="btn btn-ghost border border-line" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button>
  </div>;
}

function JobStatus({ job, analytics, onDashboard, onReview }: {
  job: BatchJob; analytics: AnalyticsState;
  onDashboard: (source: BatchJob['source'], name: string, depth: AnalysisDepth) => void; onReview: OpenReview;
}) {
  const [page, setPage] = useState(0);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const active = analytics.active === job.id;
  const recoverable = ['queued', 'paused', 'running'].includes(job.status);
  const progress = analytics.progress?.jobId === job.id ? analytics.progress : null;
  const counts = { pending: 0, done: 0, reused: 0, failed: 0, cancelled: 0 };
  for (const item of job.items) counts[item.status]++;
  const completed = counts.done + counts.reused;
  const processed = completed + counts.failed + counts.cancelled;
  const shown = onlyFailed ? job.items.filter((i) => i.status === 'failed') : job.items;
  const pageNumber = Math.min(page, Math.max(0, Math.ceil(shown.length / PAGE) - 1));
  const current = job.items.find((i) => i.gameId === progress?.gameId);
  const summaries = useMemo(() => new Map(analytics.summaries.map((row) => [row.id, row])), [analytics.summaries]);

  return <div className="mt-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-bold">{active && analytics.control ? (analytics.control === 'pause' ? 'Pausing…' : 'Cancelling…')
        : !active && job.status === 'running' ? 'Unfinished' : titleCase(job.status)}</p>
      <p role="status" className="text-sm text-muted">{completed} saved · {counts.reused} reused · {counts.failed} failed · {counts.cancelled} cancelled · {counts.pending} pending</p>
    </div>
    <progress className="mt-2 h-2 w-full accent-accent" aria-label="Batch progress" max={job.items.length} value={processed + (progress?.fraction ?? 0)} />
    <p className="mt-1 min-h-5 text-xs text-muted">{current ? `${current.label} · ${progress?.stage === 'deep' ? 'Checking key moves' : 'Searching positions'} · ${Math.round((progress?.fraction ?? 0) * 100)}%` : `${processed} of ${job.items.length} processed`}</p>
    <div className="my-4 flex flex-wrap gap-2">
      {active ? <button className="btn btn-ghost border border-line" disabled={!!analytics.control} onClick={() => analytics.stop('pause')}>Pause</button>
        : recoverable && <button className="btn btn-primary" disabled={!!analytics.active} onClick={() => void analytics.run(job.id)}>{job.status === 'queued' ? 'Start batch' : 'Resume'}</button>}
      {(active || recoverable) && <button className="btn btn-ghost border border-line" disabled={!!analytics.control || (!!analytics.active && !active)} onClick={() => void analytics.cancel(job.id)}>Cancel batch</button>}
      {!active && job.status === 'finished' && counts.failed > 0 && <button className="btn btn-ghost border border-line" disabled={!!analytics.active} onClick={() => void analytics.run(job.id, true)}>Retry failed games</button>}
      {completed > 0 && <button className="btn btn-ghost border border-line" onClick={() => onDashboard(job.source, job.username, job.spec.depth)}>View results <ChevronRight size={16} /></button>}
    </div>
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Per-game status</summary>
      <label className="my-3 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={onlyFailed} onChange={(e) => { setOnlyFailed(e.target.checked); setPage(0); }} /> Show failures only</label>
      <Table headers={['Game', 'Status']}>{shown.slice(pageNumber * PAGE, (pageNumber + 1) * PAGE).map((item) => {
        const row = summaries.get(analysisId(item.gameId, job.spec));
        const color = row && playerColor(row.game, job.username);
        return <tr key={item.gameId}><td>{row && color ? <button className="text-accent-strong underline" onClick={() => onReview(row, color)}>{item.label}</button> : item.label}</td>
          <td>{item.gameId === progress?.gameId ? 'Analyzing' : titleCase(item.status)}{item.error && <div className="max-w-md whitespace-normal text-xs text-danger">{item.error}</div>}</td></tr>;
      })}</Table>
      <Pager total={shown.length} page={pageNumber} setPage={setPage} />
    </details>
  </div>;
}

function ImportPanel({ onSaved }: { onSaved: AnalyticsState['saved'] }) {
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const importFile = async (file: File) => {
    setBusy(true);
    setErrors([]);
    setStatus('Reading analyses…');
    let imported = 0, reused = 0, invalid = 0, index = 0;
    const problems: string[] = [];
    try {
      const [{ readTransferLine, transferLines }, { loadOpeningBook }] = await Promise.all([
        import('@/lib/analytics/transfer'), import('@/lib/analysis/openings'),
      ]);
      const book = await loadOpeningBook(true);
      for await (const line of transferLines(file.stream())) {
        index++;
        try {
          const result = readTransferLine(line, book);
          const existing = await analyticsStore.summary(result.summary.id);
          if (existing && await analyticsStore.detail(result.summary.id)) reused++;
          else {
            await analyticsStore.finishGame(result);
            onSaved(result.summary);
            imported++;
          }
        } catch (err) {
          if (err instanceof StorageError) throw err;
          invalid++;
          if (problems.length < 5) problems.push(`Row ${index}: ${err instanceof Error ? err.message : 'Invalid record.'}`);
        }
        if (index % 20 === 0) {
          setStatus(`Read ${index.toLocaleString()} rows…`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    } catch (err) {
      problems.push(err instanceof Error ? err.message : 'Import stopped.');
    } finally {
      setErrors(problems);
      setStatus(index ? `${imported} imported · ${reused} already saved · ${invalid} invalid` : 'No analyses imported.');
      setBusy(false);
    }
  };
  return <Section title="Import CLI analyses" detail="Add a versioned JSONL file produced by the player analysis command. Existing compatible games are kept.">
    <input className="input max-w-full text-sm" type="file" aria-label="Import analysis file" accept=".jsonl,.ndjson"
      disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void importFile(file);
      }} />
    {status && <p role="status" className="mt-3 text-sm text-muted">{status}</p>}
    {!!errors.length && <ul className="mt-2 list-inside list-disc text-sm text-danger" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
  </Section>;
}
