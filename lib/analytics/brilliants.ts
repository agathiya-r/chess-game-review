import { buildReview } from '@/lib/analysis/review';
import { parseGame, type PlyRecord } from '@/lib/games/pgn';
import type { Color } from '@/lib/games/types';
import type { BrilliantMove, StoredDetail, StoredSummary } from './model';

export function brilliantMove(ply: PlyRecord): BrilliantMove {
  return { ply: ply.index, notation: `${ply.moveNumber}${ply.color === 'w' ? '.' : '…'} ${ply.san}` };
}

export function recoverBrilliantMoves(row: StoredSummary, detail: StoredDetail | undefined, color: Color): BrilliantMove[] {
  if (!detail) throw new Error('Saved game details are missing.');
  const parsed = parseGame(detail.game.pgn);
  const review = buildReview(parsed.plies, detail.positions, detail.book, undefined, color, detail.game.bookPlies);
  const moves: BrilliantMove[] = [];
  for (const ply of parsed.plies) {
    if (ply.color === color && review.moves[ply.index]?.classification === 'brilliant') moves.push(brilliantMove(ply));
  }
  if (moves.length !== row.sides[color].moves.counts.brilliant) {
    throw new Error('Saved move classifications could not be restored.');
  }
  return moves;
}
