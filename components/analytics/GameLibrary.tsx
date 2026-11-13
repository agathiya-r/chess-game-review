import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, ListChecks } from 'lucide-react';
import { dateLabel } from '@/lib/analytics/history';
import type { SampleGame } from '@/lib/analytics/stats';
import { Empty, Field, pct, StatStrip, titleCase, type OpenReview } from './shared';

const PAGE_SIZE = 20;

export function GameLibrary({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('date');
  const [page, setPage] = useState(0);
  const shown = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((g) => {
      const { white, black } = g.row.game;
      return `${white.name} ${black.name} ${g.row.opening?.name ?? ''}`.toLowerCase().includes(search);
    }).sort((a, b) => {
      if (sort === 'accuracy') return (a.side.summary.accuracy ?? Infinity) - (b.side.summary.accuracy ?? Infinity);
      if (sort === 'blunders') return b.side.moves.counts.blunder - a.side.moves.counts.blunder;
      return (b.date ?? 0) - (a.date ?? 0);
    });
  }, [rows, query, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(shown.length / PAGE_SIZE) - 1));

  return (
    <details className="card analytics-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="analytics-disclosure-summary">
        <span className="analytics-section-icon" aria-hidden="true"><ListChecks size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold">Analyzed games</span>
          <span className="block text-sm text-muted">{rows.length.toLocaleString()} {rows.length === 1 ? 'game' : 'games'} in this sample</span>
        </span>
        <ChevronDown className="analytics-chevron" size={18} aria-hidden="true" />
      </summary>
      {open && <div className="analytics-disclosure-body">
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Search analyzed games">
            <input className="input w-full" type="search" placeholder="Player or opening" value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
          </Field>
          <Field label="Sort analyzed games">
            <select className="input" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}>
              <option value="date">Newest first</option><option value="accuracy">Lowest accuracy</option><option value="blunders">Most blunders</option>
            </select>
          </Field>
        </div>
        {!shown.length ? <Empty>No games match that search.</Empty> : (
          <ul className="analytics-feed">
            {shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((g) => (
              <GameEntry key={g.row.id} game={g} onReview={onReview} />
            ))}
          </ul>
        )}
        {shown.length > PAGE_SIZE && <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
          <span>{current * PAGE_SIZE + 1}–{Math.min(shown.length, (current + 1) * PAGE_SIZE)} of {shown.length}</span>
          <button type="button" className="btn btn-ghost border border-line" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button>
          <button type="button" className="btn btn-ghost border border-line" disabled={(current + 1) * PAGE_SIZE >= shown.length} onClick={() => setPage(current + 1)}>Next</button>
        </div>}
      </div>}
    </details>
  );
}

function GameEntry({ game, onReview }: { game: SampleGame; onReview: OpenReview }) {
  const { row, color, result, date, side, opponent, rating } = game;
  const { white, black, timeClass } = row.game;
  const rival = color === 'w' ? black.name : white.name;
  const resultLabel = result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : result === 'draw' ? 'Draw' : 'Unknown';

  return (
    <li className="library-entry">
      <div className="library-game">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="game-result" data-result={result ?? 'unknown'}>{resultLabel}</span>
            <span className="break-words text-sm font-bold">vs. {rival}</span>
          </p>
          <p className="mt-1 text-xs text-muted">{dateLabel(date)} · {titleCase(timeClass)} · {color === 'w' ? 'White' : 'Black'}</p>
          {row.opening?.name && <p className="mt-1 text-xs text-muted">{row.opening.name}</p>}
        </div>
        <div className="library-accuracy">
          <strong>{pct(side.summary.accuracy)}</strong>
          <span>Accuracy</span>
        </div>
        <button type="button" className="analytics-action" onClick={() => onReview(row, color)}
          aria-label={`Review game vs ${rival} on ${dateLabel(date)}`}>
          <span className="sr-only sm:not-sr-only">Review</span><ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </div>
      <details className="library-game-details">
        <summary><ChevronDown size={14} className="analytics-chevron" aria-hidden="true" /> Game stats</summary>
        <StatStrip entries={[
          ['Opponent accuracy', pct(opponent.summary.accuracy)],
          ['Actual rating', rating ?? '—'],
          ['Estimated game rating', side.estimatedRating ?? '—'],
          ['Blunders', side.moves.counts.blunder],
        ]} />
      </details>
    </li>
  );
}
