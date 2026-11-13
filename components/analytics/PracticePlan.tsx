import { useMemo, useState } from 'react';
import {
  ArrowUpRight, BookOpen, ChevronDown, Crosshair, Flag, GitFork, Lightbulb, ListChecks, Pin,
  RotateCcw, ShieldAlert, Swords, Target, type LucideIcon,
} from 'lucide-react';
import { dateLabel } from '@/lib/analytics/history';
import { weaknesses, type SampleGame } from '@/lib/analytics/stats';
import { Empty, num, Section, StatStrip, type OpenReview } from './shared';

const INITIAL_POSITIONS = 4;
type Recommendation = ReturnType<typeof weaknesses>[number];
const topicIcons: Record<Recommendation['pattern'], LucideIcon> = {
  'missed-mate': Target,
  'allowed-mate': ShieldAlert,
  'missed-fork': GitFork,
  'missed-pin': Pin,
  'missed-skewer': Swords,
  'missed-capture': Crosshair,
  'hung-piece': ShieldAlert,
  'bad-exchange': Swords,
  'opening-errors': BookOpen,
  'rook-endgame': Flag,
};

export function PracticePlan({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const ranked = useMemo(() => weaknesses(rows), [rows]);

  return (
    <Section title="What to practice next" icon={<Crosshair size={20} />}>
      {!ranked.length ? (
        <Empty>Analyze more games or broaden your filters. A pattern needs to appear in at least two games.</Empty>
      ) : (
        <div className="practice-list">
          {ranked.map((recommendation) => (
            <PracticeTopic key={recommendation.pattern} recommendation={recommendation}
              gameCount={rows.length} onReview={onReview} />
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

function PracticeTopic({ recommendation: r, gameCount, onReview }: {
  recommendation: Recommendation;
  gameCount: number;
  onReview: OpenReview;
}) {
  const [visible, setVisible] = useState(INITIAL_POSITIONS);
  const Icon = topicIcons[r.pattern];
  const first = r.items[0];

  return (
    <article className="practice-topic">
      <div className="practice-topic-header">
        <span className="practice-topic-icon" aria-hidden="true"><Icon size={21} /></span>
        <div className="min-w-0">
          <h3 className="text-base font-bold">{r.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {r.items.length} positions across {r.gameCount} of {gameCount} games{r.confidence === 'possible' && ' · Possible pattern'}
          </p>
        </div>
        <button type="button" className="practice-start"
          onClick={() => onReview(first.game.row, first.game.color, first.evidence.ply, true)}>
          <Target size={17} aria-hidden="true" /> Practice position
        </button>
      </div>
      <p className="practice-tip">
        <Lightbulb size={16} aria-hidden="true" />
        <span>{r.drill}</span>
      </p>

      <details className="practice-examples">
        <summary>
          <ListChecks size={16} aria-hidden="true" />
          <span className="flex-1">Review positions <span className="font-normal text-muted">({r.items.length})</span></span>
          <ChevronDown size={16} className="analytics-chevron" aria-hidden="true" />
        </summary>
        <div className="practice-examples-body">
          <ul className="analytics-feed">
            {r.items.slice(0, visible).map(({ game, evidence }) => (
              <li key={`${game.row.id}:${evidence.ply}`} className="practice-position">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="practice-move">{evidence.notation}</strong>
                    <span className="break-words text-xs text-muted">{game.row.game.white.name} vs {game.row.game.black.name}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">{dateLabel(game.date)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{evidence.detail}</p>
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
          <details className="analytics-explainer">
            <summary>Evidence and impact</summary>
            <p>{r.why}</p>
            <div className="mt-2">
              <StatStrip entries={[
                ['Avg. modeled points lost', num(r.average, 3)],
                ['Total modeled points lost', num(r.total, 2)],
              ]} />
            </div>
          </details>
        </div>
      </details>
    </article>
  );
}
