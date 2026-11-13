import { loadOpeningBook, type OpeningBook } from '@/lib/analysis/openings';
import { analyseGame, type AnalysisStage } from '@/lib/analysis/pipeline';
import { buildReview } from '@/lib/analysis/review';
import type { EnginePool } from '@/lib/engine/stockfish';
import { parseGame } from '@/lib/games/pgn';
import type { GameRecord } from '@/lib/games/types';
import { summarizeGame } from './metrics';
import type { AnalysisSpec } from './model';

/** Both entry points call the existing two-pass analyzer and review builder. */
export async function analyzeForLibrary(game: GameRecord, spec: AnalysisSpec, pool: EnginePool, signal?: AbortSignal,
  progress?: (fraction: number, stage: AnalysisStage) => void, openingBook?: OpeningBook) {
  const parsed = parseGame(game.pgn);
  if (!parsed.plies.length) throw new Error('This PGN has no moves to review.');
  const book = openingBook ?? await loadOpeningBook(true);
  const positions = await analyseGame({
    ...parsed, pool, preset: { ...spec, label: '', hint: '' }, book, signal,
    bookPlies: game.bookPlies,
    onProgress: (_, fraction, stage) => progress?.(fraction, stage),
  });
  const review = buildReview(parsed.plies, positions, book, undefined, undefined, game.bookPlies);
  return summarizeGame(game, parsed, review, book, spec);
}
