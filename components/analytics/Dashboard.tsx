'use client';

import { useMemo, useState } from 'react';
import { Activity, BookOpen, ChartNoAxesCombined, Crosshair, Gauge, Layers3, ListChecks, TrendingUp } from 'lucide-react';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import type { Phase } from '@/lib/analysis/phases';
import { CLASSIFICATION_LABEL, CLASSIFICATIONS } from '@/lib/analysis/types';
import { dateLabel } from '@/lib/analytics/history';
import { analysisSpec, playerKey, PRESET_ORDER, specKey, type StoredSummary } from '@/lib/analytics/model';
import { aggregate, filterSample, groupSample, PHASES, ratio, sampleFor, trend, weaknesses, type Interval, type SampleGame } from '@/lib/analytics/stats';
import { gameLength, ratingBracket } from '@/lib/analytics/filters';
import { profileFilters, type AnalysisProfile } from '@/lib/analytics/profile';
import { ProfileFilters } from './ProfileFilters';
import { BrilliantMoves } from './BrilliantMoves';
import { SampleDisclosure } from './SampleDisclosure';
import { AccuracyChart } from './AccuracyChart';
import { Empty, Field, Section, Table, num, pct, titleCase, type AnalyticsPage, type OpenReview } from './shared';

type DashboardPage = Exclude<AnalyticsPage, 'bulk'>;
const pageInfo = {
  dashboard: { title: 'Player dashboard', description: 'Track your accuracy, compare conditions, and open any game behind the numbers.' },
  openings: { title: 'Opening performance', description: 'See how you play in the opening and what happens in the rest of those games.' },
  weaknesses: { title: 'Weaknesses & training', description: 'Find recurring mistakes in engine lines, then retry the positions yourself.' },
};

export function Dashboard({ rows, page, profile, onProfileChange, onBulk, onReview }: {
  rows: StoredSummary[];
  page: DashboardPage;
  profile: AnalysisProfile | null;
  onProfileChange: (profile: AnalysisProfile) => void;
  onBulk: () => void;
  onReview: OpenReview;
}) {
  const versions = useMemo(() => {
    const all = new Map(PRESET_ORDER.map((depth) => {
      const spec = analysisSpec(depth);
      return [specKey(spec), spec] as const;
    }));
    if (profile) for (const row of rows) {
      if (row.game.source === profile.source && [row.game.white, row.game.black].some((p) => p.name.toLowerCase() === profile.username.toLowerCase())) {
        all.set(specKey(row.spec), row.spec);
      }
    }
    return all;
  }, [rows, profile]);
  const chosenVersion = profile
    ? profile.version && versions.has(profile.version) ? profile.version : specKey(analysisSpec(profile.depth))
    : '';
  const spec = versions.get(chosenVersion);
  const sample = useMemo(() => profile ? sampleFor(rows, profile.source, profile.username, chosenVersion) : [], [rows, profile, chosenVersion]);
  const matching = useMemo(() => profile ? filterSample(sample, profileFilters(profile.filters)) : [], [sample, profile]);
  const totals = useMemo(() => aggregate(matching), [matching]);
  const info = pageInfo[page];

  return <div className="grid gap-5">
    <div className="analytics-hero">
      <h1>{info.title}</h1>
      <p>{info.description}</p>
    </div>
    {!profile ? <Section title="Choose your player" icon={<ListChecks size={20} />}>
      <Empty><p>Set your Chess.com or Lichess username in Bulk Analysis to see your games here.</p>
        <button className="btn btn-primary mt-4" onClick={onBulk}><ListChecks size={16} /> Set up player</button>
      </Empty>
    </Section> : <>
      <SampleDisclosure key={page} filters={profile.filters} preset={`${titleCase(profile.depth)}${spec && chosenVersion !== specKey(analysisSpec(spec.depth)) ? ' (archived)' : ''}`} detail={`${totals.n.toLocaleString()} of ${sample.length.toLocaleString()} saved games · ${totals.dateRange ? totals.dateRange.map(dateLabel).join(' – ') : 'No known dates in this sample'}`}>
        <ProfileFilters values={profile.filters} onChange={(filters) => onProfileChange({ ...profile, filters })} />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <Field label="Analysis preset"><select className="input" value={chosenVersion} onChange={(e) => {
            const next = versions.get(e.target.value);
            if (next) onProfileChange({ ...profile, depth: next.depth,
              version: e.target.value === specKey(analysisSpec(next.depth)) ? undefined : e.target.value });
          }}>
            {[...versions].map(([key, s]) => <option key={key} value={key}>{titleCase(s.depth)}{key !== specKey(analysisSpec(s.depth)) ? ` · v${s.algorithm}.${s.metrics} (archived)` : ''}</option>)}
          </select></Field>
          <p className="text-xs text-muted">{spec?.engine} · algorithm v{spec?.algorithm} · metrics v{spec?.metrics}</p>
          <button className="btn btn-ghost border border-line" onClick={() => onProfileChange({ ...profile, filters: {} })}>Reset filters</button>
        </div>
      </SampleDisclosure>
      {!matching.length ? <Empty>No analyzed games match these filters.</Empty> : page === 'openings' ? <Openings rows={matching} />
        : page === 'weaknesses' ? <Weaknesses rows={matching} onReview={onReview} />
        : <>
          <Metrics totals={totals} />
          <BrilliantMoves key={playerKey(profile.source, profile.username) + chosenVersion} rows={matching} onReview={onReview} />
          <History key={playerKey(profile.source, profile.username) + chosenVersion} rows={matching} onReview={onReview} />
          <Breakdown rows={matching} />
          <PhaseTable rows={matching} />
          <Conditions rows={matching} />
          <GameTable rows={matching} onReview={onReview} />
        </>}
    </>}
  </div>;
}

