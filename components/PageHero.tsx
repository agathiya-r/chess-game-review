import { defaultPieces } from 'react-chessboard';

const arrangements = {
  review: [
    { piece: 'wN', square: 'f5' }, { piece: 'bR', square: 'g8' }, { piece: 'bP', square: 'h6' },
  ],
  dashboard: [
    { piece: 'wN', square: 'f5' }, { piece: 'bQ', square: 'g7' }, { piece: 'bP', square: 'd6' },
  ],
  openings: [
    { piece: 'wB', square: 'c4' }, { piece: 'wN', square: 'f3' }, { piece: 'wP', square: 'e4' }, { piece: 'bP', square: 'e5' },
  ],
  weaknesses: [
    { piece: 'bK', square: 'g8' }, { piece: 'wQ', square: 'h5' }, { piece: 'bP', square: 'g7' },
  ],
} as const;

export function PageHero({ title, description, variant }: {
  title: string;
  description: string;
  variant: keyof typeof arrangements;
}) {
  return (
    <header className="chess-hero" data-variant={variant}>
      <div className="chess-hero-art" aria-hidden="true">
        <div className="chess-hero-board">
          {arrangements[variant].map(({ piece, square }) => {
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
