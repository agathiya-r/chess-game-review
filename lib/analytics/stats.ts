import { CLASSIFICATIONS } from '@/lib/analysis/types';
import type { Phase } from '@/lib/analysis/phases';
import type { Color, GameResult } from '@/lib/games/types';
import { dateLabel, gameDate } from './history';
import { matchesFilters, type Filters } from './filters';
import { emptyTotals } from './metrics';
import { completedResult, playerColor, specKey, type Evidence, type MoveTotals, type Pattern, type SideMetrics, type StoredSummary } from './model';

export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
export interface SampleGame {
  row: StoredSummary;
  color: Color;
  side: SideMetrics;
  opponent: SideMetrics;
  date?: number;
  result: GameResult | null;
  rating?: number;
  opponentRating?: number;
}
export function sampleFor(rows: StoredSummary[], source: string, username: string, version: string): SampleGame[] {
  const byGame = new Map<string, SampleGame>();
  for (const row of rows) {
    if (row.game.source !== source || specKey(row.spec) !== version) continue;
    const color = playerColor(row.game, username);
    if (!color || (byGame.get(row.game.id)?.row.finishedAt ?? -Infinity) >= row.finishedAt) continue;
    const opponent = color === 'w' ? 'b' : 'w';
    byGame.set(row.game.id, { row, color, side: row.sides[color], opponent: row.sides[opponent],
      date: gameDate(row.game), result: completedResult(row.game, color),
      rating: (color === 'w' ? row.game.white : row.game.black).rating,
      opponentRating: (color === 'w' ? row.game.black : row.game.white).rating });
  }
  return [...byGame.values()].sort((a, b) => (a.date ?? -Infinity) - (b.date ?? -Infinity) || a.row.game.id.localeCompare(b.row.game.id));
}

export function filterSample(rows: SampleGame[], filters: Filters) {
  return rows.filter((game) => matchesFilters({
    ...game, timeClass: game.row.game.timeClass, rated: game.row.game.rated,
  }, filters, () => game.row.plies));
}

export const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
export function mean(values: (number | null | undefined)[]) {
  const known = values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return ratio(known.reduce((a, b) => a + b, 0), known.length);
}
export function sumMoves(rows: (MoveTotals | undefined)[]) {
  const sum = emptyTotals();
  for (const row of rows) {
    if (!row) continue;
    sum.all += row.all;
    sum.graded += row.graded;
    sum.accuracySum += row.accuracySum;
    sum.cpLossSum += row.cpLossSum;
    for (const c of CLASSIFICATIONS) sum.counts[c] += row.counts[c];
  }
  return sum;
}
export function aggregate(rows: SampleGame[], phase?: Phase) {
  const totals = sumMoves(rows.map((g) => phase ? g.side.phases[phase] : g.side.moves));
  const wins = rows.filter((g) => g.result === 'win').length;
  const draws = rows.filter((g) => g.result === 'draw').length;
  const losses = rows.filter((g) => g.result === 'loss').length;
  const knownResults = wins + draws + losses;
  let first = Infinity;
  let last = -Infinity;
  for (const { date } of rows) if (date !== undefined) { first = Math.min(first, date); last = Math.max(last, date); }
  return {
    n: rows.length, knownResults, wins, draws, losses, totals,
    accuracyN: rows.filter((g) => g.side.summary.accuracy != null).length,
    dateRange: first !== Infinity ? [first, last] as const : null,
    accuracy: mean(rows.map((g) => g.side.summary.accuracy)),
    opponentAccuracy: mean(rows.map((g) => g.opponent.summary.accuracy)),
    moveAccuracy: ratio(totals.accuracySum, totals.graded),
    acpl: ratio(totals.cpLossSum, totals.graded),
    bestPct: ratio(100 * totals.counts.best, totals.graded),
    winPct: ratio(100 * wins, knownResults),
    mistakes: ratio(totals.counts.mistake, rows.length),
    blunders: ratio(totals.counts.blunder, rows.length),
    blunderPct: ratio(100 * totals.counts.blunder, totals.graded),
  };
}

export function groupSample(rows: SampleGame[], key: (g: SampleGame) => string) {
  const groups = new Map<string, SampleGame[]>();
  for (const game of rows) {
    const label = key(game);
    const group = groups.get(label) ?? [];
    group.push(game);
    groups.set(label, group);
  }
  return groups;
}