function Metrics({ totals: t }: { totals: ReturnType<typeof aggregate> }) {
  const metrics = [
    ['Analyzed games', t.n.toLocaleString(), `${t.totals.all.toLocaleString()} player moves`, Layers3],
    ['Mean game accuracy', pct(t.accuracy), `${t.accuracyN} scored games · estimate`, Gauge],
    ['Average CP loss', num(t.acpl), `${t.totals.graded.toLocaleString()} graded moves`, Activity],
    ['Blunders / game', num(t.blunders, 2), `${t.totals.counts.blunder} in sample`, Crosshair],
    ['Mistakes / game', num(t.mistakes, 2), `${t.totals.counts.mistake} in sample`, ListChecks],
    ['Best moves', pct(t.bestPct), 'Best / graded moves', Gauge],
    ['Win rate', pct(t.winPct), `${t.wins} wins / ${t.knownResults} known results`, TrendingUp],
    ['Mean move accuracy', pct(t.moveAccuracy), 'Weighted by graded moves', Activity],
  ] as const;
  return <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
    {metrics.map(([label, value, detail, Icon]) => <div className="card min-w-0 p-3 sm:p-4" key={label}>
      <div className="flex items-center justify-between gap-1 text-xs font-semibold text-muted sm:text-sm">{label}<Icon className="hidden shrink-0 text-accent sm:block" size={16} /></div>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted">{detail}</p>
    </div>)}
  </div>;
}

