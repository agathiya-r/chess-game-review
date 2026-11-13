import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyseGame } from '@/lib/analysis/pipeline';
import { buildReview } from '@/lib/analysis/review';
import type { OpeningBook } from '@/lib/analysis/openings';
import { analyzeForLibrary } from '@/lib/analytics/analyze';
import { collectHistory, dayEnd, dayStart } from '@/lib/analytics/history';
import { BatchRunner, createBatch } from '@/lib/analytics/jobs';
import { emptyTotals, summarizeGame } from '@/lib/analytics/metrics';
import { analysisId, analysisSpec, specKey, type StoredSummary } from '@/lib/analytics/model';
import { aggregate, filterSample, sampleFor, trend, weaknesses } from '@/lib/analytics/stats';
import { createAnalyticsStore, StorageError } from '@/lib/analytics/store';
import { readTransferLine, serializeAnalysis } from '@/lib/analytics/transfer';
import { EnginePool } from '@/lib/engine/stockfish';
import { fetchChessComGames, fetchLichessGames } from '@/lib/games/sources';
import { parseGame } from '@/lib/games/pgn';
import { ANALYSIS_VERSION, DEPTH_PRESETS } from '@/lib/settings';
import { gameFixture, MATE, QUICK } from './fixtures/analytics';
import { nodeEngine } from './helpers/node-engine';

const spec = analysisSpec('fast');
const book = JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningBook;
const isolated = () => createAnalyticsStore(crypto.randomUUID());
const pool = () => new EnginePool(2, nodeEngine);
const options = () => ({ update: vi.fn(), progress: vi.fn(), saved: vi.fn() });
afterEach(() => vi.restoreAllMocks());

describe('analytics with the production Stockfish build', () => {
  it('uses the same scores and classifications as single review, reopens from compact details, and round-trips CLI JSONL', async () => {
    const engine = pool();
    try {
      const game = gameFixture(1);
      const result = await analyzeForLibrary(game, spec, engine, undefined, undefined, book);
      const parsed = parseGame(MATE);
      const positions = await analyseGame({ ...parsed, pool: engine, preset: DEPTH_PRESETS.fast, book, perspective: 'b' });
      const direct = buildReview(parsed.plies, positions, book, undefined, 'b');
      const reopened = buildReview(parsed.plies, result.detail.positions, result.detail.book, undefined, 'b');
      expect(reopened).toEqual(direct);
      expect(result.summary.sides.b.summary).toEqual(direct.black);
      expect(result.summary.sides.w.summary).toEqual(direct.white);
      expect(result.summary.sides.b.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ pattern: 'allowed-mate', confidence: 'high', ply: 5 }),
      ]));
      expect(result.summary.sides.w.phases.endgame).toBeUndefined();
      const imported = readTransferLine(serializeAnalysis(result), book);
      expect(imported.detail.positions).toEqual(result.detail.positions);
      expect(imported.summary.sides).toEqual(result.summary.sides);
      expect(() => readTransferLine(serializeAnalysis(result).replace(`"algorithm":${ANALYSIS_VERSION}`, '"algorithm":-1'), book)).toThrow(/incompatible/);
      const invalid = JSON.parse(serializeAnalysis(result));
      invalid.positions[0].fen = 'different';
      expect(() => readTransferLine(JSON.stringify(invalid), book)).toThrow(/do not match/);
      expect(() => summarizeGame(game, parsed, { ...direct, complete: false }, book, spec)).toThrow(/did not finish/);
    } finally { engine.terminate(); }
  }, 20_000);

  it('does not turn an unsupported engine variation into a named tactical finding', async () => {
    const engine = pool();
    try {
      const game = gameFixture(1);
      const result = await analyzeForLibrary(game, spec, engine, undefined, undefined, book);
      const parsed = parseGame(MATE);
      const positions = structuredClone(result.detail.positions);
      positions[6].lines[0].pv = ['h5f5']; // Legal, but not checkmate.
      const review = buildReview(parsed.plies, positions, book);
      const rebuilt = summarizeGame(game, parsed, review, book, spec);
      expect(rebuilt.summary.sides.b.evidence.some((e) => e.pattern === 'allowed-mate')).toBe(false);
    } finally { engine.terminate(); }
  }, 20_000);
});

