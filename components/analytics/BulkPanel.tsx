'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Database, Download, ListChecks } from 'lucide-react';
import { batchItemCounts } from '@/lib/analytics/jobs';
import { collectHistory, dateLabel, gameDate } from '@/lib/analytics/history';
import { analyticsStore, StorageError } from '@/lib/analytics/store';
import { analysisId, MAX_BATCH_GAMES, playerColor, playerKey, completedResult, PRESET_ORDER, type BatchJob } from '@/lib/analytics/model';
import { defaultPoolSize } from '@/lib/engine/stockfish';
import type { GameRecord } from '@/lib/games/types';
import { DEPTH_PRESETS, type AnalysisDepth } from '@/lib/settings';
import type { AnalyticsState } from '@/hooks/useAnalytics';
import { profileFilters, type AnalysisProfile, type PlayerAccount, type ProfileFilters as FilterValues } from '@/lib/analytics/profile';
import { SampleDisclosure } from './SampleDisclosure';
import { ProfileFilters } from './ProfileFilters';
import { Empty, Field, Section, Table, platform, titleCase, type OpenReview } from './shared';

const COUNTS = ['10', '25', '50', '100', '250', '500', '1000', 'custom', 'all'];
const PAGE = 20;

export function BulkPanel({ analytics, initialAccount, profile, onProfileChange, onDashboard, onReview }: {
  analytics: AnalyticsState;
  initialAccount: PlayerAccount;
  profile: AnalysisProfile | null;
  onProfileChange: (profile: AnalysisProfile) => void;
  onDashboard: () => void;
  onReview: OpenReview;
}) {
  const [account, setAccount] = useState(initialAccount);
  const [initialFilters, setInitialFilters] = useState<FilterValues>({});
  const [count, setCount] = useState('100');
  const [custom, setCustom] = useState(100);
  const { source, username, filters, depth } = profile ?? {
    ...account, filters: initialFilters, depth: 'standard' as const,
  };
  const updateFilters = (filters: FilterValues) => {
    if (profile) onProfileChange({ ...profile, filters });
    else setInitialFilters(filters);
  };
  const updateDepth = (depth: AnalysisDepth) => {
    if (profile) onProfileChange({ ...profile, depth, version: undefined });
  };
  const selectionKey = JSON.stringify([playerKey(source, username), filters, count, count === 'custom' ? custom : null]);
  const [maxWorkers, setMaxWorkers] = useState(1);
  const [workers, setWorkers] = useState(1);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadedKey, setLoadedKey] = useState<string>();
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
    const parsedFilters = profileFilters(filters);
    const { since, until, time, rated } = parsedFilters;
    const limit = count === 'all' ? MAX_BATCH_GAMES : count === 'custom' ? custom : Number(count);
    if (!name || !Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_GAMES || (since !== undefined && until !== undefined && since > until)) {
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
    setLoadedKey(undefined);
    setPage(0);
    setQuery('');
    let latest: GameRecord[] = [];
    try {
      latest = await collectHistory(source, name, {
        limit, signal: controller.signal, since, until, timeClass: time, rated, filters: parsedFilters,
        onGames: (games) => { latest = games; },
        onPage: (found, pages) => setMessage(`${found} matching · ${pages} history pages checked`),
        onBackoff: (seconds) => setMessage(seconds ? `Rate limited. Retrying in about ${seconds} seconds…` : 'Retrying…'),
      });
      if (!profile) onProfileChange({ source, username: name, filters, depth });
      setLoadedKey(selectionKey);
      if (count === 'all' && latest.length === MAX_BATCH_GAMES) setNotice(`Showing the first ${MAX_BATCH_GAMES} matches. Use date ranges for a larger history.`);
    } catch (err) {
      if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : 'Could not load game history.');
      if (latest.length && profile) {
        setLoadedKey(selectionKey);
        setNotice('Showing the matches fetched so far. This is a partial list.');
      }
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
  const jobs = profile ? analytics.jobs
    .filter((job) => playerKey(job.source, job.username) === playerKey(profile.source, profile.username))
    .sort((a, b) => b.createdAt - a.createdAt) : [];
  const currentSelection = !!profile && loadedKey === selectionKey;
  const job = jobs.find((j) => j.id === jobId) ?? jobs[0];
  const start = async () => {
    if (!currentSelection || starting) return;
    setStarting(true);
    if (profile?.version) onProfileChange({ ...profile, version: undefined });
    try {
      const created = await analytics.start(games.filter((g) => selected.has(g.id)), source, username, depth, workers);
      if (created) {
        setJobId(created.id);
        if (!analytics.active) void analytics.run(created.id);
      }
    } finally { setStarting(false); }
  };

  return <div className="grid gap-5">
    <form id="bulk-game-filters" tabIndex={-1} className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void search(); }}>
      <SampleDisclosure filters={filters} preset={profile ? titleCase(depth) : undefined} initiallyOpen
        detail={profile ? 'Choose which games to fetch. These filters also apply to your dashboard.'
          : 'Fetch games to set your active player.'}>
        <fieldset disabled={loading} className="grid min-w-0 gap-3">
          {!profile && <div className="grid grid-cols-2 gap-3">
            <Field label="Platform"><select className="input" value={source} onChange={(e) => setAccount({ ...account, source: e.target.value as PlayerAccount['source'] })}>
              <option value="chesscom">Chess.com</option><option value="lichess">Lichess</option>
            </select></Field>
            <Field label="Username"><input className="input min-w-0" value={username} placeholder="Player handle" required maxLength={40}
              onChange={(e) => setAccount({ ...account, username: e.target.value })} /></Field>
          </div>}
          <ProfileFilters values={filters} onChange={updateFilters} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Latest matching games"><select className="input" value={count} onChange={(e) => setCount(e.target.value)}>{COUNTS.map((n) => <option key={n} value={n}>{n === 'all' ? 'All matching' : n === 'custom' ? 'Custom count' : Number(n).toLocaleString()}</option>)}</select></Field>
            {count === 'custom' && <Field label="Custom count"><input className="input" type="number" min={1} max={MAX_BATCH_GAMES} value={custom} onChange={(e) => setCustom(e.target.valueAsNumber || 0)} /></Field>}
          </div>
        </fieldset>
      </SampleDisclosure>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" type="submit" disabled={loading || !username.trim()}>Fetch games</button>
        {loading && <button className="btn btn-ghost border border-line" type="button" onClick={() => request.current?.abort()}>Stop fetching</button>}
        {message && <span role="status" className="text-sm text-muted">{message}</span>}
      </div>
      {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}
      {profile && !loading && loadedKey && !currentSelection && <p className="text-sm text-muted">Fetch again to select games with the updated filters.</p>}
      {!loading && currentSelection && !games.length && !loadError && <p className="text-sm text-muted">No finished standard games matched these filters.</p>}
    </form>

    {!!games.length && currentSelection && <Section title="Select and analyze" icon={<ListChecks size={20} />} detail={`${username} · ${platform(source)} · ${games.length.toLocaleString()} matching games`}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Search fetched games"><input className="input" placeholder="Player or opening" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></Field>
        <Field label="Sort games"><select className="input" value={order} onChange={(e) => { setOrder(e.target.value); setPage(0); }}><option value="latest">Newest first</option><option value="earliest">Oldest first</option></select></Field>
        <button className="btn btn-ghost border border-line" onClick={() => setSelected((prev) => new Set([...prev, ...matches.map((g) => g.id)]))}>Select all matches</button>
        <button className="btn btn-ghost border border-line" onClick={() => setSelected(new Set())}>Clear selection</button>
      </div>
      <Table headers={['Include', 'Game', 'Date', 'Time control', 'Result']}>
        {matches.slice(pageNumber * PAGE, (pageNumber + 1) * PAGE).map((g) => {
          const color = playerColor(g, username)!;
          return <tr key={g.id}><td><input type="checkbox" aria-label={`Select ${g.white.name} vs ${g.black.name} on ${dateLabel(gameDate(g))}`} checked={selected.has(g.id)}
            onChange={(e) => setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(g.id); else next.delete(g.id); return next; })} /></td>
            <td className="font-semibold">{g.white.name} <span className="text-muted">vs</span> {g.black.name}</td><td>{dateLabel(gameDate(g))}</td>
            <td>{titleCase(g.timeClass)}</td><td>{titleCase(completedResult(g, color) ?? 'Unknown')}</td></tr>;
        })}
      </Table>
      <Pager total={matches.length} page={pageNumber} setPage={setPage} />
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="Analysis preset"><select className="input" value={depth} onChange={(e) => updateDepth(e.target.value as AnalysisDepth)}>{PRESET_ORDER.map((p) => <option key={p} value={p}>{DEPTH_PRESETS[p].label}</option>)}</select></Field>
        <Field label="Engine workers"><select className="input" value={workers} onChange={(e) => setWorkers(Number(e.target.value))}>{Array.from({ length: maxWorkers }, (_, i) => <option value={i + 1} key={i}>{i + 1}</option>)}</select></Field>
        <button className="btn btn-primary" disabled={!selected.size || starting || !analytics.ready} onClick={() => void start()}>
          {analytics.active ? 'Queue' : 'Analyze'} {selected.size.toLocaleString()} selected
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">{DEPTH_PRESETS[depth].hint}. Finished games at this preset are reused. Choose a deeper preset to analyze the same selection again.</p>
    </Section>}

    <Section id="bulk-batch-queue" tabIndex={-1} title="Batch queue" icon={<Database size={20} />} detail="Analysis runs while this app is open. After a reload, resume an unfinished batch to continue.">
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
  onDashboard: () => void; onReview: OpenReview;
}) {
  const [page, setPage] = useState(0);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const active = analytics.active === job.id;
  const recoverable = ['queued', 'paused', 'running'].includes(job.status);
  const progress = analytics.progress?.jobId === job.id ? analytics.progress : null;
  const counts = batchItemCounts(job);
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
      {completed > 0 && <button className="btn btn-ghost border border-line" onClick={onDashboard}>View results <ChevronRight size={16} /></button>}
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
  return <Section id="bulk-import" tabIndex={-1} title="Import CLI analyses" icon={<Download size={20} />} detail="Add a versioned JSONL file produced by the player analysis command. Existing compatible games are kept.">
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
