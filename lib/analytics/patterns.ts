import { Chess } from 'chess.js';
import { moveIdeas } from '@/lib/analysis/motifs';
import { PIECE_NAME, PIECE_VALUE, materialBalance, staticExchange } from '@/lib/analysis/tactics';
import type { Phase } from '@/lib/analysis/phases';
import type { MoveReview } from '@/lib/analysis/types';
import type { PositionAnalysis } from '@/lib/engine/uci';
import { makePly, pliesFromUci, type PlyRecord } from '@/lib/games/pgn';
import type { Evidence, Pattern } from './model';

const error = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const playUci = (fen: string, uci?: string) => uci
  ? makePly(fen, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  : null;

/** Each position supplies at most one finding. Specific motifs need a legal PV and corroborating material/score. */
export function detectEvidence(
  ply: PlyRecord, move: MoveReview, before: PositionAnalysis, after: PositionAnalysis, phase?: Phase,
): Evidence | null {
  if (!error.has(move.classification) || move.winLoss < 5) return null;
  const main = before.lines[0];
  const played = before.lines.find((line) => line.pv[0] === ply.uci) ?? before.played;
  const best = playUci(ply.fenBefore, main?.pv[0]);
  if (!best || !main || !played || played.pv[0] !== ply.uci || best.uci === ply.uci) return null;
  const reply = after.lines[0];
  const evidence = (pattern: Pattern, confidence: Evidence['confidence'], detail: string): Evidence =>
    ({ pattern, confidence, ply: ply.index, notation: `${ply.moveNumber}${ply.color === 'w' ? '.' : '…'} ${ply.san}`,
      loss: move.winLoss / 100, detail });
  const mate = main.score.mate ?? 0;
  const playedMate = played.score.mate ?? 0;
  const replyMate = reply?.score.mate ?? 0;
  if (mate > 0 && mate <= 4 && playedMate <= 0) {
    const line = pliesFromUci(ply.fenBefore, main.pv.slice(0, 2 * mate - 1));
    if (line.at(-1)?.san.endsWith('#')) return evidence('missed-mate', 'high', `${best.san} starts a mate in ${mate}.`);
  }
  if (replyMate > 0 && replyMate <= 4 && playedMate < 0 && mate >= 0) {
    const line = pliesFromUci(ply.fenAfter, reply.pv.slice(0, 2 * replyMate - 1));
    if (line.at(-1)?.san.endsWith('#')) return evidence('allowed-mate', 'high', `The reply ${line[0].san} starts a mate in ${replyMate}.`);
  }

  const sign = ply.color === 'w' ? 1 : -1;
  const gain = (fen: string) => sign * (materialBalance(fen) - materialBalance(ply.fenBefore));
  const bestLine = pliesFromUci(ply.fenBefore, main.pv.slice(0, 5));
  const playedLine = pliesFromUci(ply.fenBefore, played.pv.slice(0, 5));
  const bestFinal = bestLine.at(-1);
  const actualFinal = playedLine.at(-1);
  if (bestLine.length >= 3 && bestFinal && actualFinal && gain(bestFinal.fenAfter) >= 2
    && gain(bestFinal.fenAfter) - gain(actualFinal.fenAfter) >= 2) {
    const ideas = moveIdeas(ply.fenBefore, best.uci);
    for (const idea of ideas) {
      if (idea.kind === 'fork' && bestLine.slice(2).some((m) => m.color === ply.color
        && m.from === best.to && m.captured && idea.targets.some((target) => target.square === m.to))) {
        return evidence('missed-fork', 'high', `${best.san} forks ${idea.targets.map((t) => PIECE_NAME[t.piece]).join(' and ')}; the engine line wins material.`);
      }
      if (idea.kind === 'skewer' && bestLine[2]?.to === idea.behind.square && bestLine[2].captured) {
        return evidence('missed-skewer', 'high', `${best.san} skewers the ${PIECE_NAME[idea.behind.piece]} on ${idea.behind.square}.`);
      }
      if (idea.kind === 'pin' && bestLine.slice(2).some((m) => m.color === ply.color && m.to === idea.pinned.square && m.captured)) {
        return evidence('missed-pin', 'possible', `${best.san} pins the ${PIECE_NAME[idea.pinned.piece]} on ${idea.pinned.square}; the line captures on that square.`);
      }
    }
    if (best.captured && PIECE_VALUE[best.captured] - staticExchange(best.fenAfter, best.to) >= 2) {
      return evidence('missed-capture', 'high', `${best.san} wins material on ${best.to}.`);
    }
  }

  const punishment = playUci(ply.fenAfter, reply?.pv[0]);
  if (punishment?.captured && actualFinal && gain(actualFinal.fenAfter) <= -2
    && playedLine[1]?.uci === punishment.uci
    && PIECE_VALUE[punishment.captured] - staticExchange(punishment.fenAfter, punishment.to) >= 2) {
    if (!ply.captured && punishment.to === ply.to) {
      return evidence('hung-piece', 'high', `${punishment.san} wins the ${PIECE_NAME[punishment.captured]} just moved to ${ply.to}.`);
    }
    if (ply.captured && punishment.to === ply.to && gain(punishment.fenAfter) <= -2) {
      return evidence('bad-exchange', 'high', `${punishment.san} recaptures on ${ply.to} and wins material.`);
    }
  }

  if (phase === 'endgame' && move.winLoss >= 10) {
    const pieces = new Chess(ply.fenBefore).board().flat().filter((p) => p && p.type !== 'k' && p.type !== 'p');
    if (pieces.length === 2 && pieces.every((p) => p?.type === 'r') && pieces[0]?.color !== pieces[1]?.color) {
      return evidence('rook-endgame', 'high', `One rook per side; ${best.san} preserves more of the engine's evaluation.`);
    }
  }
  if (phase === 'opening' && move.winLoss >= 10) {
    return evidence('opening-errors', 'high', `${best.san} preserves more of the evaluation after leaving book.`);
  }
  return null;
}
