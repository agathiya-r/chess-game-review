'use client';

import { Github, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameList, GameListSkeleton } from '@/components/home/GameList';
import { GameLoader, type LoaderSource, type RecentSearch } from '@/components/home/GameLoader';
import dynamic from 'next/dynamic';
import { useAnalytics } from '@/hooks/useAnalytics';
import type { AnalyticsPage, OpenReview } from '@/components/analytics/shared';
import { ChessIcon } from '@/components/ChessIcon';
import { PageHero } from '@/components/PageHero';
import { ActivePlayer } from '@/components/analytics/ActivePlayer';
import { BulkAnalysisDialog, BulkAnalysisLauncher } from '@/components/analytics/BulkAnalysisDialog';
import { loadProfile, profileColor, PROFILE_KEY, type AnalysisProfile, type PlayerAccount } from '@/lib/analytics/profile';
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
  ['games', 'Games', 'board-find'], ['dashboard', 'Dashboard', 'magnifier-analysis'],
  ['openings', 'Openings', 'explorer'], ['weaknesses', 'Weaknesses', 'training'],
] as const;
type Page = 'games' | AnalyticsPage;
const readPage = (params: URLSearchParams): Page => NAV.find(([id]) => id === params.get('view'))?.[0] ?? 'games';
const readBulkOpen = (params: URLSearchParams) =>
  !params.has('saved') && !params.has('g') && (params.get('bulk') === '1' || params.get('view') === 'bulk');
