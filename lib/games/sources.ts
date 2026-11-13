import { gameFromPgn } from './pgn';
import { chessComBookPlies } from './openingUrl';
import type { GameRecord, TimeClass } from './types';

export class SourceError extends Error {}

export interface GamePage {
  games: GameRecord[];
  /** Opaque cursor for the next (older) page, or null when exhausted. */
  cursor: string | null;
}

const PAGE_SIZE = 40;
const LICHESS_CLASSES = {
  bullet: 'ultraBullet,bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence',
};
export interface PageOptions {
  signal?: AbortSignal;
  since?: number;
  until?: number;
  timeClass?: TimeClass;
  rated?: boolean;
  onBackoff?: (seconds: number) => void;
  /** Bulk readers may request one monthly archive or a larger Lichess page. */
  pageSize?: number;
}

// One outstanding archive request per provider, including reading the response.
const queues = new Map<string, Promise<unknown>>();
const cooldown = new Map<string, number>();

function delay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() { clearTimeout(timer); reject(signal?.reason); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function sourceRequest<T>(url: string, read: (response: Response) => Promise<T>, options: PageOptions = {}, init?: RequestInit) {
  const host = new URL(url).hostname;
  const { signal } = options;
  const run = (queues.get(host) ?? Promise.resolve()).catch(() => {}).then(async () => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const wait = (cooldown.get(host) ?? 0) - Date.now();
      if (wait > 0) {
        options.onBackoff?.(Math.ceil(wait / 1000));
        await delay(wait, signal);
        options.onBackoff?.(0);
      }
      let res: Response;
      try {
        res = await fetch(url, { ...init, signal });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (attempt >= 2) throw new SourceError('Network error. Check your connection and try again.');
        await delay(500 * 2 ** attempt, signal);
        continue;
      }
      if (res.ok) return read(res);
      void res.body?.cancel().catch(() => {});
      if (res.status === 404) throw new SourceError('Player not found.');
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
        const date = retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
        cooldown.set(host, Date.now() + Math.max(60_000, seconds, Number.isFinite(date) ? date : 0));
        if (attempt < 2) continue;
        throw new SourceError('Rate limited by the server. Wait a minute before trying again.');
      }
      if (res.status >= 500 && attempt < 2) {
        await delay(500 * 2 ** attempt, signal);
        continue;
      }
      throw new SourceError(`Request failed (${res.status}).`);
    }
  });
  queues.set(host, run);
  try { return await run; } finally { if (queues.get(host) === run) queues.delete(host); }
}

const archiveLists = new Map<string, { urls: string[]; expires: number }>();
async function chessComArchives(user: string, options: PageOptions) {
  const current = archiveLists.get(user);
  if (current && current.expires > Date.now()) return current.urls;
  const { archives = [] } = await sourceRequest(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
    (r) => r.json() as Promise<{ archives?: string[] }>, options,
  );
  const urls = archives.filter((url) => /^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(url)).sort().reverse();
  archiveLists.set(user, { urls, expires: Date.now() + 5 * 60_000 });
  if (archiveLists.size > 32) archiveLists.delete(archiveLists.keys().next().value!);
  return urls;
}

function monthInRange(url: string, { since, until }: PageOptions) {
  const [year, month] = url.split('/').slice(-2).map(Number);
  return (since === undefined || Date.UTC(year, month, 1) > since)
    && (until === undefined || Date.UTC(year, month - 1, 1) <= until);
}

/* ── Chess.com ─────────────────────────────────────────────────────────── */

interface ChessComPlayer {
  username: string;
  rating: number;
  result: string;
}

interface ChessComGame {
  url: string;
  uuid: string;
  pgn?: string;
  time_control: string;
  time_class?: string;
  end_time: number;
  rated: boolean;
  rules: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
  eco?: string;
}

const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient', 'draw']);

function chessComResult(g: ChessComGame): string {
  if (g.white.result === 'win') return '1-0';
  if (g.black.result === 'win') return '0-1';
  if (DRAW_RESULTS.has(g.white.result)) return '1/2-1/2';
  return '*';
}

function chessComOpening(g: ChessComGame): string | undefined {
  const slug = g.eco?.split('/openings/')[1];
  if (!slug) return undefined;
  // "Sicilian-Defense-Najdorf-Variation-6.Be3" → "Sicilian Defense Najdorf Variation"
  // …and "Catalan-Opening...8.O-O-O-O" → "Catalan Opening"
  // The URL drops apostrophes: "Queens Gambit" → "Queen's Gambit".
  return decodeURIComponent(slug)
    .replace(/(-|\.{3})\d+\..*$/, '')
    .replace(/-/g, ' ')
    .replace(/\b(Queen|King|Bishop|Petrov|Alekhine|Bird|Owen|Anderssen)s\b/g, "$1's");
}

function normaliseChessCom(g: ChessComGame, username: string): GameRecord {
  const loser = g.white.result === 'win' ? g.black : g.white;
  return {
    id: `chesscom:${g.uuid}`,
    source: 'chesscom',
    url: g.url,
    pgn: g.pgn ?? '',
    white: { name: g.white.username, rating: g.white.rating },
    black: { name: g.black.username, rating: g.black.rating },
    result: chessComResult(g),
    termination: loser.result,
    endTime: g.end_time * 1000,
    timeControl: g.time_control,
    timeClass: (['bullet', 'blitz', 'rapid', 'daily'].includes(g.time_class ?? '')
      ? g.time_class
      : 'unknown') as TimeClass,
    rated: g.rated,
    opening: chessComOpening(g),
    bookPlies: chessComBookPlies(g.eco),
    perspective: g.black.username.toLowerCase() === username.toLowerCase() ? 'b' : 'w',
  };
}