function History({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [interval, setInterval] = useState<Interval>('game');
  const [window, setWindow] = useState(10);
  const [phase, setPhase] = useState<Phase | ''>('');
  const [rating, setRating] = useState(false);
  const points = useMemo(() => trend(rows, interval, window, phase || undefined), [rows, interval, window, phase]);
  return <Section title="Accuracy over time" icon={<ChartNoAxesCombined size={20} />} detail="Game accuracy approximates Chess.com’s score. Phase trends use graded move accuracy. Accuracy alone does not measure playing strength.">
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Group by"><select className="input" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
        <option value="game">Game</option><option value="day">Day</option><option value="week">Week (Monday)</option><option value="month">Month</option></select></Field>
      <Field label={`Rolling window (${interval === 'game' ? 'games' : 'observed periods'})`}><input className="input w-32" type="number" min={1} max={100} value={window} onChange={(e) => setWindow(Math.max(1, Math.min(100, e.target.valueAsNumber || 1)))} /></Field>
      <Field label="Accuracy series"><select className="input" value={phase} onChange={(e) => setPhase(e.target.value as Phase | '')}>
        <option value="">Game accuracy</option>{PHASES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select></Field>
      <label className="flex items-center gap-2 py-3 text-sm text-muted"><input type="checkbox" checked={rating} onChange={(e) => setRating(e.target.checked)} /> Show player rating</label>
    </div>
    <AccuracyChart key={`${interval}:${phase}:${points.length}:${points[0]?.date}:${points.at(-1)?.date}`} points={points} showRating={rating} onReview={onReview} />
  </Section>;
}

const groupers = {
  color: (g: SampleGame) => g.color === 'w' ? 'White' : 'Black',
  time: (g: SampleGame) => titleCase(g.row.game.timeClass),
  result: (g: SampleGame) => titleCase(g.result ?? 'Unknown'),
  rating: (g: SampleGame) => ratingBracket(g.opponentRating),
  length: (g: SampleGame) => gameLength(g.row.plies),
  month: (g: SampleGame) => g.date === undefined ? 'Unknown date' : new Date(g.date).toISOString().slice(0, 7),
};
type Group = keyof typeof groupers;
const groupLabels: Record<Group, string> = { color: 'Color', time: 'Time control', result: 'Result', rating: 'Opponent rating', length: 'Game length', month: 'Month' };
function Breakdown({ rows }: { rows: SampleGame[] }) {
  const [phase, setPhase] = useState<Phase | ''>('');
  const [group, setGroup] = useState<Group | ''>('');
  const groups = group ? [...groupSample(rows, groupers[group])] : [];
  const { totals } = aggregate(rows, phase || undefined);
  return <Section title="Move classifications" icon={<ListChecks size={20} />} detail="Percentages use all classified player moves in this view, including Book and Forced.">
    <div className="mb-4 flex flex-wrap gap-3">
      <Field label="Classification phase"><select className="input" value={phase} onChange={(e) => setPhase(e.target.value as Phase | '')}><option value="">All phases</option>
        {PHASES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select></Field>
      <Field label="Compare classifications by"><select className="input" value={group} onChange={(e) => setGroup(e.target.value as Group | '')}>
        <option value="">No groups</option>{Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    </div>
    {!totals.all ? <Empty>No classified moves in this phase.</Empty> : <>
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-x-8">
        {CLASSIFICATIONS.map((c) => {
          const share = 100 * totals.counts[c] / totals.all;
          return <div className="grid grid-cols-[minmax(6.75rem,auto)_1fr_auto] items-center gap-2 text-sm" key={c}>
            <span className="flex items-center gap-2"><span aria-hidden="true"><ClassificationIcon classification={c} /></span>{CLASSIFICATION_LABEL[c]}</span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${share}%`, background: `var(--color-${c})` }} />
            </div><span className="text-right tabular-nums text-muted">{totals.counts[c].toLocaleString()} · {pct(share)}</span>
          </div>;
        })}
      </div>
      {!!groups.length && <div className="mt-4"><Table headers={['Group', 'Moves', ...CLASSIFICATIONS.map((c) => CLASSIFICATION_LABEL[c])]}>
        {groups.map(([label, sample]) => {
          const { totals } = aggregate(sample, phase || undefined);
          return <tr key={label}><th scope="row">{label}</th><td>{totals.all}</td>{CLASSIFICATIONS.map((c) =>
            <td key={c}>{totals.counts[c]} · {pct(ratio(totals.counts[c] * 100, totals.all))}</td>)}</tr>;
        })}
      </Table></div>}
    </>}
  </Section>;
}

function PhaseTable({ rows }: { rows: SampleGame[] }) {
  return <Section title="Opening, middlegame & endgame" icon={<Layers3 size={20} />} detail="Numeric phase metrics are computed from moves. Book and forced moves are excluded from accuracy, centipawn loss, and blunder rate.">
    <Table headers={['Phase', 'Games reached', 'Graded moves', 'Move accuracy', 'Avg CP loss', 'Blunder rate']}>
      {PHASES.map((p) => {
        const reached = rows.filter((g) => g.side.phases[p]?.all);
        const a = aggregate(reached, p);
        return <tr key={p}><th scope="row">{titleCase(p)}</th><td>{reached.length}</td><td>{a.totals.graded}</td>
          <td>{pct(a.moveAccuracy)}</td><td>{num(a.acpl)}</td><td>{pct(a.blunderPct)}</td></tr>;
      })}
    </Table>
  </Section>;
}

function Conditions({ rows }: { rows: SampleGame[] }) {
  const [group, setGroup] = useState<Group>('color');
  return <Section title="Performance by condition" icon={<Activity size={20} />} detail="Each row uses the current filters. Small or very different samples can make comparisons misleading.">
    <div className="mb-3 w-fit"><Field label="Group games by"><select className="input" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
      {Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
    <Table headers={['Group', 'Games', 'Game accuracy', 'Avg CP loss', 'Blunders / game', 'Win rate']}>
      {[...groupSample(rows, groupers[group])].map(([key, sample]) => {
        const a = aggregate(sample);
        return <tr key={key}><th scope="row">{key}</th><td>{a.n}{a.n < 5 && <small className="ml-1 text-muted">small sample</small>}</td>
          <td>{pct(a.accuracy)}</td><td>{num(a.acpl)}</td><td>{num(a.blunders, 2)}</td><td>{pct(a.winPct)}</td></tr>;
      })}
    </Table>
  </Section>;
}

function Openings({ rows }: { rows: SampleGame[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('games');
  const [min, setMin] = useState(3);
  const [split, setSplit] = useState(true);
  const groups = [...groupSample(rows.filter((g) => g.row.opening), (g) =>
    JSON.stringify([g.row.opening?.eco, g.row.opening?.name, split ? g.color : null]))].map(([, games]) => ({
      opening: games[0].row.opening!, color: games[0].color, a: aggregate(games), openingStats: aggregate(games, 'opening'),
    })).filter(({ opening, a }) => a.n >= min && `${opening.eco ?? ''} ${opening.name}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === 'accuracy' ? (b.a.accuracy ?? -1) - (a.a.accuracy ?? -1) : sort === 'opening' ? (a.openingStats.moveAccuracy ?? 101) - (b.openingStats.moveAccuracy ?? 101)
      : sort === 'wins' ? (b.a.winPct ?? -1) - (a.a.winPct ?? -1) : b.a.n - a.a.n);
  const baseline = aggregate(rows, 'opening').moveAccuracy;
  return <Section title="Opening repertoire" icon={<BookOpen size={20} />} detail="Game outcomes and game accuracy describe the entire game. Opening move accuracy uses only graded opening moves.">
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Search openings"><input className="input" value={query} placeholder="Name or ECO" onChange={(e) => setQuery(e.target.value)} /></Field>
      <Field label="Sort openings"><select className="input" value={sort} onChange={(e) => setSort(e.target.value)}><option value="games">Most games</option>
        <option value="accuracy">Highest game accuracy</option><option value="opening">Lowest opening accuracy</option><option value="wins">Highest win rate</option></select></Field>
      <Field label="Minimum games"><input className="input w-24" type="number" min={1} max={100} value={min} onChange={(e) => setMin(Math.min(100, Math.max(1, e.target.valueAsNumber || 1)))} /></Field>
      <label className="flex items-center gap-2 py-3 text-sm text-muted"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split by color</label>
    </div>
    {!groups.length ? <Empty>No known openings meet the current search and minimum sample.</Empty> : <Table headers={['Opening', 'ECO', 'Color', 'Games', 'W / D / L', 'Game accuracy', 'Opponent accuracy', 'Blunders / game', 'Mistakes / game', 'Opening accuracy', 'Opening moves']}>
      {groups.map(({ opening, color, a, openingStats }) => {
        const review = a.n >= 5 && openingStats.totals.graded >= 20 && baseline !== null
          && openingStats.moveAccuracy !== null && openingStats.moveAccuracy <= baseline - 8;
        return <tr key={JSON.stringify([opening.name, opening.eco, split ? color : null])}>
          <th scope="row">{opening.name}{review && <span className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 text-xs text-[#f1c780]">Worth reviewing</span>}</th>
          <td>{opening.eco ?? '—'}</td><td>{split ? color === 'w' ? 'White' : 'Black' : 'Both'}</td><td>{a.n}</td>
          <td>{[a.wins, a.draws, a.losses].map((n) => pct(ratio(100 * n, a.knownResults))).join(' / ')}</td>
          <td>{pct(a.accuracy)}</td><td>{pct(a.opponentAccuracy)}</td><td>{num(a.blunders, 2)}</td><td>{num(a.mistakes, 2)}</td>
          <td>{pct(openingStats.moveAccuracy)}</td><td>{openingStats.totals.graded}</td>
        </tr>;
      })}
    </Table>}
    <p className="mt-3 text-xs text-muted">Study flags need at least 5 games and 20 graded opening moves, with opening accuracy at least 8 points below the current sample’s opening average.</p>
  </Section>;
}

function Weaknesses({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const ranked = useMemo(() => weaknesses(rows), [rows]);
  const evidenceCount = rows.reduce((n, g) => n + g.side.evidence.length, 0);
  return <Section title="What to practice next" icon={<Crosshair size={20} />} detail={`${rows.length} sampled games · ${evidenceCount} supported positions. Patterns must appear in at least two games to earn a recommendation.`}>
    {!ranked.length ? <Empty>There isn’t enough repeat evidence for a recommendation in this sample. Analyze more games or broaden your filters.</Empty>
      : <div className="grid gap-3">{ranked.map((r, i) => <details className="rounded-lg border border-line bg-bg p-4" key={r.pattern} open={i === 0 ? true : undefined}>
        <summary className="cursor-pointer font-bold">{r.title} <span className="ml-2 text-xs font-medium text-muted">{r.confidence === 'possible' ? 'Possible pattern' : 'Engine-backed'}</span></summary>
        <p className="mt-2 text-sm text-muted">{r.items.length} positions across {r.gameCount} of {rows.length} games · {num(r.average, 3)} mean and {num(r.total, 2)} total modeled points lost</p>
        <p className="mt-3 text-sm">{r.why} {r.drill}</p>
        <ul className="mt-3 max-h-96 space-y-2 overflow-auto">{r.items.map(({ game, evidence }) =>
          <li key={`${game.row.id}:${evidence.ply}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm">
            <div><strong>{evidence.notation}</strong> <span className="text-muted">· {game.row.game.white.name} vs {game.row.game.black.name} · {dateLabel(game.date)}</span>
              <p className="text-xs text-muted">{evidence.detail} · {num(evidence.loss, 3)} modeled points lost</p></div>
            <div className="flex flex-wrap gap-2"><button className="btn btn-ghost border border-line" onClick={() => onReview(game.row, game.color, evidence.ply)}>Review move</button>
              <button className="btn btn-ghost border border-line" onClick={() => onReview(game.row, game.color, evidence.ply, true)}>Retry position</button></div>
          </li>)}</ul>
      </details>)}</div>}
    <p className="mt-3 text-xs text-muted">Modeled points lost compare the played move with Stockfish’s best move. They are a way to prioritize practice and do not predict actual game results. Possible patterns receive less weight in the ranking.</p>
  </Section>;
}

function GameTable({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('date');
  const [page, setPage] = useState(0);
  const shown = useMemo(() => rows.filter((g) => `${g.row.game.white.name} ${g.row.game.black.name} ${g.row.opening?.name ?? ''}`
    .toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => sort === 'accuracy'
    ? (a.side.summary.accuracy ?? Infinity) - (b.side.summary.accuracy ?? Infinity)
    : sort === 'blunders' ? b.side.moves.counts.blunder - a.side.moves.counts.blunder : (b.date ?? 0) - (a.date ?? 0)), [rows, query, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(shown.length / 20) - 1));
  return <Section title="Analyzed games" icon={<ListChecks size={20} />} detail="Open a saved game to see its board, classifications, and Stockfish lines.">
    <div className="mb-4 flex flex-wrap gap-3">
      <Field label="Search analyzed games"><input className="input" placeholder="Player or opening" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></Field>
      <Field label="Sort analyzed games"><select className="input" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
        <option value="date">Newest first</option><option value="accuracy">Lowest accuracy</option><option value="blunders">Most blunders</option></select></Field>
    </div>
    {!shown.length ? <Empty>No games match that search.</Empty> : <Table headers={['Game', 'Date', 'Time control', 'Color / result', 'Game accuracy', 'Opponent accuracy', 'Actual rating', 'Estimated game rating', 'Blunders']}>
      {shown.slice(current * 20, (current + 1) * 20).map((g) => <tr key={g.row.id}>
        <th scope="row"><button className="text-left text-accent-strong underline" onClick={() => onReview(g.row, g.color)}>{g.row.game.white.name} vs {g.row.game.black.name}</button>
          <p className="text-xs font-normal text-muted">{g.row.opening?.name}</p></th>
        <td>{dateLabel(g.date)}</td><td>{titleCase(g.row.game.timeClass)}</td><td>{g.color === 'w' ? 'White' : 'Black'} · {g.result ?? 'unknown'}</td>
        <td>{pct(g.side.summary.accuracy)}</td><td>{pct(g.opponent.summary.accuracy)}</td><td>{g.rating ?? '—'}</td><td>{g.side.estimatedRating ?? '—'}</td>
        <td>{g.side.moves.counts.blunder}</td>
      </tr>)}
    </Table>}
    {shown.length > 20 && <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
      <span>{current * 20 + 1}–{Math.min(shown.length, (current + 1) * 20)} of {shown.length}</span>
      <button className="btn btn-ghost border border-line" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
      <button className="btn btn-ghost border border-line" disabled={(current + 1) * 20 >= shown.length} onClick={() => setPage(current + 1)}>Next</button>
    </div>}
  </Section>;
}
