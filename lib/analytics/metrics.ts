import { epd, type OpeningBook } from '@/lib/analysis/openings';
import { gameRating } from '@/lib/analysis/rating';
import { CLASSIFICATIONS, type GameReview } from '@/lib/analysis/types';
import type { PositionAnalysis } from '@/lib/engine/uci';
import type { ParsedGame } from '@/lib/games/pgn';
import type { Color, GameRecord } from '@/lib/games/types';
import { analysisId, type AnalysisResult, type AnalysisSpec, type MoveTotals, type SideMetrics } from './model';
import { detectEvidence } from './patterns';

export function emptyTotals(): MoveTotals {
  return {
    all: 0, graded: 0, accuracySum: 0, cpLossSum: 0,
    counts: Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as MoveTotals['counts'],
  };
}

export function summarizeGame(
  game: GameRecord, parsed: ParsedGame, review: GameReview, book: OpeningBook, spec: AnalysisSpec,
): AnalysisResult {
  if (!parsed.plies.length) throw new Error('This PGN has no moves to review.');
  if (!review.complete || review.positions.length !== parsed.plies.length + 1
    || review.moves.length !== parsed.plies.length || review.moves.some((move) => !move)) {
    throw new Error('Stockfish did not finish every position.');
  }
  const id = analysisId(game.id, spec);
  const sideMetrics = (color: Color): SideMetrics => {
    const summary = color === 'w' ? review.white : review.black;
    const player = color === 'w' ? game.white : game.black;
    return { summary, moves: emptyTotals(), phases: {}, evidence: [],
      estimatedRating: gameRating(summary.accuracy, player.rating, game.timeClass,
        Object.values(summary.counts).reduce((a, b) => a + b, 0)) };
  };
  const sides = { w: sideMetrics('w'), b: sideMetrics('b') };

  for (const ply of parsed.plies) {
    const { index, color } = ply;
    const move = review.moves[index]!;
    const phase = review.phases.find((p) => p.from <= index && p.to >= index)?.phase;
    const side = sides[color];
    const totals = phase ? [side.moves, side.phases[phase] ??= emptyTotals()] : [side.moves];
    for (const row of totals) {
      row.all++;
      row.counts[move.classification]++;
      if (move.classification === 'book' || move.classification === 'forced') continue;
      row.graded++;
      row.accuracySum += move.accuracy;
      row.cpLossSum += move.cpLoss;
    }
    const evidence = detectEvidence(ply, move, review.positions[index]!, review.positions[index + 1]!, phase);
    if (evidence) side.evidence.push(evidence);
  }

  const localBook: OpeningBook = {};
  for (const ply of parsed.plies) {
    const key = epd(ply.fenAfter);
    if (book[key]) localBook[key] = book[key];
  }
  const { pgn, perspective, ...metadata } = game;
  const name = game.opening ?? parsed.headers.Opening ?? review.opening?.name;
  const eco = game.eco ?? parsed.headers.ECO ?? review.opening?.eco;
  return {
    summary: {
      id, game: metadata, spec, finishedAt: Date.now(), plies: parsed.plies.length,
      keyMoments: review.keyMoments, sides, opening: name || eco ? { name: name ?? eco!, eco } : undefined,
    },
    detail: { id, game: { ...metadata, pgn, ...(perspective ? { perspective } : {}) },
      positions: review.positions as PositionAnalysis[], book: localBook },
  };
}
