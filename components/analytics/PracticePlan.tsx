import { useMemo, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Flag,
  GitFork, Pin, ShieldAlert, Swords, Target, type LucideIcon,
} from 'lucide-react';
import { dateLabel } from '@/lib/analytics/history';
import { weaknesses, type SampleGame } from '@/lib/analytics/stats';
import { pliesFromUci } from '@/lib/games/pgn';
import { SavedPosition, useSavedGame } from './SavedPosition';
import { Empty, num, Section, StatStrip, type OpenReview } from './shared';

type Recommendation = ReturnType<typeof weaknesses>[number];
const PAGE_SIZE = 5;

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

function opponentName({ color, row }: SampleGame) {
  return (color === 'w' ? row.game.black : row.game.white).name;
}

export function PracticePlan({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const ranked = useMemo(() => weaknesses(rows), [rows]);
  const [pattern, setPattern] = useState<Recommendation['pattern']>();
  const selected = ranked.find((topic) => topic.pattern === pattern) ?? ranked[0];

  return (
    <Section title="What to practice next" icon={<BookOpen size={20} />} className="practice-workspace">
      {selected ? (
        <div className="practice-notebook">
          <div className="practice-topics">
            <h3>Practice topics</h3>
            <ul aria-label="Practice topics">
              {ranked.map((topic) => {
                const Icon = topicIcons[topic.pattern];
                return (
                  <li key={topic.pattern}>
                    <button type="button" aria-pressed={selected.pattern === topic.pattern}
                      onClick={() => setPattern(topic.pattern)}>
                      <Icon size={15} aria-hidden="true" />
                      <span>{topic.title}</span>
                      <span className="practice-topic-count" aria-label={topic.items.length + ' positions'}>{topic.items.length}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p>{selected.items.length} positions across {selected.gameCount} of {rows.length} games
              {selected.confidence === 'possible' && ' · Possible pattern'}</p>
          </div>
          <PracticePositions key={selected.pattern} topic={selected} onReview={onReview} />
        </div>
      ) : <Empty>Analyze more games or broaden your filters. A pattern needs to appear in at least two games.</Empty>}
    </Section>
  );
}

function PracticePositions({ topic, onReview }: { topic: Recommendation; onReview: OpenReview }) {
  const [selection, setSelection] = useState(0);
  const index = Math.min(selection, topic.items.length - 1);
  const start = Math.floor(index / PAGE_SIZE) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, topic.items.length);
  const item = topic.items[index];

  return (
    <>
      <div className="practice-index">
        <div className="practice-index-heading">
          <h3>Positions from your games</h3><span>Move played</span>
        </div>
        <ul aria-label="Positions from your games">
          {topic.items.slice(start, end).map(({ game, evidence }, offset) => (
            <li key={JSON.stringify([game.row.id, evidence.ply])}>
              <button type="button" aria-pressed={start + offset === index}
                onClick={() => setSelection(start + offset)}>
                <span className="practice-row-game">
                  <strong>vs. {opponentName(game)}</strong>
                  <span>{dateLabel(game.date)} · {game.color === 'w' ? 'White' : 'Black'}</span>
                </span>
                <span className="practice-notation">{evidence.notation}</span>
              </button>
            </li>
          ))}
        </ul>
        {topic.items.length > PAGE_SIZE && (
          <div className="practice-pages" role="group" aria-label="Position list pages">
            <span aria-live="polite">{start + 1}–{end} of {topic.items.length}</span>
            <button type="button" className="analytics-action" aria-label="Previous positions"
              onClick={() => setSelection(start - PAGE_SIZE)} disabled={start === 0}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className="analytics-action" aria-label="More positions"
              onClick={() => setSelection(end)} disabled={end === topic.items.length}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <details className="analytics-explainer">
          <summary>How topics are ranked</summary>
          <p>The ranking weighs points lost, frequency, and confidence. Points lost compare your move with Stockfish’s best move.</p>
        </details>
      </div>
      <PracticePreview key={JSON.stringify([item.game.row.id, item.evidence.ply])} item={item} topic={topic} onReview={onReview} />
    </>
  );
}

function PracticePreview({ item: { game, evidence }, topic, onReview }: {
  item: Recommendation['items'][number];
  topic: Recommendation;
  onReview: OpenReview;
}) {
  const [revealed, setRevealed] = useState(false);
  const detail = useSavedGame(game.row.id);
  const position = detail?.positions[evidence.ply];
  const fen = detail === undefined ? undefined : position?.fen ?? null;
  const best = useMemo(() => {
    const uci = position?.lines[0]?.pv[0];
    return position && uci ? pliesFromUci(position.fen, [uci])[0] : undefined;
  }, [position]);

  return (
    <div className="practice-preview" role="region" aria-label="Selected position">
      <div className="practice-preview-heading">
        <h3>vs. {opponentName(game)}</h3>
        <span>{dateLabel(game.date)}</span>
      </div>
      <p className="practice-turn" aria-live="polite">
        {revealed && best ? `Stockfish’s best move · ${best.san}` : `${game.color === 'w' ? 'White' : 'Black'} to move`}
      </p>
      <SavedPosition fen={revealed && best ? best.fenAfter : fen} color={game.color} lastMove={revealed ? best : undefined} />
      <div className="practice-actions">
        <button type="button" className="practice-start" disabled={!fen}
          onClick={() => onReview(game.row, game.color, evidence.ply, true)}>
          Try this position <ArrowRight size={17} aria-hidden="true" />
        </button>
        {best && (
          <button type="button" className="analytics-action" onClick={() => setRevealed(!revealed)}>
            {revealed ? 'Reset board' : 'Show best move'}
          </button>
        )}
      </div>
      <button type="button" className="practice-review" disabled={!fen} onClick={() => onReview(game.row, game.color, evidence.ply)}>
        Review move <ArrowUpRight size={14} aria-hidden="true" />
      </button>
      <details className="practice-evidence">
        <summary>Why this position? <ChevronDown size={15} className="analytics-chevron" aria-hidden="true" /></summary>
        <div>
          <p>{topic.drill}</p>
          <p>{topic.why}</p>
          <p><strong>{evidence.notation}</strong> · {evidence.detail}</p>
          <StatStrip entries={[
            ['Points lost here', num(evidence.loss, 3)],
            ['Avg. points lost', num(topic.average, 3)],
            ['Total points lost', num(topic.total, 2)],
          ]} />
        </div>
      </details>
    </div>
  );
}
