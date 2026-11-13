import { fetchGames, type GamePage, type PageOptions } from '@/lib/games/sources';
import { parseGame } from '@/lib/games/pgn';
import { matchesFilters, type Filters } from './filters';
import type { GameRecord } from '@/lib/games/types';
import { completedResult, playerColor, type BatchJob, type GameMeta } from './model';

export const dayStart = (date: string) => date ? Date.parse(`${date}T00:00:00Z`) : undefined;
export const dayEnd = (date: string) => date ? Date.parse(`${date}T23:59:59.999Z`) : undefined;
export const gameDate = (game: GameMeta) => game.startedAt ?? game.endTime;
export const dateLabel = (time?: number) => time === undefined ? 'Unknown date'
  : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(time);

interface HistoryOptions extends PageOptions {
  filters?: Filters;
  limit: number;
  onPage?: (found: number, pages: number) => void;
  onGames?: (games: GameRecord[]) => void;
}

export async function collectHistory(source: BatchJob['source'], username: string, options: HistoryOptions,
  fetchPage: (source: BatchJob['source'], user: string, cursor: string | null, options: PageOptions) => Promise<GamePage> = fetchGames) {
  let cursor: string | null = null;
  let pages = 0;
  const games = new Map<string, GameRecord>();
  const seenCursors = new Set<string>();
  const filters: Filters = { ...options.filters, since: options.since, until: options.until,
    time: options.timeClass, rated: options.rated };
  const snapshot = { ...options, until: options.until ?? Date.now() };
  do {
    const page = await fetchPage(source, username, cursor, {
      ...snapshot, pageSize: Math.max(10, Math.min(100, options.limit - games.size)),
    });
    options.signal?.throwIfAborted();
    for (const game of page.games) {
      if (games.size >= options.limit) break;
      if (game.source !== source) continue;
      const color = playerColor(game, username);
      if (!color) continue;
      const result = completedResult(game, color);
      if (!result) continue;
      const opponentRating = (color === 'w' ? game.black : game.white).rating;
      if (!matchesFilters({ date: gameDate(game), timeClass: game.timeClass, color, result, rated: game.rated, opponentRating },
        filters, () => {
          try { return parseGame(game.pgn).plies.length; }
          catch { return undefined; }
        })) continue;
      if (!games.has(game.id)) games.set(game.id, { ...game, perspective: color });
    }
    if (page.cursor && seenCursors.has(page.cursor)) throw new Error('The source returned the same history page twice.');
    cursor = page.cursor;
    if (cursor) seenCursors.add(cursor);
    options.onPage?.(games.size, ++pages);
    options.onGames?.([...games.values()]);
  } while (cursor && games.size < options.limit);
  return [...games.values()];
}
