'use client';

import { Cpu, Github, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameList, GameListSkeleton } from '@/components/home/GameList';
import { GameLoader, type LoaderSource, type RecentSearch } from '@/components/home/GameLoader';
import dynamic from 'next/dynamic';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { AnalyticsPage, OpenReview } from '@/components/analytics/shared';
import type { LibraryPreference } from '@/components/analytics/Dashboard';
import type { StoredDetail, StoredSummary } from '@/lib/analytics/model';
import { analyticsStore } from '@/lib/analytics/store';
import { ReviewScreen } from '@/components/review/ReviewScreen';
import { prefetchEngine } from '@/lib/engine/stockfish';
import { gameFromPgn } from '@/lib/games/pgn';
import { SourceError, fetchGames, fetchLichessGameByUrl } from '@/lib/games/sources';
import type { GameRecord } from '@/lib/games/types';
import { cn } from '@/lib/utils';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings';
import { AUTHOR, AUTHOR_URL, REPO_URL } from '@/lib/site';

const BulkPanel = dynamic(() => import('@/components/analytics/BulkPanel').then((m) => m.BulkPanel));
const Dashboard = dynamic(() => import('@/components/analytics/Dashboard').then((m) => m.Dashboard));
const NAV = [
  ['games', 'Games'], ['bulk', 'Bulk Analysis'], ['dashboard', 'Dashboard'], ['openings', 'Openings'], ['weaknesses', 'Weaknesses'],
] as const;
type Page = 'games' | AnalyticsPage;
const readPage = (params: URLSearchParams): Page => NAV.find(([id]) => id === params.get('view'))?.[0] ?? 'games';
type LibraryReview = { row: StoredSummary; detail: StoredDetail; ply?: number; retry?: boolean };

const RECENT_KEY = 'chess-review:recent';

function readRecent(): RecentSearch[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentSearch[];
  } catch {
    return [];
  }
}

function writeRecent(list: RecentSearch[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    // ignore
  }
}

