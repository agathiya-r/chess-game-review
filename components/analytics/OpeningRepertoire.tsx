import { useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Flag, Gauge, Layers3, Trophy } from 'lucide-react';
import { lookupOpening } from '@/lib/analysis/openings';
import type { StoredDetail, StoredSummary } from '@/lib/analytics/model';
import { dateLabel } from '@/lib/analytics/history';
import { aggregate, groupSample, ratio, type SampleGame } from '@/lib/analytics/stats';
import { ChessSideIcon } from './ChessSideIcon';
import { SavedPosition, useSavedGame } from './SavedPosition';
import { Empty, Field, num, pct, Section, StatStrip, type OpenReview } from './shared';

const PAGE_SIZE = 16;
type OpeningGroup = ReturnType<typeof collectOpenings>[number];

function collectOpenings(rows: SampleGame[], split: boolean) {
  return [...groupSample(rows.filter((g) => g.row.opening), (g) => JSON.stringify([
    g.row.opening?.eco, g.row.opening?.name, split ? g.color : null,
  ]))].map(([id, games]) => ({
    id,
    opening: games[0].row.opening!,
    color: split ? games[0].color : undefined,
    games,
    stats: aggregate(games),
    openingStats: aggregate(games, 'opening'),
  }));
}

export function OpeningRepertoire({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('games');
  const [min, setMin] = useState(1);
  const [split, setSplit] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const repertoire = useMemo(() => collectOpenings(rows, split), [rows, split]);
  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    return repertoire.filter(({ opening, games }) => games.length >= min &&
      `${opening.eco ?? ''} ${opening.name}`.toLowerCase().includes(search))
      .sort((a, b) => {
        if (sort === 'accuracy') return (b.stats.accuracy ?? -1) - (a.stats.accuracy ?? -1);
        if (sort === 'opening') return (a.openingStats.moveAccuracy ?? 101) - (b.openingStats.moveAccuracy ?? 101);
        if (sort === 'wins') return (b.stats.winPct ?? -1) - (a.stats.winPct ?? -1);
        return b.stats.n - a.stats.n;
      });
  }, [repertoire, query, min, sort]);
  const baseline = useMemo(() => aggregate(rows, 'opening').moveAccuracy, [rows]);
  const current = Math.min(page, Math.max(0, Math.ceil(groups.length / PAGE_SIZE) - 1));
  const visible = groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const selected = visible.find(({ id }) => id === selectedId) ?? visible[0];

  return (
    <Section title="Opening repertoire" icon={<BookOpen size={20} />} className="opening-explorer-section">
      <div className="opening-toolbar">
        <Field label="Search openings">
          <input className="input w-full" type="search" value={query} placeholder="Name or ECO"
            onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
        </Field>
        <Field label="Sort openings">
          <select className="input" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
            <option value="games">Most games</option><option value="accuracy">Highest game accuracy</option>
            <option value="opening">Lowest opening accuracy</option><option value="wins">Highest win rate</option>
          </select>
        </Field>
        <Field label="Minimum games">
          <input className="input w-full" type="number" min={1} max={100} value={min}
            onChange={(e) => { setMin(Math.min(100, Math.max(1, e.target.valueAsNumber || 1))); setPage(0); }} />
        </Field>
        <label className="flex min-h-10 items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); setPage(0); }} />
          Split by color
        </label>
      </div>
      {selected ? (
        <div className="opening-explorer">
          <div className="opening-index">
            <div className="opening-index-mobile">
              <Field label="Choose an opening">
                <select className="input" value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
                  {visible.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.opening.name}{group.color && ` · ${sideLabel(group.color)}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="opening-index-desktop">
              <p className="opening-index-heading">{groups.length.toLocaleString()} {groups.length === 1 ? 'opening' : 'openings'}</p>
              <ul>
                {visible.map((group) => (
                  <li key={group.id}>
                    <button type="button" className="opening-index-row" aria-pressed={group.id === selected.id}
                      onClick={() => setSelectedId(group.id)}>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold">{group.opening.name}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {[group.opening.eco, sideLabel(group.color), `${group.games.length} ${group.games.length === 1 ? 'game' : 'games'}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {groups.length > PAGE_SIZE && (
              <div className="opening-index-pages">
                <span>{current * PAGE_SIZE + 1}–{Math.min(groups.length, (current + 1) * PAGE_SIZE)} of {groups.length}</span>
                <button type="button" className="analytics-action" aria-label="Previous openings" disabled={!current}
                  onClick={() => setPage(current - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
                <button type="button" className="analytics-action" aria-label="Next openings" disabled={(current + 1) * PAGE_SIZE >= groups.length}
                  onClick={() => setPage(current + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
              </div>
            )}
          </div>
          <OpeningFocus key={selected.id} group={selected} baseline={baseline} onReview={onReview} />
        </div>
      ) : <Empty>No openings match this search and minimum game count.</Empty>}
    </Section>
  );
}

function sideLabel(color: OpeningGroup['color']) {
  return color === 'w' ? 'White' : color === 'b' ? 'Black' : 'Both colors';
}

function examplePly(detail: StoredDetail, opening: NonNullable<StoredSummary['opening']>) {
  if (detail.positions.length < 2) return undefined;
  const names = detail.positions.slice(1, 41).map((position) => lookupOpening(detail.book, position.fen));
  const exact = names.findLastIndex((entry) => entry?.name === opening.name && (!opening.eco || entry.eco === opening.eco));
  if (exact >= 0) return exact;
  const byCode = opening.eco ? names.findLastIndex((entry) => entry?.eco === opening.eco) : -1;
  return byCode >= 0 ? byCode : Math.min(5, detail.positions.length - 2);
}

function OpeningFocus({ group, baseline, onReview }: { group: OpeningGroup; baseline: number | null; onReview: OpenReview }) {
  const { opening, color, stats, openingStats } = group;
  const example = group.games.at(-1)!;
  const detail = useSavedGame(example.row.id);
  const ply = detail ? examplePly(detail, opening) : undefined;
  const previewFen = detail === undefined ? undefined
    : ply === undefined ? null : detail?.positions[ply + 1]?.fen ?? null;
  const study = stats.n >= 5 && openingStats.totals.graded >= 20 && baseline !== null
    && openingStats.moveAccuracy !== null && openingStats.moveAccuracy <= baseline - 8;

  return (
    <div className="opening-focus">
      <header className="opening-focus-header">
        <ChessSideIcon color={color} />
        <div className="min-w-0">
          <p className="opening-focus-meta">
            {opening.eco && <span className="opening-eco">{opening.eco}</span>}
            <span>{sideLabel(color)}</span>
            <span className="inline-flex items-center gap-1"><Layers3 size={13} aria-hidden="true" />{stats.n} {stats.n === 1 ? 'game' : 'games'}</span>
          </p>
          <h3>{opening.name}</h3>
        </div>
      </header>
      {study && <p className="opening-study"><Flag size={16} aria-hidden="true" />
        Worth reviewing · Opening accuracy trails your sample average of {pct(baseline)}.
      </p>}
      <div className="opening-focus-body">
        <div className="opening-visual">
          <SavedPosition fen={previewFen} color={example.color} />
          <p className="text-xs leading-relaxed text-muted">Example game · {dateLabel(example.date)}</p>
          <button type="button" className="btn btn-primary opening-review" disabled={!detail} onClick={() => onReview(example.row, example.color, ply)}>
            Review example game <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="opening-numbers">
          <div className="opening-key-metric">
            <span><Gauge size={17} aria-hidden="true" /> Opening accuracy</span>
            <strong>{pct(openingStats.moveAccuracy)}</strong>
            <div className="comparison-track" aria-hidden="true">
              {openingStats.moveAccuracy !== null && <span style={{ width: `${openingStats.moveAccuracy}%` }} />}
            </div>
            <p>{openingStats.totals.graded.toLocaleString()} graded opening moves</p>
          </div>
          <div className="opening-results">
            <h4><Trophy size={15} aria-hidden="true" /> Game results</h4>
            {stats.knownResults > 0 ? <>
              <div className="opening-result-chart" aria-hidden="true">
                {([['win', stats.wins], ['draw', stats.draws], ['loss', stats.losses]] as const).map(([result, count]) => (
                  count > 0 && <span key={result} data-result={result} style={{ flexGrow: count }} />
                ))}
              </div>
              <div className="opening-outcomes">
                {([['win', 'won', stats.wins], ['draw', 'drew', stats.draws], ['loss', 'lost', stats.losses]] as const).map(([result, label, count]) => (
                  <div key={result} data-result={result}>
                    <span><strong>{count}</strong> {label}</span>
                    <span>{pct(ratio(count * 100, stats.knownResults))}</span>
                  </div>
                ))}
              </div>
            </> : <p className="mt-2 text-xs text-muted">No recorded results.</p>}
          </div>
          <details className="analytics-explainer">
            <summary>Full-game statistics</summary>
            <div className="mt-2">
              <StatStrip entries={[
                ['Game accuracy', pct(stats.accuracy)],
                ['Opponent accuracy', pct(stats.opponentAccuracy)],
                ['Blunders per game', num(stats.blunders, 2)],
                ['Mistakes per game', num(stats.mistakes, 2)],
              ]} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
