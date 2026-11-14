import { defaultPieces } from 'react-chessboard';

const pieces = [
  { piece: 'wN', square: 'f5' }, { piece: 'bR', square: 'g8' }, { piece: 'bP', square: 'h6' },
] as const;

export function PageHero({ title, description }: { title: string; description: string }) {
  return (
    <header className="chess-hero">
      <div className="chess-hero-art" aria-hidden="true">
        <div className="chess-hero-board">
          {pieces.map(({ piece, square }) => {
            const Piece = defaultPieces[piece];
            const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
            const rank = Number(square[1]);
            return (
              <div className="chess-hero-piece" key={square}
                style={{ left: `${file * 12.5}%`, top: `${(8 - rank) * 12.5}%` }}>
                {Piece?.()}
              </div>
            );
          })}
        </div>
      </div>
      <div className="chess-hero-copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