/** Mirror the current search and game in the URL so it can be shared and survives reloads. */
function syncUrl(params: Record<string, string | undefined>, push = false) {
  const url = new URL(window.location.href);
  url.search = '';
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  if (url.href === window.location.href) return;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

export function App() {
  const analytics = useAnalytics();
  const [page, setPage] = useState<Page>('games');
  const [bulkDefaults, setBulkDefaults] = useState<{ source: 'chesscom' | 'lichess'; name: string }>();
  const [libraryOpened, setLibraryOpened] = useState(false);
  const [preference, setPreference] = useState<LibraryPreference>();
  const [libraryReview, setLibraryReview] = useState<LibraryReview>();
  const [reviewError, setReviewError] = useState('');
  const [reviewDepth, setReviewDepth] = useState<Settings['depth']>();
  const [openingReview, setOpeningReview] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<LoaderSource>('chesscom');
  const [username, setUsername] = useState('');
  const [pgnText, setPgnText] = useState('');
  const [searched, setSearched] = useState<{ source: 'chesscom' | 'lichess'; username: string } | null>(null);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameRecord | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  /** Whether the search form is open while a player's games are listed. */
  const [editingSearch, setEditingSearch] = useState(false);
  const pendingGameId = useRef<string | null>(null);
  const requestId = useRef(0);
  const reviewRequest = useRef(0);

  const restoreLibrary = useCallback(async (params: URLSearchParams, initial = false) => {
    const id = params.get('saved');
    const color = params.get('side');
    if (!id || (color !== 'w' && color !== 'b')) return;
    const request = ++reviewRequest.current;
    setOpeningReview(true);
    setReviewError('');
    try {
      const [row, detail] = await Promise.all([analyticsStore.summary(id), analyticsStore.detail(id)]);
      if (request !== reviewRequest.current) return;
      if (!row || !detail) throw new Error('This saved review is not available in this browser.');
      const n = params.get('ply');
      const ply = n !== null && /^\d+$/.test(n) ? Number(n) : undefined;
      if (initial) setPreference({
        source: row.game.source, name: (color === 'w' ? row.game.white : row.game.black).name, depth: row.spec.depth,
      });
      setReviewDepth(row.spec.depth);
      setLibraryReview({ row, detail, ply, retry: params.get('retry') === '1' });
      setGame({ ...detail.game, perspective: color });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (request === reviewRequest.current) setReviewError(err instanceof Error ? err.message : 'Could not open the saved review.');
    } finally {
      if (request === reviewRequest.current) setOpeningReview(false);
    }
  }, []);


  const search = useCallback(async (src: 'chesscom' | 'lichess', name: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setGames([]);
    setCursor(null);
    setSearched({ source: src, username: name });
    setEditingSearch(false);
    try {
      const page = await fetchGames(src, name, null);
      if (id !== requestId.current) return;
      setGames(page.games);
      setCursor(page.cursor);
      if (page.games.length === 0 && !page.cursor) setError('No standard chess games found for this player.');

      const entry = { source: src, username: name };
      setRecent((prev) => {
        const next = [entry, ...prev.filter((r) => !(r.source === src && r.username.toLowerCase() === name.toLowerCase()))];
        writeRecent(next);
        return next.slice(0, 6);
      });

      const wanted = pendingGameId.current;
      pendingGameId.current = null;
      const activeUrl = readPage(new URLSearchParams(window.location.search)) === 'games';
      const match = wanted && activeUrl ? page.games.find((g) => g.id === wanted) : undefined;
      if (match) setGame(match);
      else if (activeUrl) syncUrl({ src, u: name });
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof SourceError ? err.message : 'Something went wrong loading games.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Restore settings, recent searches and any search/game from the URL.
  useEffect(() => {
    // localStorage only exists in the browser, so this can't be initial state
    // without a hydration mismatch on the prerendered page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
    setRecent(readRecent());
    const params = new URLSearchParams(window.location.search);
    const target = readPage(params);
    if (target !== 'games' || params.has('saved')) {
      setPage(target);
      if (target === 'bulk') setBulkDefaults({ source: readRecent()[0]?.source ?? 'chesscom', name: readRecent()[0]?.username ?? '' });
      else setLibraryOpened(true);
      void restoreLibrary(params, true);
      return;
    }
    const src = params.get('src');
    const u = params.get('u');
    if ((src === 'chesscom' || src === 'lichess') && u) {
      setSource(src);
      setUsername(u);
      pendingGameId.current = params.get('g');
      void search(src, u);
      return;
    }
    // Most visits are "review my latest game": reopen the last player's games.
    const last = readRecent()[0];
    if (last) {
      setSource(last.source);
      setUsername(last.username);
      void search(last.source, last.username);
    }
  }, [search, restoreLibrary]);

  // Once games are listed a review is likely next: fetch the engine while idle.
  useEffect(() => {
    if (games.length === 0) return;
    const t = setTimeout(() => void prefetchEngine(), 1500);
    return () => clearTimeout(t);
  }, [games.length]);

  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const target = readPage(params);
      setPage(target);
      if (target === 'bulk') setBulkDefaults((prev) => prev ?? { source: 'chesscom', name: '' });
      if (target !== 'games' && target !== 'bulk') setLibraryOpened(true);
      ++reviewRequest.current;
      setOpeningReview(false);
      setReviewError('');
      setLibraryReview(undefined);
      const wanted = params.get('g');
      setGame(wanted ? games.find((g) => g.id === wanted) ?? null : null);
      if (params.has('saved')) void restoreLibrary(params);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [games, restoreLibrary]);

  const navigate = (target: Page, push = true) => {
    ++reviewRequest.current;
    setOpeningReview(false);
    setReviewError('');
    setLibraryReview(undefined);
    setGame(null);
    setPage(target);
    if (target === 'bulk') setBulkDefaults((prev) => prev ?? { source: source === 'lichess' ? 'lichess' : 'chesscom', name: username });
    if (target !== 'games' && target !== 'bulk') setLibraryOpened(true);
    syncUrl(target === 'games' ? (searched ? { src: searched.source, u: searched.username } : {}) : { view: target }, push);
    window.scrollTo({ top: 0 });
  };

  const openGame = (g: GameRecord) => {
    setLibraryReview(undefined);
    setGame(g);
    window.scrollTo({ top: 0 });
    if (searched && g.source !== 'pgn') syncUrl({ src: searched.source, u: searched.username, g: g.id }, true);
  };

  const openSaved: OpenReview = (row, color, ply, retry) => {
    const params = { view: page, saved: row.id, side: color,
      ply: ply === undefined ? undefined : String(ply), retry: retry ? '1' : undefined };
    syncUrl(params, true);
    window.history.replaceState({ ...window.history.state, reviewParent: true }, '', window.location.href);
    void restoreLibrary(new URLSearchParams(Object.entries(params).filter((kv): kv is [string, string] => kv[1] !== undefined)));
  };

  const closeGame = () => {
    if (libraryReview) {
      const parent = window.history.state?.reviewParent;
      if (parent) window.history.back();
      else navigate(page, false);
      return;
    }
    if (new URLSearchParams(window.location.search).get('g') && window.history.length > 1) window.history.back();
    else syncUrl(searched ? { src: searched.source, u: searched.username } : {});
    setGame(null);
  };

  const loadMore = async () => {
    if (!searched || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchGames(searched.source, searched.username, cursor);
      setGames((prev) => [...prev, ...page.games.filter((g) => !prev.some((p) => p.id === g.id))]);
      setCursor(page.cursor);
    } catch (err) {
      setError(err instanceof SourceError ? err.message : 'Could not load more games.');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadPgn = async (text: string) => {
    setError(null);
    setLoading(true);
    try {
      const pgn = (await fetchLichessGameByUrl(text)) ?? text;
      openGame(gameFromPgn(pgn));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this PGN.');
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = (s: Settings) => {
    if (libraryReview) setReviewDepth(s.depth);
    const next = libraryReview ? { ...s, depth: settings.depth } : s;
    setSettings(next);
    saveSettings(next);
  };

  const latestBatch = analytics.jobs.reduce<typeof analytics.jobs[number] | undefined>((latest, job) =>
    !latest || job.createdAt > latest.createdAt ? job : latest, undefined);
  const libraryDefault = preference ?? (latestBatch ? { source: latestBatch.source, name: latestBatch.username, depth: latestBatch.spec.depth } : undefined);

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={cn('sticky top-0 z-40 border-b border-line/70 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur', game && 'hidden lg:block')}
      >
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-4 px-4 sm:gap-x-6">
          <button type="button" onClick={() => navigate('games')} className="flex h-13 items-center gap-2.5" aria-label="Home">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tight">
              Game<span className="text-accent">Review</span>
            </span>
          </button>
          <span className="ml-auto text-[11px] text-muted sm:order-last lg:text-xs">{analytics.active ? 'Batch analyzing locally' : 'Stockfish 17 · runs locally'}</span>
          <nav aria-label="Main navigation" className="flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map(([id, label]) => <button key={id} type="button" aria-current={!game && page === id ? 'page' : undefined}
              className="analytics-nav-item" onClick={() => navigate(id)}>{label}</button>)}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {(openingReview || reviewError) && <p role={reviewError ? 'alert' : 'status'} className="mx-auto max-w-6xl px-4 pt-4 text-sm text-muted">{reviewError || 'Opening saved review…'}</p>}
        {game && <ReviewScreen key={libraryReview ? `${libraryReview.row.id}:${game.perspective}:${libraryReview.ply}:${libraryReview.retry}` : game.id}
          game={game} settings={libraryReview && reviewDepth ? { ...settings, depth: reviewDepth } : settings}
          onSettingsChange={updateSettings} onBack={closeGame}
          saved={libraryReview?.detail} initialPly={libraryReview?.ply} initialRetry={libraryReview?.retry} />}
        {bulkDefaults && <div className="analytics-wrap" hidden={!!game || page !== 'bulk'}>
          <BulkPanel analytics={analytics} initialSource={bulkDefaults.source} initialName={bulkDefaults.name} onReview={openSaved}
            onDashboard={(source, name, depth) => { setPreference({ source, name, depth }); navigate('dashboard'); }} />
        </div>}
        {libraryOpened && <div className="analytics-wrap" hidden={!!game || page === 'games' || page === 'bulk'}>
          {analytics.ready ? <Dashboard key={preference ? JSON.stringify(preference) : 'default'} rows={analytics.summaries}
            page={page === 'games' || page === 'bulk' ? 'dashboard' : page} preference={libraryDefault}
            onBulk={() => navigate('bulk')} onReview={openSaved} /> : <p role={analytics.error ? 'alert' : 'status'} className="text-sm text-muted">{analytics.error ?? 'Loading the local library…'}</p>}
        </div>}
        {!game && page === 'games' && (
          <div className={cn('mx-auto w-full max-w-3xl px-4 pb-16', searched ? 'pt-4 sm:pt-8' : 'pt-8 sm:pt-16')}>
            {/* The pitch is for first-time visitors; once games are showing, it gets out of the way. */}
            {!searched && (
              // Short on phones so the search box sits high enough to stay above the keyboard.
              <div className="mb-5 text-center sm:mb-8">
                <h1 className="text-[24px] leading-tight font-extrabold tracking-tight sm:text-[44px]">
                  Find out what really happened in your game.
                </h1>
                <p className="mx-auto mt-3 hidden max-w-xl text-[16px] text-muted sm:block">
                  Free move-by-move review of your Chess.com and Lichess games: brilliant moves, blunders, accuracy
                  and the reasons behind them.
                </p>
              </div>
            )}

            <GameLoader
              source={source}
              onSourceChange={(s) => {
                setSource(s);
                setError(null);
              }}
              username={username}
              onUsernameChange={setUsername}
              onSearch={(name) => {
                setUsername(name);
                if (source !== 'pgn') void search(source, name);
              }}
              pgn={pgnText}
              onPgnChange={setPgnText}
              onPgn={loadPgn}
              loading={loading}
              recent={recent}
              collapsed={
                searched && !editingSearch && source !== 'pgn' && !error
                  ? { username: searched.username, source: searched.source, onExpand: () => setEditingSearch(true) }
                  : undefined
              }
              onRemoveRecent={(r) =>
                setRecent((prev) => {
                  const next = prev.filter((x) => !(x.source === r.source && x.username === r.username));
                  writeRecent(next);
                  return next;
                })
              }
            />

            {error && (
              <div role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className={searched ? 'mt-5' : 'mt-8'}>
              {loading && source !== 'pgn' ? (
                <GameListSkeleton />
              ) : (games.length > 0 || cursor) && source !== 'pgn' ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[13px] font-bold tracking-wider text-subtle uppercase">
                      {searched?.username}&apos;s recent games
                    </h2>
                    <button
                      type="button"
                      className="icon-btn -mr-2 size-9"
                      aria-label="Refresh games"
                      onClick={() => searched && void search(searched.source, searched.username)}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <GameList
                    key={`${searched?.source}:${searched?.username}`}
                    games={games}
                    onSelect={openGame}
                    loadingMore={loadingMore}
                    hasMore={!!cursor}
                    onLoadMore={loadMore}
                  />
                </>
              ) : (
                !error && <Features />
              )}
            </div>
          </div>
        )}
      </main>

      <footer
        className={cn(
          'border-t border-line/70 px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-[12px] text-subtle',
          game && 'hidden lg:block',
        )}
      >
        Analysis by{' '}
        <a className="underline hover:text-muted" href="https://stockfishchess.org" target="_blank" rel="noreferrer">
          Stockfish
        </a>{' '}
        (GPLv3), running locally. Opening names from the{' '}
        <a className="underline hover:text-muted" href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">
          Lichess openings
        </a>{' '}
        dataset. Not affiliated with Chess.com or Lichess.
        <div className="mt-3 flex items-center justify-center gap-3 text-[13px] text-muted">
          <a className="inline-flex items-center gap-1.5 hover:text-fg" href={AUTHOR_URL} target="_blank" rel="noreferrer">
            <Github size={15} /> Made by @{AUTHOR}
          </a>
          <span aria-hidden>·</span>
          <a className="underline hover:text-fg" href={REPO_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
        </div>
      </footer>
    </div>
  );
}

function Features() {
  const items = [
    { icon: Sparkles, title: 'Real explanations', text: 'Not just "?? Blunder" — see the fork, the hanging piece or the mate you missed.' },
    { icon: Cpu, title: 'Fast, parallel engine', text: 'Stockfish 17 runs on several cores at once. Reviews take seconds, not minutes.' },
    { icon: Lock, title: 'Private', text: 'Analysis and saved results stay in your browser. No account or uploads.' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="card p-4">
          <Icon size={20} className="text-accent" />
          <p className="mt-2 text-[14px] font-semibold">{title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
        </div>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#81b64c" />
      <path
        fill="#fff"
        d="M16 6a3.5 3.5 0 0 0-2 6.37V13h-2.5a1 1 0 0 0 0 2H13l-1.6 7h9.2L19 15h1.5a1 1 0 0 0 0-2H18v-.63A3.5 3.5 0 0 0 16 6Zm-6 18a1 1 0 0 0-1 1v1h14v-1a1 1 0 0 0-1-1H10Z"
      />
    </svg>
  );
}
