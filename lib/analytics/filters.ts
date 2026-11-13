import type { Color, GameResult, TimeClass } from '@/lib/games/types';

export interface Filters {
  since?: number;
  until?: number;
  time?: TimeClass;
  color?: Color;
  result?: GameResult;
  rated?: boolean;
  length?: string;
  rating?: string;
}

export const gameLength = (plies: number) => plies <= 40 ? 'Short (≤20)' : plies <= 80 ? 'Medium (21–40)' : 'Long (41+)';
export const ratingBracket = (rating?: number) => rating === undefined ? 'Unknown rating' : rating < 1000 ? 'Below 1000'
  : rating < 1500 ? '1000–1499' : rating < 2000 ? '1500–1999' : rating < 2500 ? '2000–2499' : '2500+';

interface GameFacts {
  date?: number;
  timeClass: TimeClass;
  color: Color;
  result: GameResult | null;
  rated?: boolean;
  opponentRating?: number;
}

export function matchesFilters(game: GameFacts, filters: Filters, plies: () => number | undefined) {
  if (filters.since !== undefined && (game.date === undefined || game.date < filters.since)) return false;
  if (filters.until !== undefined && (game.date === undefined || game.date > filters.until)) return false;
  if (filters.time && game.timeClass !== filters.time) return false;
  if (filters.color && game.color !== filters.color) return false;
  if (filters.result && game.result !== filters.result) return false;
  if (filters.rated !== undefined && game.rated !== filters.rated) return false;
  if (filters.rating && ratingBracket(game.opponentRating) !== filters.rating) return false;
  if (filters.length) {
    const length = plies();
    return length !== undefined && gameLength(length) === filters.length;
  }
  return true;
}