describe('durable batches', () => {
  it('recovers unfinished work after reopening, skips compatible results, handles a failed game and preserves both presets', async () => {
    const name = crypto.randomUUID();
    const store = createAnalyticsStore(name);
    const games = [gameFixture(1, { pgn: QUICK }), gameFixture(2, { pgn: 'unreadable' }), gameFixture(3, { pgn: QUICK })];
    const job = await createBatch([...games, games[0]], 'chesscom', 'testplayer', 'fast', 2, store);
    expect(job.items).toHaveLength(3);
    const runner = new BatchRunner(store, (g, s, p, signal, progress) => analyzeForLibrary(g, s, p, signal, progress, book), pool);
    const first = options();
    first.saved.mockImplementation(() => runner.stop('pause'));
    await runner.run(job.id, first);
    expect(await store.job(job.id)).toMatchObject({ status: 'paused', items: [
      { status: 'done' }, { status: 'pending' }, { status: 'pending' },
    ] });
    await store.close();

    const reopened = createAnalyticsStore(name);
    const interrupted = (await reopened.job(job.id))!;
    // A closed tab may leave a job marked running in its last committed state.
    await reopened.writeJob({ ...interrupted, status: 'running' });
    const analyze = vi.fn<typeof analyzeForLibrary>((g, settings, p, signal, progress) =>
      analyzeForLibrary(g, settings, p, signal, progress, book));
    const resumed = new BatchRunner(reopened, analyze, pool);
    await resumed.run(job.id, options());
    expect(await reopened.job(job.id)).toMatchObject({ status: 'finished', items: [
      { status: 'done' }, { status: 'failed', error: expect.any(String) }, { status: 'done' },
    ] });
    expect(analyze.mock.calls.map(([g]) => g.id)).toEqual([games[1].id, games[2].id]);
    expect(await reopened.summaries()).toHaveLength(2);

    const duplicate = await createBatch([games[0]], 'chesscom', 'TestPlayer', 'fast', 1, reopened);
    await resumed.run(duplicate.id, options());
    expect((await reopened.job(duplicate.id))?.items[0].status).toBe('reused');
    expect(analyze).toHaveBeenCalledTimes(2);

    const incompatible = await createBatch([games[0]], 'chesscom', 'TestPlayer', 'fast', 1, reopened);
    await reopened.writeJob({ ...incompatible, spec: { ...spec, algorithm: -1 } });
    await expect(resumed.run(incompatible.id, options())).rejects.toThrow(/older analyzer/);
    const deeper = await createBatch([games[0]], 'chesscom', 'TestPlayer', 'standard', 1, reopened);
    await resumed.run(deeper.id, options());
    expect(await reopened.detail(analysisId(games[0].id, analysisSpec('standard')))).toBeTruthy();
    expect(await reopened.summaries()).toHaveLength(3);
    await reopened.close();
  }, 30_000);

  it('cancels in-flight work and keeps the rest of the job cancelled', async () => {
    const store = isolated();
    const job = await createBatch([gameFixture(1), gameFixture(2)], 'chesscom', 'TestPlayer', 'fast', 1, store);
    const analyze = vi.fn<typeof analyzeForLibrary>((_g, _s, _p, signal) => new Promise((_, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      queueMicrotask(() => runner.stop('cancel'));
    }));
    const runner = new BatchRunner(store, analyze);
    await runner.run(job.id, options());
    expect((await store.job(job.id))?.items.map((i) => i.status)).toEqual(['cancelled', 'cancelled']);
    expect(await store.summaries()).toEqual([]);
    await store.close();
  });

  it('aborts all writes when a detail cannot be stored and keeps pending progress', async () => {
    const store = isolated();
    const game = gameFixture(1, { pgn: QUICK });
    const job = await createBatch([game], 'chesscom', 'TestPlayer', 'fast', 1, store);
    const engine = pool();
    try {
      const valid = await analyzeForLibrary(game, spec, engine, undefined, undefined, book);
      // The PGN writes first. An uncloneable field in the detail must abort the entire transaction.
      const invalid = { ...valid, detail: { ...valid.detail, book: { ...valid.detail.book, corrupt: () => {} } as unknown as OpeningBook } };
      const runner = new BatchRunner(store, vi.fn(async () => invalid));
      await expect(runner.run(job.id, options())).rejects.toBeInstanceOf(StorageError);
      expect(await store.summaries()).toEqual([]);
      expect(await store.detail(valid.detail.id)).toBeUndefined();
      expect(await store.job(job.id)).toMatchObject({ status: 'paused', items: [{ status: 'pending' }] });
    } finally { engine.terminate(); await store.close(); }
  }, 20_000);
});

