'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { analysisId, analysisSpec, type StoredDetail, type StoredSummary } from '@/lib/analytics/model';
import { summarizeGame } from '@/lib/analytics/metrics';
import { analyticsStore } from '@/lib/analytics/store';
import { buildReview, type ReviewMemo } from '@/lib/analysis/review';
import { loadOpeningBook, type OpeningBook } from '@/lib/analysis/openings';
import type { GameReview } from '@/lib/analysis/types';
import { cacheGet, cacheSet } from '@/lib/cache';
import { analyseGame, type AnalysisStage } from '@/lib/analysis/pipeline';
import { AbortError, EnginePool } from '@/lib/engine/stockfish';
import type { PositionAnalysis } from '@/lib/engine/uci';
import { parseGame, type ParsedGame } from '@/lib/games/pgn';
import type { GameRecord } from '@/lib/games/types';
import { ANALYSIS_VERSION, DEPTH_PRESETS, type AnalysisDepth } from '@/lib/settings';

export const libraryStatusText = {
  saving: 'Saving to player analytics…',
  saved: 'Saved to player analytics',
  error: 'Could not save to player analytics. Reopen this review to try again.',
};
export type LibraryStatus = keyof typeof libraryStatusText;

export type ReviewStatus = 'idle' | 'analyzing' | 'done' | 'error';

export interface ReviewState {
  parsed: ParsedGame | null;
  review: GameReview | null;
  status: ReviewStatus;
  /** 0–1 */
  progress: number;
  error: string | null;
  fromCache: boolean;
  libraryStatus?: LibraryStatus;
  /** Which pass is running: every position, or the deeper check of key moments. */
  stage: AnalysisStage;
}

export interface ReviewSummary {
  white: number | null;
  black: number | null;
}

export const summaryKey = (gameId: string) => `summary:${gameId}`;

/** A few bytes per reviewed game, so the game list can show accuracies. */
function saveSummary(gameId: string, review: GameReview) {
  return cacheSet<ReviewSummary>(summaryKey(gameId), { white: review.white.accuracy, black: review.black.accuracy });
}

/**
 * Parses a game, analyses every position with a pool of Stockfish workers and
 * streams a classified review back as results arrive. Finished reviews are
 * cached in IndexedDB.
 */
export function useGameReview(game: GameRecord | null, depth: AnalysisDepth, runId = 0, saved?: StoredDetail, onLibrarySave?: (row: StoredSummary) => void): ReviewState {
  const poolRef = useRef<EnginePool | null>(null);
  const [state, setState] = useState<Omit<ReviewState, 'parsed'>>({
    review: null,
    status: 'idle',
    progress: 0,
    error: null,
    fromCache: false,
    stage: 'search',
  });

  const parsed = useMemo(() => {
    if (!game) return { game: null, error: null };
    try {
      return { game: parseGame(game.pgn), error: null };
    } catch (err) {
      return { game: null, error: err instanceof Error ? err.message : 'Could not read this game.' };
    }
  }, [game]);

  useEffect(() => () => poolRef.current?.terminate(), []);

  useEffect(() => {
    const parsedGame = parsed.game;
    if (!game || !parsedGame) return;
    const { plies } = parsedGame;

    const controller = new AbortController();
    const fens = [parsed.game.startFen, ...plies.map((p) => p.fenAfter)];
    const key = `${game.id}:${depth}:v${ANALYSIS_VERSION}`;
    const memo: ReviewMemo = new Map();
    let book: OpeningBook = {};
    let bookLoaded = false;

    const saveToLibrary = async (review: GameReview) => {
      if (!onLibrarySave) return;
      setState((state) => ({ ...state, libraryStatus: 'saving' }));
      try {
        if (!bookLoaded) throw new Error('The opening book could not be loaded.');
        const result = summarizeGame(game, parsedGame, review, book, analysisSpec(depth));
        await analyticsStore.finishGame(result);
        onLibrarySave(result.summary);
        if (!controller.signal.aborted) setState((state) => ({ ...state, libraryStatus: 'saved' }));
      } catch (err) {
        console.error('Could not save the individual review to the player library.', err);
        if (!controller.signal.aborted) setState((state) => ({ ...state, libraryStatus: 'error' }));
      }
    };

    const run = async () => {
      setState({ review: null, status: 'analyzing', progress: 0, error: null, fromCache: false, stage: 'search' });
      const stored = runId === 0
        ? saved ?? await analyticsStore.detail(analysisId(game.id, analysisSpec(depth))).catch(() => undefined)
        : undefined;
      if (controller.signal.aborted) return;
      if (stored && stored.game.pgn === game.pgn && stored.game.bookPlies === game.bookPlies
        && stored.positions.length === fens.length && stored.positions.every((p, i) => p.fen === fens[i])) {
        const review = buildReview(plies, stored.positions, stored.book, undefined, game.perspective, game.bookPlies);
        setState({ review, status: 'done', progress: 1, error: null, fromCache: true, stage: 'deep',
          libraryStatus: onLibrarySave ? 'saved' : undefined });
        void saveSummary(game.id, review);
        return;
      }
      try {
        book = await loadOpeningBook(true);
        bookLoaded = true;
      } catch { /* The single-game review can still run without theory. */ }
      if (controller.signal.aborted) return;

      const cached = runId === 0 ? await cacheGet<PositionAnalysis[]>(key) : null;
      if (controller.signal.aborted) return;
      if (cached && cached.length === fens.length && cached.every((p, i) => p?.fen === fens[i])) {
        const review = buildReview(plies, cached, book, undefined, game.perspective, game.bookPlies);
        setState({ review, status: 'done', progress: 1, error: null, fromCache: true, stage: 'deep' });
        void saveSummary(game.id, review);
        void saveToLibrary(review);
        return;
      }

      // Re-render at most a few times per second while results stream in.
      let latest: { positions: (PositionAnalysis | null)[]; progress: number; stage: AnalysisStage } | null = null;
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (controller.signal.aborted || !latest) return;
        const { positions, progress, stage } = latest;
        setState((s) => ({
          ...s,
          review: buildReview(plies, positions, book, memo, game.perspective, game.bookPlies),
          progress,
          stage,
        }));
      };

      poolRef.current ??= new EnginePool();
      const final = await analyseGame({
        plies,
        startFen: parsedGame.startFen,
        pool: poolRef.current,
        preset: DEPTH_PRESETS[depth],
        book,
        perspective: game.perspective,
        bookPlies: game.bookPlies,
        signal: controller.signal,
        onProgress: (positions, progress, stage) => {
          latest = { positions, progress, stage };
          if (!scheduled) {
            scheduled = true;
            setTimeout(flush, 250);
          }
        },
      });
      if (controller.signal.aborted) return;

      latest = null;
      const review = buildReview(plies, final, book, memo, game.perspective, game.bookPlies);
      setState({ review, status: 'done', progress: 1, error: null, fromCache: false, stage: 'deep' });
      if (bookLoaded) void cacheSet(key, final);
      void saveSummary(game.id, review);
      void saveToLibrary(review);
    };

    run().catch((err) => {
      if (err instanceof AbortError || controller.signal.aborted) return;
      console.error(err);
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Analysis failed.',
      }));
    });

    return () => controller.abort();
  }, [game, parsed, depth, runId, saved, onLibrarySave]);

  if (!game || !parsed.game) {
    return { parsed: null, review: null, status: parsed.error ? 'error' : 'idle', progress: 0, error: parsed.error, fromCache: false, stage: 'search' };
  }
  return { parsed: parsed.game, ...state };
}
