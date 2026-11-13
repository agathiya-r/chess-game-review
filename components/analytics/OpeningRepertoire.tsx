import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Flag, Gauge, Layers3, Minus, Trophy, X } from 'lucide-react';
import { aggregate, groupSample, ratio, type SampleGame } from '@/lib/analytics/stats';
import { ChessSideIcon } from './ChessSideIcon';
import { Empty, Field, num, pct, Section, StatStrip } from './shared';

const PAGE_SIZE = 16;

export function OpeningRepertoire({ rows }: { rows: SampleGame[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('games');
  const [min, setMin] = useState(3);
  const [split, setSplit] = useState(true);
  const [page, setPage] = useState(0);
  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    const known = rows.filter(({ row }) => row.opening &&
      `${row.opening.eco ?? ''} ${row.opening.name}`.toLowerCase().includes(search));
    return [...groupSample(known, (g) => JSON.stringify([
      g.row.opening?.eco, g.row.opening?.name, split ? g.color : null,
    ]))]
      .filter(([, games]) => games.length >= min)
      .map(([id, games]) => ({
        id, opening: games[0].row.opening!, color: games[0].color,
        stats: aggregate(games), openingStats: aggregate(games, 'opening'),
      }))
      .sort((a, b) => {
        if (sort === 'accuracy') return (b.stats.accuracy ?? -1) - (a.stats.accuracy ?? -1);
        if (sort === 'opening') return (a.openingStats.moveAccuracy ?? 101) - (b.openingStats.moveAccuracy ?? 101);
        if (sort === 'wins') return (b.stats.winPct ?? -1) - (a.stats.winPct ?? -1);
        return b.stats.n - a.stats.n;
      });
  }, [rows, query, split, min, sort]);
  const baseline = useMemo(() => aggregate(rows, 'opening').moveAccuracy, [rows]);
  const current = Math.min(page, Math.max(0, Math.ceil(groups.length / PAGE_SIZE) - 1));

  return (
    <Section title="Opening repertoire" icon={<BookOpen size={20} />}
      detail="Compare your opening moves with the results of the full game.">
      <div className="mb-4 grid grid-cols-2 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto]">
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
      {!groups.length ? <Empty>No openings match this search and minimum game count.</Empty> : (
        <div className="opening-grid">
          {groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(({ id, opening, color, stats, openingStats }) => {
            const study = stats.n >= 5 && openingStats.totals.graded >= 20 && baseline !== null
              && openingStats.moveAccuracy !== null && openingStats.moveAccuracy <= baseline - 8;
            return (
              <details key={id} className="opening-entry">
                <summary className="opening-summary">
                  <span className="opening-identity">
                    <ChessSideIcon color={split ? color : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-bold">{opening.name}</span>
                      <span className="opening-meta">
                        {opening.eco && <span className="opening-eco">{opening.eco}</span>}
                        <span>{split ? color === 'w' ? 'White' : 'Black' : 'Both colors'}</span>
                        <span className="inline-flex items-center gap-1"><Layers3 size={12} aria-hidden="true" />
                          {stats.n.toLocaleString()} {stats.n === 1 ? 'game' : 'games'}
                        </span>
                      </span>
                      {study && <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#e8ca8c]">
                        <Flag size={13} aria-hidden="true" /> Worth reviewing
                      </span>}
                    </span>
                    <ChevronDown size={16} className="analytics-chevron" aria-hidden="true" />
                  </span>
                  <span className="opening-score">
                    <span className="opening-score-label"><Gauge size={15} aria-hidden="true" /> Opening accuracy</span>
                    <strong>{pct(openingStats.moveAccuracy)}</strong>
                  </span>
                  <span className="comparison-track" aria-hidden="true">
                    {openingStats.moveAccuracy !== null && <span style={{ width: `${openingStats.moveAccuracy}%` }} />}
                  </span>
                  <span className="opening-outcomes">
                    <span data-result="win"><Trophy size={14} aria-hidden="true" /> <strong>{stats.wins}</strong> won</span>
                    <span data-result="draw"><Minus size={14} aria-hidden="true" /> <strong>{stats.draws}</strong> drew</span>
                    <span data-result="loss"><X size={14} aria-hidden="true" /> <strong>{stats.losses}</strong> lost</span>
                  </span>
                </summary>
                <div className="opening-details">
                  <StatStrip entries={[
                    ['Graded opening moves', openingStats.totals.graded],
                    ['Win rate', pct(stats.winPct)],
                    ['Draw rate', pct(ratio(stats.draws * 100, stats.knownResults))],
                    ['Loss rate', pct(ratio(stats.losses * 100, stats.knownResults))],
                    ['Game accuracy', pct(stats.accuracy)],
                    ['Opponent accuracy', pct(stats.opponentAccuracy)],
                    ['Blunders per game', num(stats.blunders, 2)],
                    ['Mistakes per game', num(stats.mistakes, 2)],
                  ]} />
                </div>
              </details>
            );
          })}
        </div>
      )}
      {groups.length > PAGE_SIZE && <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
        <span>{current * PAGE_SIZE + 1}–{Math.min(groups.length, (current + 1) * PAGE_SIZE)} of {groups.length}</span>
        <button type="button" className="btn btn-ghost border border-line" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
        <button type="button" className="btn btn-ghost border border-line" disabled={(current + 1) * PAGE_SIZE >= groups.length} onClick={() => setPage(current + 1)}>Next</button>
      </div>}
      {groups.length > 0 && <details className="analytics-explainer">
        <summary>How openings are flagged</summary>
        <p>“Worth reviewing” requires at least five games and 20 graded opening moves, with opening accuracy at least eight points below this sample’s average opening accuracy.</p>
      </details>}
    </Section>
  );
}
