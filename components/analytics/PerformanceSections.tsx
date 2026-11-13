import { useState } from 'react';
import {
  Activity, CalendarDays, CircleHelp, Clock3, Flag, Gauge, Hourglass, Layers3, ListOrdered, Minus,
  Rocket, Swords, Timer, Trophy, X, Zap, type LucideIcon,
} from 'lucide-react';
import { ChessSideIcon } from './ChessSideIcon';
import { aggregate, groupSample, PHASES, type SampleGame } from '@/lib/analytics/stats';
import { gameLength, ratingBracket } from '@/lib/analytics/filters';
import { Empty, num, pct, Section, StatStrip, titleCase } from './shared';

export const groupers = {
  color: (g: SampleGame) => g.color === 'w' ? 'White' : 'Black',
  time: (g: SampleGame) => titleCase(g.row.game.timeClass),
  result: (g: SampleGame) => titleCase(g.result ?? 'Unknown'),
  rating: (g: SampleGame) => ratingBracket(g.opponentRating),
  length: (g: SampleGame) => gameLength(g.row.plies),
  month: (g: SampleGame) => g.date === undefined ? 'Unknown date' : new Date(g.date).toISOString().slice(0, 7),
};
export type Group = keyof typeof groupers;
export const groupLabels: Record<Group, string> = {
  color: 'Color', time: 'Time control', result: 'Result', rating: 'Opponent rating', length: 'Game length', month: 'Month',
};

const groupIcons: Record<Group, LucideIcon> = {
  color: Layers3, time: Clock3, result: Trophy, rating: Gauge, length: ListOrdered, month: CalendarDays,
};
const timeIcons: Record<string, LucideIcon> = {
  Bullet: Rocket, Blitz: Zap, Rapid: Timer, Classical: Hourglass, Daily: CalendarDays,
};
const resultIcons: Record<string, LucideIcon> = { Win: Trophy, Draw: Minus, Loss: X };

function ConditionIcon({ group, label }: { group: Group; label: string }) {
  if (group === 'color') return <ChessSideIcon color={label === 'White' ? 'w' : 'b'} />;
  const Icon = group === 'time' ? timeIcons[label] ?? CircleHelp
    : group === 'result' ? resultIcons[label] ?? CircleHelp
    : groupIcons[group];
  return <span className="condition-icon" data-result={group === 'result' ? label.toLowerCase() : undefined} aria-hidden="true"><Icon size={17} /></span>;
}

const phaseIcons = { opening: Flag, middlegame: Swords, endgame: Timer };
const phaseTones = { opening: 'green', middlegame: 'gold', endgame: 'blue' };

export function PhasePerformance({ rows }: { rows: SampleGame[] }) {
  return (
    <Section title="Opening, middlegame & endgame" icon={<Layers3 size={20} />}
      detail="Move accuracy, centipawn loss, and blunder rate exclude book and forced moves.">
      <div className="phase-grid">
        {PHASES.map((phase) => {
          const reached = rows.filter((g) => g.side.phases[phase]?.all);
          const { totals, moveAccuracy, acpl, blunderPct } = aggregate(reached, phase);
          const Icon = phaseIcons[phase];

          return (
            <article className="phase-card" data-tone={phaseTones[phase]} key={phase}>
              <h3><Icon size={17} aria-hidden="true" />{titleCase(phase)}</h3>
              <div className="mt-3">
                <p className="phase-accuracy">{pct(moveAccuracy)}</p>
                <p className="text-xs text-muted">Move accuracy</p>
              </div>
              <div className="comparison-track my-3" aria-hidden="true">
                {moveAccuracy !== null && <span style={{ width: `${moveAccuracy}%` }} />}
              </div>
              <StatStrip entries={[
                ['Avg. centipawn loss', num(acpl)],
                ['Blunder rate', pct(blunderPct)],
              ]} />
              <p className="phase-count">{reached.length.toLocaleString()} {reached.length === 1 ? 'game' : 'games'} · {totals.graded.toLocaleString()} graded moves</p>
            </article>
          );
        })}
      </div>
    </Section>
  );
}

export function Conditions({ rows }: { rows: SampleGame[] }) {
  const [group, setGroup] = useState<Group>('color');
  const groups = [...groupSample(rows, groupers[group])];

  return (
    <Section title="Performance by condition" icon={<Activity size={20} />}>
      <div role="group" aria-label="Group games by" className="comparison-options">
        {(Object.keys(groupLabels) as Group[]).map((value) => {
          const Icon = groupIcons[value];
          return (
            <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)}>
              {value === 'color' ? <ChessSideIcon /> : <Icon size={15} aria-hidden="true" />}
              {groupLabels[value]}
            </button>
          );
        })}
      </div>
      {groups.length ? (
        <ul className="analytics-feed">
          {groups.map(([label, sample]) => {
            const a = aggregate(sample);

            return (
              <li className="condition-row" key={label}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <ConditionIcon group={group} label={label} />
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-bold">{label}</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      {a.n.toLocaleString()} {a.n === 1 ? 'game' : 'games'}{a.n < 5 && ' · Small sample'}
                    </p>
                  </div>
                </div>
                <div className="condition-accuracy">
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                    <span>Game accuracy</span><strong className="tabular-nums text-fg">{pct(a.accuracy)}</strong>
                  </div>
                  <div className="comparison-track mt-1.5" aria-hidden="true">
                    {a.accuracy !== null && <span style={{ width: `${a.accuracy}%` }} />}
                  </div>
                </div>
                <StatStrip entries={[
                  ['Win rate', pct(a.winPct)],
                  ['Avg. centipawn loss', num(a.acpl)],
                  ['Blunders per game', num(a.blunders, 2)],
                ]} />
              </li>
            );
          })}
        </ul>
      ) : <Empty>No games to compare.</Empty>}
    </Section>
  );
}
