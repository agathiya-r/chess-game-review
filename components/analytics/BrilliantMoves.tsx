'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import { recoverBrilliantMoves } from '@/lib/analytics/brilliants';
import { dateLabel } from '@/lib/analytics/history';
import type { BrilliantMove } from '@/lib/analytics/model';
import type { SampleGame } from '@/lib/analytics/stats';
import { analyticsStore } from '@/lib/analytics/store';
import { Empty, Section, titleCase, type OpenReview } from './shared';

const PAGE_SIZE = 12;

export function BrilliantMoves({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [recovery, setRecovery] = useState<{
    candidates: SampleGame[];
    restored: Map<SampleGame, BrilliantMove[]>;
    errors: number;
  }>();
  const [page, setPage] = useState(0);
  const candidates = useMemo(() => rows.filter((game) => game.side.moves.counts.brilliant > 0).reverse(), [rows]);

  useEffect(() => {
    let cancelled = false;
    const readOlderReviews = async () => {
      const restored = new Map<SampleGame, BrilliantMove[]>();
      let errors = 0;
      for (const game of candidates) {
        if (game.side.brilliantMoves) continue;
        try {
          const detail = await analyticsStore.detail(game.row.id);
          if (cancelled) return;
          restored.set(game, recoverBrilliantMoves(game.row, detail, game.color));
        } catch {
          errors++;
        }
      }
      if (!cancelled) setRecovery({ candidates, restored, errors });
    };
    void readOlderReviews();
    return () => { cancelled = true; };
  }, [candidates]);

  const total = candidates.reduce((count, game) => count + game.side.moves.counts.brilliant, 0);
  const resolved = recovery?.candidates === candidates ? recovery : undefined;
  const moves = candidates.flatMap((game) => (game.side.brilliantMoves ?? resolved?.restored.get(game) ?? [])
    .map((move) => ({ game, move })));
  const loading = !resolved && candidates.some((game) => !game.side.brilliantMoves);
  const current = Math.min(page, Math.max(0, Math.ceil(moves.length / PAGE_SIZE) - 1));

  return <Section id="brilliant-moves" title="Brilliant moves" icon={<ClassificationIcon classification="brilliant" size={25} />}
    detail={total ? `${total.toLocaleString()} ${total === 1 ? 'move' : 'moves'} in ${candidates.length.toLocaleString()} ${candidates.length === 1 ? 'game' : 'games'} · Newest games first` : undefined}>
    {total === 0 && <Empty>No brilliant moves in this sample.</Empty>}
    {loading && <p role="status" className="mb-3 text-sm text-muted">Reading older saved reviews…</p>}
    {!!resolved?.errors && <p role="status" className="mb-3 text-sm text-muted">
      Could not read move details for {resolved.errors} {resolved.errors === 1 ? 'saved game' : 'saved games'}.
    </p>}
    {moves.length > 0 && <ul className="brilliant-list">
      {moves.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(({ game, move }) => {
        const { white, black, timeClass } = game.row.game;
        return <li key={`${game.row.id}:${move.ply}`}>
          <button type="button" className="brilliant-row" onClick={() => onReview(game.row, game.color, move.ply)}>
            <span className="brilliant-notation">{move.notation}</span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-semibold text-fg">{white.name} <span className="font-normal text-muted">vs</span> {black.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                <Clock3 size={13} aria-hidden /> {dateLabel(game.date)} · {titleCase(timeClass)} · {game.color === 'w' ? 'White' : 'Black'}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-strong">
              <span className="sr-only sm:not-sr-only">Review move</span><ArrowRight size={17} aria-hidden />
            </span>
          </button>
        </li>;
      })}
    </ul>}
    {moves.length > PAGE_SIZE && <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted">
      <span>{current * PAGE_SIZE + 1}–{Math.min(moves.length, (current + 1) * PAGE_SIZE)} of {moves.length}</span>
      <button className="icon-btn border border-line" type="button" disabled={!current} aria-label="Previous brilliant moves"
        onClick={() => setPage(current - 1)}><ChevronLeft size={17} aria-hidden /></button>
      <button className="icon-btn border border-line" type="button" disabled={(current + 1) * PAGE_SIZE >= moves.length} aria-label="Next brilliant moves"
        onClick={() => setPage(current + 1)}><ChevronRight size={17} aria-hidden /></button>
    </div>}
  </Section>;
}