export type Interval = 'game' | 'day' | 'week' | 'month';
function bucket(date: number, interval: Interval) {
  const d = new Date(date);
  if (interval === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (interval === 'month') d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
export function trend(rows: SampleGame[], interval: Interval, window: number, phase?: Phase) {
  const dated = rows.filter((g): g is SampleGame & { date: number } => g.date !== undefined);
  const groups = interval === 'game' ? dated.map((g) => ({ date: g.date, games: [g] }))
    : [...groupSample(dated, (g) => String(bucket(g.date!, interval)))].map(([date, games]) => ({ date: Number(date), games }));
  const width = Math.max(1, Math.trunc(window) || 1);
  // Keep underlying game/move weighting when bucket sizes differ.
  return groups.map(({ date, games }, i) => {
    const rolling = groups.slice(Math.max(0, i - width + 1), i + 1).flatMap((g) => g.games);
    const value = (sample: SampleGame[]) => phase
      ? ratio(sample.reduce((n, g) => n + (g.side.phases[phase]?.accuracySum ?? 0), 0),
        sample.reduce((n, g) => n + (g.side.phases[phase]?.graded ?? 0), 0))
      : mean(sample.map((g) => g.side.summary.accuracy));
    return { date, label: dateLabel(date), games, value: value(games), rolling: value(rolling), rating: mean(games.map((g) => g.rating)) };
  });
}

export const TRAINING: Record<Pattern, { title: string; why: string; drill: string }> = {
  'missed-mate': { title: 'Missed forced mates', why: 'A forced mate ends the game before the defender can recover.',
    drill: 'Retry these positions. List the legal checks first, then calculate every reply until mate.' },
  'allowed-mate': { title: 'Allowed forced mates', why: 'The reply starts a verified mating sequence.',
    drill: 'Before committing to a move, list your opponent’s checks and check whether your king has an escape square.' },
  'missed-fork': { title: 'Missed forks', why: 'The engine line shows a double attack that wins material.',
    drill: 'Retry these moves and mark both targets before checking the answer. Then practice forks with the same piece.' },
  'missed-pin': { title: 'Possible missed pins', why: 'The engine line exploits the piece on the pinned square.',
    drill: 'Replay the line and check whether the pinned piece can move or gain a defender.' },
  'missed-skewer': { title: 'Missed skewers', why: 'A more valuable piece moves and exposes the piece behind it.',
    drill: 'Look for two targets on the same file, rank, or diagonal. Calculate what happens when the first target moves.' },
  'missed-capture': { title: 'Missed winning captures', why: 'A legal capture wins material in the engine’s continuation.',
    drill: 'List all captures before quiet moves and calculate the opponent’s cheapest recapture.' },
  'hung-piece': { title: 'Pieces left en prise', why: 'The engine’s immediate reply wins the piece you moved.',
    drill: 'Use a final safety check: after your intended move, what can your opponent capture for free?' },
  'bad-exchange': { title: 'Costly exchanges', why: 'The capture and immediate recapture leave you down material.',
    drill: 'Count material after the full sequence of recaptures before deciding to trade.' },
  'opening-errors': { title: 'Errors after leaving opening theory', why: 'The engine found substantial drops in these opening positions.',
    drill: 'Replay the position just before each error. Compare your plan with the engine’s line and save the positions you reach often.' },
  'rook-endgame': { title: 'Rook endgame errors', why: 'These losses occurred with one rook per side and no other pieces except kings and pawns.',
    drill: 'Retry the positions, then compare rook activity and the timing of pawn moves in each line.' },
};

export function weaknesses(rows: SampleGame[]) {
  const groups = new Map<Pattern, { game: SampleGame; evidence: Evidence }[]>();
  for (const game of rows) for (const evidence of game.side.evidence) {
    const items = groups.get(evidence.pattern) ?? [];
    items.push({ game, evidence });
    groups.set(evidence.pattern, items);
  }
  return [...groups].map(([pattern, items]) => {
    const gameCount = new Set(items.map((item) => item.game.row.game.id)).size;
    const total = items.reduce((n, item) => n + item.evidence.loss, 0);
    const weighted = items.reduce((n, item) => n + item.evidence.loss * (item.evidence.confidence === 'high' ? 1 : 0.5), 0);
    const confidence = items.every((item) => item.evidence.confidence === 'high') ? 'high' : 'possible';
    return { pattern, items: items.sort((a, b) => b.evidence.loss - a.evidence.loss), gameCount, total,
      average: total / items.length, confidence, rank: weighted * Math.min(1, gameCount / 5), ...TRAINING[pattern] };
  }).filter((g) => g.gameCount >= 2).sort((a, b) => b.rank - a.rank);
}