describe('player samples and history', () => {
  function row(n: number, accuracy: number | null, graded: number, accuracySum: number, cpLossSum: number,
    partial: Parameters<typeof gameFixture>[1] = {}): StoredSummary {
    const totals = { ...emptyTotals(), graded, all: graded + 1, accuracySum, cpLossSum };
    totals.counts.best = graded ? 1 : 0;
    totals.counts.book = 1;
    const black = { summary: { accuracy, acpl: 0, counts: totals.counts }, estimatedRating: null, moves: totals,
      phases: { opening: totals }, evidence: [{ pattern: 'opening-errors' as const, confidence: 'high' as const, ply: 1,
        notation: '1… e5', loss: 0.2, detail: 'example for aggregation' }] };
    const white = { ...black, summary: { ...black.summary, accuracy: 90 }, evidence: [] };
    const game = gameFixture(n, partial);
    return { id: analysisId(game.id, spec), game, spec, finishedAt: n, plies: 12, keyMoments: [], sides: { w: white, b: black } };
  }

  it('weights moves, keeps game accuracy separate, excludes unknown outcomes, and deduplicates', () => {
    const a = row(1, 80, 2, 160, 40);
    const b = row(2, 100, 8, 600, 210, { result: '0-1', timeClass: 'blitz' });
    const c = row(3, null, 0, 0, 0, { result: '*', rated: false });
    const sample = sampleFor([c, b, a, a, { ...a, spec: analysisSpec('deep') }], 'chesscom', 'testplayer', specKey(spec));
    expect(sample.map((g) => g.color)).toEqual(['b', 'b', 'b']);
    expect(aggregate(sample)).toMatchObject({ n: 3, accuracyN: 2, accuracy: 90, moveAccuracy: 76, acpl: 25, bestPct: 20, winPct: 50 });
    expect(aggregate(sample, 'endgame')).toMatchObject({ acpl: null, moveAccuracy: null, blunderPct: null });
    expect(aggregate([])).toMatchObject({ n: 0, winPct: null, accuracy: null });
    expect(filterSample(sample, { color: 'w' })).toEqual([]);
    expect(filterSample(sample, { time: 'blitz', rated: true, result: 'win' })).toEqual([sample[1]]);
    expect(trend(sample, 'day', 2, 'opening').map((x) => x.rolling)).toEqual([80, 76, 75]);
    expect(weaknesses(sample)).toMatchObject([{ gameCount: 3, average: expect.closeTo(0.2), total: expect.closeTo(0.6) }]);
    expect(weaknesses([sample[0]])).toEqual([]);
  });

  it('collects the requested number of matching games across pages without counting duplicates or unfinished games', async () => {
    const a = gameFixture(3);
    const b = gameFixture(2);
    const fetch = vi.fn().mockResolvedValueOnce({ games: [a, gameFixture(5, { timeClass: 'blitz' }), gameFixture(4, { result: '*' })], cursor: 'next' })
      .mockResolvedValueOnce({ games: [a, b, gameFixture(1)], cursor: null });
    const found = await collectHistory('chesscom', 'TestPlayer', { limit: 2, timeClass: 'rapid', rated: true,
      since: dayStart('2026-01-02'), until: dayEnd('2026-01-05') }, fetch);
    expect(found.map((g) => [g.id, g.perspective])).toEqual([[a.id, 'b'], [b.id, 'b']]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('game provider adapters', () => {
  it('caches the archive index and pages through in-range months using a stable cursor', async () => {
    const base = 'https://api.chess.com/pub/player/fixture-account/games';
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/archives')) return Response.json({ archives: [
        base + '/2026/03', base + '/2026/01', base + '/2026/02',
      ] });
      return Response.json({ games: [] });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const opts = { since: dayStart('2026-01-01'), until: dayEnd('2026-02-28'), pageSize: 100 };
      const first = await fetchChessComGames('fixture-account', null, opts);
      expect(first.cursor).toBe(base + '/2026/02');
      const second = await fetchChessComGames('fixture-account', first.cursor, opts);
      expect(second.cursor).toBeNull();
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([base + '/archives', base + '/2026/02', base + '/2026/01']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('waits a full minute on Lichess 429 before retrying and applies provider filters', async () => {
    vi.useFakeTimers();
    const rate = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(''));
    vi.stubGlobal('fetch', fetch);
    try {
      const result = fetchLichessGames('fixture-player', '20', { since: 10, timeClass: 'rapid', rated: false, onBackoff: rate });
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(rate).toHaveBeenCalledWith(60);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ games: [], cursor: null });
      expect(fetch).toHaveBeenCalledTimes(2);
      const params = new URL(fetch.mock.calls[1][0]).searchParams;
      expect([params.get('perfType'), params.get('rated'), params.get('since'), params.get('until')])
        .toEqual(['rapid', 'false', '10', '20']);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});
