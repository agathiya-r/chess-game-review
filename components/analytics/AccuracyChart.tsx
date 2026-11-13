'use client';

import { useEffect, useRef, useState } from 'react';
import type uPlot from 'uplot';
import type { trend } from '@/lib/analytics/stats';
import type { OpenReview } from './shared';
import { Empty, num, pct } from './shared';

type Point = ReturnType<typeof trend>[number];

export function AccuracyChart({ points, showRating, onReview }: { points: Point[]; showRating: boolean; onReview: OpenReview }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);
  const index = Math.max(0, Math.min(active < 0 ? points.length - 1 : active, points.length - 1));
  const selected = points[index];
  useEffect(() => {
    const target = element.current;
    if (!target || !points.some((p) => p.value !== null)) return;
    let mounted = true;
    let resize: ResizeObserver | undefined;
    const dates = points.map((p) => p.date / 1000);
    const withRatings = showRating && points.some((p) => p.rating !== null);
    void import('uplot').then(({ default: UPlot }) => {
      if (!mounted) return;
      chart.current = new UPlot({
        width: Math.max(100, target.clientWidth), height: 244,
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, y: false },
        series: [
          {}, { label: 'Accuracy', stroke: '#80abd9', width: 1.5, points: { show: points.length < 90, size: 5 } },
          { label: 'Rolling mean', stroke: '#95c95d', width: 2, points: { show: false } },
          ...(withRatings ? [{ label: 'Player rating', stroke: '#f1c780', scale: 'rating', width: 1.5, points: { show: false } }] : []),
        ],
        scales: { y: { range: [0, 100] }, ...(withRatings ? { rating: { auto: true } } : {}) },
        axes: [
          { stroke: '#b9b6af', grid: { stroke: '#494642', width: 1 } },
          { stroke: '#b9b6af', values: (_, values) => values.map((n) => `${n}%`), grid: { stroke: '#494642', width: 1 } },
          ...(withRatings ? [{ stroke: '#f1c780', scale: 'rating', side: 1 as const, grid: { show: false }, size: 49 }] : []),
        ],
        tzDate: (ts) => UPlot.tzDate(new Date(ts * 1000), 'UTC'),
        hooks: {
          ready: [(u) => u.over.addEventListener('click', () => {
            if (u.cursor.idx != null && u.cursor.idx >= 0) setActive(u.cursor.idx);
          })],
        },
      }, [dates, points.map((p) => p.value), points.map((p) => p.rolling), ...(withRatings ? [points.map((p) => p.rating)] : [])], target);
      resize = new ResizeObserver(() => chart.current?.setSize({ width: Math.max(100, target.clientWidth), height: 244 }));
      resize.observe(target);
    }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; resize?.disconnect(); chart.current?.destroy(); chart.current = null; };
  }, [points, showRating]);

  if (!selected || !points.some((p) => p.value !== null)) return <Empty>No dated games with an accuracy value for this view.</Empty>;
  return <>
    <div className="mb-2 flex flex-wrap gap-4 text-xs font-semibold text-muted">
      <span className="text-[#80abd9]">● Accuracy</span><span className="text-accent-strong">● Rolling mean</span>
      {showRating && <span className="text-[#f1c780]">● Actual player rating (right axis)</span>}
    </div>
    <div ref={element} className="min-w-0 overflow-hidden" aria-label="Accuracy history chart" role="img" />
    {error && <p role="status" className="text-sm text-muted">The chart could not load. You can still browse the values below.</p>}
    <div className="mt-3 grid gap-3 rounded-lg bg-bg p-3 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost border border-line" disabled={index === 0} onClick={() => setActive(index - 1)} aria-label="Previous data point">‹</button>
        <input aria-label="Select chart data point" className="w-20 accent-accent sm:w-28" type="range" min={0} max={points.length - 1} value={index}
          aria-valuetext={`${selected.label}: ${pct(selected.value)}`} onChange={(e) => setActive(e.target.valueAsNumber)} />
        <button className="btn btn-ghost border border-line" disabled={index === points.length - 1} onClick={() => setActive(index + 1)} aria-label="Next data point">›</button>
      </div>
      <p className="text-sm text-muted"><strong className="text-fg">{selected.label}</strong> · {selected.games.length} {selected.games.length === 1 ? 'game' : 'games'} · {pct(selected.value)} accuracy · {pct(selected.rolling)} rolling mean{showRating && ` · ${num(selected.rating, 0)} rating`}</p>
      {selected.games.length === 1 ? <button className="w-fit text-sm font-semibold text-accent-strong underline sm:col-span-2"
        onClick={() => onReview(selected.games[0].row, selected.games[0].color)}>Open selected game</button>
        : <details className="text-sm sm:col-span-2">
          <summary className="cursor-pointer text-accent-strong">Games in this period</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">{selected.games.map((g) => <li key={g.row.id}><button className="underline" onClick={() => onReview(g.row, g.color)}>
            {g.row.game.white.name} vs {g.row.game.black.name} · {pct(g.side.summary.accuracy)}
          </button></li>)}</ul>
        </details>}
    </div>
  </>;
}