const emptyAccount: PlayerAccount = { source: 'chesscom', username: '' };
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDefaults, setBulkDefaults] = useState<PlayerAccount>();
  const [profileState, setProfileState] = useState<AnalysisProfile | null>();
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [setupCount, setSetupCount] = useState(0);
  const [libraryOpened, setLibraryOpened] = useState(false);
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

  const restoreLibrary = useCallback(async (params: URLSearchParams) => {
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
      const params = new URLSearchParams(window.location.search);
      const activeUrl = readPage(params) === 'games' && !readBulkOpen(params) && !params.has('saved');
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
    const history = readRecent();
    setRecent(history);
    const localProfile = loadProfile();
    setProfileState(localProfile);
    setProfileReady(true);
    const params = new URLSearchParams(window.location.search);
    const target = readPage(params);
    const src = params.get('src');
    const u = params.get('u');
    const account: PlayerAccount | undefined = (src === 'chesscom' || src === 'lichess') && u
      ? { source: src, username: u } : undefined;
    if (readBulkOpen(params)) {
      setBulkOpen(true);
      setBulkDefaults(account ?? history[0] ?? emptyAccount);
    }
    if (target !== 'games' || params.has('saved')) {
      setPage(target);
      if (target !== 'games') setLibraryOpened(true);
      void restoreLibrary(params);
      return;
    }
    if (account) {
      setSource(account.source);
      setUsername(account.username);
      pendingGameId.current = params.get('g');
      void search(account.source, account.username);
      return;
    }
    // Most visits are "review my latest game": reopen the last player's games.
    const last = localProfile ?? history[0];
    if (last) {
      setSource(last.source);
      setUsername(last.username);
      void search(last.source, last.username);
    }
  }, [search, restoreLibrary]);

  useEffect(() => {
    const syncProfile = (event: StorageEvent) => {
      if (event.key === PROFILE_KEY || event.key === null) setProfileState(loadProfile());
    };
    window.addEventListener('storage', syncProfile);
    return () => window.removeEventListener('storage', syncProfile);
  }, []);

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
      const open = readBulkOpen(params);
      setBulkOpen(open);
      if (open) setBulkDefaults((prev) => prev ?? readRecent()[0] ?? emptyAccount);
      if (target !== 'games') setLibraryOpened(true);
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
    setBulkOpen(false);
    setPage(target);
    if (target !== 'games') setLibraryOpened(true);
    syncUrl(target === 'games' ? (searched ? { src: searched.source, u: searched.username } : {}) : { view: target }, push);
    window.scrollTo({ top: 0 });
  };

  const openBulk = () => {
    const url = new URL(window.location.href);
    if (!readBulkOpen(url.searchParams)) {
      url.searchParams.set('bulk', '1');
      window.history.pushState({ bulkParent: true }, '', url);
    }
    setBulkDefaults((prev) => prev ?? { source: source === 'lichess' ? 'lichess' : 'chesscom', username });
    setBulkOpen(true);
  };

  const closeBulk = () => {
    setBulkOpen(false);
    if (window.history.state?.bulkParent) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('bulk');
    if (url.searchParams.get('view') === 'bulk') url.searchParams.delete('view');
    window.history.replaceState(window.history.state, '', url);
  };

  const openGame = (g: GameRecord) => {
    setLibraryReview(undefined);
    setGame(g);
    window.scrollTo({ top: 0 });
    if (searched && games.some((listed) => listed.id === g.id)) syncUrl({ src: searched.source, u: searched.username, g: g.id }, true);
  };

  const openSaved: OpenReview = (row, color, ply, retry) => {
    const params = { view: page, saved: row.id, side: color,
      ply: ply === undefined ? undefined : String(ply), retry: retry ? '1' : undefined };
    syncUrl(params, true);
    window.history.replaceState({ ...window.history.state, reviewParent: true }, '', window.location.href);
    setBulkOpen(false);
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
      const linkedGame = await fetchLichessGameByUrl(text);
      openGame(linkedGame ?? gameFromPgn(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this PGN.');
    } finally {
      setLoading(false);
    }
  };

  // Existing bulk libraries get their most recent batch's player on first launch.
  const latestBatch = analytics.jobs.reduce<typeof analytics.jobs[number] | undefined>((latest, job) =>
    !latest || job.createdAt > latest.createdAt ? job : latest, undefined);
  const profile = profileState === undefined && latestBatch
    ? { source: latestBatch.source, username: latestBatch.username, depth: latestBatch.spec.depth, filters: {} }
    : profileState ?? null;
  const playerSource = profile?.source;
  const playerName = profile?.username;
  const savedCount = useMemo(() => {
    const player = playerSource && playerName ? { source: playerSource, username: playerName } : null;
    return new Set(analytics.summaries
      .filter(({ game }) => !player || profileColor(player, game))
      .map(({ game }) => game.id)).size;
  }, [analytics.summaries, playerSource, playerName]);
  const ownColor = game && !libraryReview ? profileColor(profile, game) : null;
  const updateProfile = (value: AnalysisProfile | null) => {
    setProfileState(value);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
      setProfileError('');
    } catch {
      setProfileError('Your player settings could not be saved in this browser.');
    }
  };
  const deselect = () => {
    if (analytics.active) analytics.stop('pause');
    updateProfile(null);
    openBulk();
    setBulkDefaults({ source: profile?.source ?? 'chesscom', username: '' });
    setSetupCount((count) => count + 1);
  };

  const updateSettings = (s: Settings) => {
    if (libraryReview) setReviewDepth(s.depth);
    if (ownColor && profile && s.depth !== profile.depth) updateProfile({ ...profile, depth: s.depth, version: undefined });
    const next = libraryReview || ownColor ? { ...s, depth: settings.depth } : s;
    setSettings(next);
    saveSettings(next);
  };

  const reviewGame = useMemo(() => game && ownColor && game.perspective !== ownColor
    ? { ...game, perspective: ownColor } : game, [game, ownColor]);
  const reviewSettings = libraryReview && reviewDepth ? { ...settings, depth: reviewDepth }
    : ownColor && profile ? { ...settings, depth: profile.depth } : settings;

  const openPage = (target: Page) => {
    navigate(target);
    if (target === 'games' && profile && !searched && !loading && source !== 'pgn') {
      setSource(profile.source);
      setUsername(profile.username);
      void search(profile.source, profile.username);
    }
  };

  return (
    <div className="app-shell app-shell-with-rail min-h-dvh">
      <a className="app-skip" href="#main-content">Skip to content</a>
      <header className={cn('app-navigation', game && 'app-navigation-review')}>
        <div className="app-brand-row">
          <button type="button" onClick={() => openPage('games')} className="flex min-h-11 shrink-0 items-center gap-2.5" aria-label="Home">
            <Logo />
            <span className="text-lg font-bold tracking-tight">Game<span className="text-accent">Review</span></span>
          </button>
          <span className="app-engine-status">Stockfish 17</span>
        </div>
        <nav aria-label="Main navigation" className="app-nav-links">
          {NAV.map(([id, label, icon]) => <button key={id} type="button" aria-current={!game && page === id ? 'page' : undefined}
            className="analytics-nav-item" onClick={() => openPage(id)}><ChessIcon name={icon} size={24} />{label}</button>)}
        </nav>
        {!game && <div className="app-profile">
          <BulkAnalysisLauncher analytics={analytics} savedCount={savedCount} open={bulkOpen} onOpen={openBulk} />
          {profileReady && profile && <ActivePlayer profile={profile} onClear={deselect} />}
          {profileError && <p role="alert" className="mt-2 text-xs text-danger">{profileError}</p>}
        </div>}
      </header>

      <main id="main-content" tabIndex={-1} className="app-main min-w-0">
        {(openingReview || reviewError) && <p role={reviewError ? 'alert' : 'status'} className="mx-auto max-w-6xl px-4 pt-4 text-sm text-muted">{reviewError || 'Opening saved review…'}</p>}
        {reviewGame && <ReviewScreen key={libraryReview ? `${libraryReview.row.id}:${reviewGame.perspective}:${libraryReview.ply}:${libraryReview.retry}` : reviewGame.id}
          game={reviewGame} settings={reviewSettings}
          onSettingsChange={updateSettings} onBack={closeGame}
          onLibrarySave={ownColor ? analytics.saved : undefined}
          saved={libraryReview?.detail} initialPly={libraryReview?.ply} initialRetry={libraryReview?.retry} />}
        {libraryOpened && <div className="analytics-wrap" hidden={!!game || page === 'games'}>
          {analytics.ready && profileReady ? <Dashboard rows={analytics.summaries}
            page={page === 'games' ? 'dashboard' : page} profile={profile}
            onProfileChange={updateProfile} onBulk={openBulk} onReview={openSaved} />
            : <p role={analytics.error ? 'alert' : 'status'} className="text-sm text-muted">{analytics.error ?? 'Loading the local library…'}</p>}
        </div>}
        {!game && page === 'games' && (
          <div className={cn('mx-auto w-full max-w-3xl px-4 pb-16', searched ? 'pt-4 sm:pt-8' : 'pt-4 sm:pt-12')}>
            {!searched && <div className="mb-5 sm:mb-7">
              <PageHero title="Review a game"
                description="Find a Chess.com or Lichess game, or review a game from a PGN." />
            </div>}

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
                    <h2 className="text-sm font-semibold text-muted">
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
                !error && <p className="mx-auto flex max-w-prose items-start gap-2 text-sm text-muted">
                  <Lock size={16} className="mt-0.5 shrink-0 text-accent-strong" aria-hidden="true" />
                  Stockfish runs on your device, and saved reviews stay in this browser.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <BulkAnalysisDialog open={bulkOpen && !game} onClose={closeBulk}>
        {bulkDefaults && profileReady && (profileState !== undefined || analytics.ready || analytics.error) ?
          <BulkPanel key={setupCount} analytics={analytics} initialAccount={bulkDefaults} profile={profile}
            onProfileChange={updateProfile} onReview={openSaved}
            onDashboard={() => page === 'dashboard' ? closeBulk() : navigate('dashboard', false)} /> : null}
      </BulkAnalysisDialog>

      <footer
        className={cn(
          'app-footer border-t border-line/70 px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-xs text-subtle',
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
        <div className="mt-3 flex items-center justify-center gap-3 text-sm text-muted">
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
