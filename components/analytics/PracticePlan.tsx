import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, Crosshair, RotateCcw } from 'lucide-react';
import { dateLabel } from '@/lib/analytics/history';
import { weaknesses, type SampleGame } from '@/lib/analytics/stats';
import { Empty, num, Section, StatStrip, type OpenReview } from './shared';

const INITIAL_POSITIONS = 4;
type Recommendation = ReturnType<typeof weaknesses>[number];

export function PracticePlan({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const ranked = useMemo(() => weaknesses(rows), [rows]);
  const evidenceCount = rows.reduce((count, game) => count + game.side.evidence.length, 0);

  return (
    <Section title="What to practice next" icon={<Crosshair size={20} />}
      detail={`${evidenceCount.toLocaleString()} positions to review across ${rows.length.toLocaleString()} sampled ${rows.length === 1 ? 'game' : 'games'}`}>
      {!ranked.length ? (
        <Empty>Analyze more games or broaden your filters. A pattern needs to appear in at least two games.</Empty>
      ) : (
        <div className="practice-list">
          {ranked.map((recommendation, index) => (
            <PracticeTopic key={recommendation.pattern} recommendation={recommendation}
              gameCount={rows.length} onReview={onReview} initiallyOpen={index === 0} />
          ))}
        </div>
      )}
      {ranked.length > 0 && <details className="analytics-explainer">
        <summary>How practice topics are ranked</summary>
        <p>The order uses modeled points lost, frequency, and confidence. Points lost compare the move played with Stockfish’s best move. Possible patterns receive less weight.</p>
      </details>}
    </Section>
  );
}

function PracticeTopic({ recommendation, gameCount, onReview, initiallyOpen }: {
  recommendation: Recommendation;
  gameCount: number;
  onReview: OpenReview;
  initiallyOpen: boolean;
}) {
  const [visible, setVisible] = useState(INITIAL_POSITIONS);
  const r = recommendation;

  return (
    <details className="practice-topic" open={initiallyOpen || undefined}>
      <summary className="analytics-disclosure-summary">
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{r.title}</span>
          <span className="mt-0.5 block text-xs text-muted">{r.items.length} positions across {r.gameCount} of {gameCount} games</span>
        </span>
        <span className="practice-confidence" data-confidence={r.confidence}>{r.confidence === 'possible' ? 'Possible' : 'Engine-backed'}</span>
        <ChevronDown size={16} className="analytics-chevron" aria-hidden="true" />
      </summary>
      <div className="analytics-disclosure-body">
        <div className="practice-drill">
          <p className="text-xs font-semibold text-accent-strong">Practice drill</p>
          <p className="mt-1 text-sm leading-relaxed text-fg">{r.drill}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{r.why}</p>
        </div>
        <div className="my-3">
          <StatStrip entries={[
            ['Avg. modeled points lost', num(r.average, 3)],
            ['Total modeled points lost', num(r.total, 2)],
          ]} />
        </div>
        <ul className="analytics-feed">
          {r.items.slice(0, visible).map(({ game, evidence }) => (
            <li key={`${game.row.id}:${evidence.ply}`} className="practice-position">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <strong className="practice-move">{evidence.notation}</strong>
                  <span className="break-words text-xs text-muted">{game.row.game.white.name} vs {game.row.game.black.name}</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{evidence.detail}</p>
                <p className="mt-1 text-xs text-muted">{dateLabel(game.date)} · {num(evidence.loss, 3)} modeled points lost</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="analytics-action" onClick={() => onReview(game.row, game.color, evidence.ply)}>
                  Review move <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                <button type="button" className="analytics-action practice-retry" onClick={() => onReview(game.row, game.color, evidence.ply, true)}>
                  Retry position <RotateCcw size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {visible < r.items.length && <button type="button" className="analytics-action mt-3"
          onClick={() => setVisible(visible + INITIAL_POSITIONS)}>
          Show more positions ({Math.min(visible, r.items.length)} of {r.items.length})
        </button>}
      </div>
    </details>
  );
}
