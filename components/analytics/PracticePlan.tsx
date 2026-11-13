import { useMemo, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Crosshair, Flag, GitFork, Lightbulb,
  Pin, ShieldAlert, Swords, Target, type LucideIcon,
} from 'lucide-react';
import { dateLabel } from '@/lib/analytics/history';
import { weaknesses, type SampleGame } from '@/lib/analytics/stats';
import { SavedPosition, useSavedGame } from './SavedPosition';
import { Empty, num, Section, StatStrip, type OpenReview } from './shared';

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
  const [pattern, setPattern] = useState<Recommendation['pattern']>();
  const selected = ranked.find((item) => item.pattern === pattern) ?? ranked[0];

  return (
    <Section title="What to practice next" icon={<Crosshair size={20} />} className="practice-workspace">
      {selected ? (
        <>
          <PracticeFocus key={selected.pattern} topic={selected} gameCount={rows.length} onReview={onReview} />
          {ranked.length > 1 && <div className="practice-topics">
            <h3>Practice topics</h3>
            <ul>
              {ranked.map((topic) => {
                const Icon = topicIcons[topic.pattern];
                return (
                  <li key={topic.pattern}>
                    <button type="button" aria-pressed={selected.pattern === topic.pattern}
                      onClick={() => setPattern(topic.pattern)}>
                      <Icon size={16} aria-hidden="true" />
                      <span>{topic.title}</span>
                      <span className="practice-topic-count">{topic.items.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>}
          <details className="analytics-explainer">
            <summary>How practice topics are ranked</summary>
            <p>The order uses modeled points lost, frequency, and confidence. Points lost compare the move played with Stockfish’s best move. Possible patterns receive less weight.</p>
          </details>
        </>
      ) : <Empty>Analyze more games or broaden your filters. A pattern needs to appear in at least two games.</Empty>}
    </Section>
  );
}

function PracticeFocus({ topic, gameCount, onReview }: { topic: Recommendation; gameCount: number; onReview: OpenReview }) {
  const [positionIndex, setPositionIndex] = useState(0);
  const index = Math.min(positionIndex, topic.items.length - 1);
  const { game, evidence } = topic.items[index];
  const detail = useSavedGame(game.row.id);
  const fen = detail === undefined ? undefined : detail?.positions[evidence.ply]?.fen ?? null;
  const Icon = topicIcons[topic.pattern];
  const rival = game.color === 'w' ? game.row.game.black.name : game.row.game.white.name;

  return (
    <div className="practice-focus">
      <div className="practice-main">
        <div className="practice-focus-copy">
          <span className="practice-topic-icon" aria-hidden="true"><Icon size={21} /></span>
          <h3>{topic.title}</h3>
          <p className="practice-count">
            {topic.items.length} positions across {topic.gameCount} of {gameCount} games{topic.confidence === 'possible' && ' · Possible pattern'}
          </p>
          <p className="practice-instruction">
            <Lightbulb size={17} aria-hidden="true" /><span>{topic.drill}</span>
          </p>
          <div className="practice-cta">
            <button type="button" className="practice-start" disabled={!detail}
              onClick={() => onReview(game.row, game.color, evidence.ply, true)}>
              Practice position <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="practice-review" disabled={!detail} onClick={() => onReview(game.row, game.color, evidence.ply)}>
              Review move <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="practice-game-caption">vs. {rival} · {dateLabel(game.date)}</p>
        </div>
        <div className="practice-visual">
          <SavedPosition fen={fen} color={game.color} />
          <div className="practice-position-nav" aria-label="Choose a practice position" role="group">
            <button type="button" className="analytics-action" aria-label="Previous position"
              onClick={() => setPositionIndex(index - 1)} disabled={index === 0}>
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
            <span aria-live="polite">Position {index + 1} of {topic.items.length}</span>
            <button type="button" className="analytics-action" aria-label="Next position"
              onClick={() => setPositionIndex(index + 1)} disabled={index + 1 === topic.items.length}>
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <details className="practice-evidence">
        <summary>Why this drill</summary>
        <p>{topic.why}</p>
        <p><strong>{evidence.notation}</strong> · {evidence.detail}</p>
        <StatStrip entries={[
          ['Points lost here', num(evidence.loss, 3)],
          ['Avg. points lost', num(topic.average, 3)],
          ['Total points lost', num(topic.total, 2)],
        ]} />
      </details>
    </div>
  );
}
