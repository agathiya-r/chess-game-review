import { defaultPieces } from 'react-chessboard';
import type { Color } from '@/lib/games/types';

export function ChessSideIcon({ color }: { color?: Color }) {
  const White = defaultPieces.wN;
  const Black = defaultPieces.bN;

  return (
    <span className="chess-side-icon" aria-hidden="true">
      {color !== 'b' && White?.()}
      {color !== 'w' && Black?.()}
    </span>
  );
}
