import type { GameRecord } from '../../lib/games/types';

export const MATE = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0';
export const QUICK = '1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0';

export function gameFixture(n: number, partial: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `chesscom:00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    source: 'chesscom', pgn: MATE, white: { name: 'Opponent', rating: 1400 }, black: { name: 'TestPlayer', rating: 1300 },
    endTime: Date.UTC(2026, 0, n), timeClass: 'rapid', timeControl: '600', rated: true, result: '1-0',
    ...partial,
  };
}