/**
 * Monthly archives are ordered newest first. The cursor uses the last archive
 * URL so adding a new month cannot shift pages mid-search.
 */
export async function fetchChessComGames(username: string, cursor: string | null, options: PageOptions = {}): Promise<GamePage> {
  const user = username.trim().toLowerCase();
  const months = (await chessComArchives(user, options)).filter((url) => monthInRange(url, options));
  let consumed = cursor ? months.findIndex((url) => url < cursor) : 0;
  if (consumed < 0) return { games: [], cursor: null };
  const games: GameRecord[] = [];
  // Bulk wants individual archive progress, even when filters leave empty months.
  const pageSize = options.pageSize ? 1 : PAGE_SIZE;
  while (consumed < months.length && games.length < pageSize) {
    const { games: raw = [] } = await sourceRequest(months[consumed], (r) => r.json() as Promise<{ games?: ChessComGame[] }>, options);
    consumed++;
    games.push(...raw.filter((g) => g.rules === 'chess' && g.pgn)
      .sort((a, b) => b.end_time - a.end_time)
      .map((g) => normaliseChessCom(g, user)));
    if (options.pageSize) break;
  }
  return { games, cursor: consumed < months.length ? months[consumed - 1] : null };
}

/* ── Lichess ───────────────────────────────────────────────────────────── */

interface LichessPlayer {
  user?: { name: string };
  aiLevel?: number;
  rating?: number;
}

interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  opening?: { eco: string; name: string };
  clock?: { initial: number; increment: number };
  pgn?: string;
}

const lichessName = (p: LichessPlayer) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

function normaliseLichess(g: LichessGame, username?: string): GameRecord {
  const speed = g.speed === 'correspondence' ? 'daily' : g.speed === 'ultraBullet' ? 'bullet' : g.speed;
  const white = lichessName(g.players.white);
  const black = lichessName(g.players.black);
  return {
    id: `lichess:${g.id}`,
    source: 'lichess',
    url: `https://lichess.org/${g.id}`,
    pgn: g.pgn ?? '',
    white: { name: white, rating: g.players.white.rating },
    black: { name: black, rating: g.players.black.rating },
    result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : ['draw', 'stalemate', 'timeout', 'outoftime'].includes(g.status) ? '1/2-1/2' : '*',
    termination: g.status,
    endTime: g.lastMoveAt,
    startedAt: g.createdAt,
    timeControl: g.clock ? `${g.clock.initial}+${g.clock.increment}` : undefined,
    timeClass: (['bullet', 'blitz', 'rapid', 'classical', 'daily'].includes(speed) ? speed : 'unknown') as TimeClass,
    rated: g.rated,
    opening: g.opening?.name,
    eco: g.opening?.eco,
    perspective: username ? (black.toLowerCase() === username.toLowerCase() ? 'b' : 'w') : undefined,
  };
}

/** Lichess streams NDJSON newest first; the cursor is the `until` timestamp. */
export async function fetchLichessGames(username: string, cursor: string | null, options: PageOptions = {}): Promise<GamePage> {
  const user = username.trim();
  const size = options.pageSize ?? PAGE_SIZE;
  const perf = options.timeClass && options.timeClass !== 'unknown' ? LICHESS_CLASSES[options.timeClass] : undefined;
  const params = new URLSearchParams({
    max: String(size), pgnInJson: 'true', opening: 'true', clocks: 'true',
    perfType: perf ?? Object.values(LICHESS_CLASSES).join(','),
    evals: 'false', finished: 'true',
  });
  if (cursor || options.until !== undefined) params.set('until', cursor ?? String(options.until! + 1));
  if (options.since !== undefined) params.set('since', String(options.since));
  if (options.rated !== undefined) params.set('rated', String(options.rated));

  const raw = await sourceRequest(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`,
    async (response) => (await response.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as LichessGame),
    options, { headers: { Accept: 'application/x-ndjson' } });
  const games = raw.filter((g) => g.variant === 'standard' && g.pgn).map((g) => normaliseLichess(g, user));
  const oldest = raw.at(-1)?.createdAt;
  return { games, cursor: raw.length === size && oldest ? String(oldest) : null };
}

/** Load a game with the same provider identity used by the history adapter. */
export async function fetchLichessGameByUrl(input: string): Promise<GameRecord | null> {
  let link: URL;
  try { link = new URL(input.trim()); }
  catch { return null; }
  if (link.hostname !== 'lichess.org' || !['https:', 'http:'].includes(link.protocol)) return null;
  const match = /^\/(?:game\/export\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(link.pathname);
  if (!match) return null;
  try {
    const game = await sourceRequest(
      `https://lichess.org/game/export/${match[1]}?clocks=true&opening=true&pgnInJson=true&evals=false`,
      (response) => response.json() as Promise<LichessGame>, {}, { headers: { Accept: 'application/json' } },
    );
    if (!game.pgn) throw new Error('Missing PGN');
    // Preserve the standalone PGN path for variants. Player analytics uses standard games.
    if (game.variant !== 'standard') return gameFromPgn(game.pgn);
    return normaliseLichess(game);
  } catch (error) {
    if (error instanceof SourceError && error.message.startsWith('Rate limited')) throw error;
    throw new SourceError('Could not load that Lichess game.');
  }
}

export function fetchGames(source: 'chesscom' | 'lichess', username: string, cursor: string | null, options?: PageOptions) {
  return source === 'chesscom' ? fetchChessComGames(username, cursor, options) : fetchLichessGames(username, cursor, options);
}

