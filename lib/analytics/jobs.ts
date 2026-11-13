import { AbortError, defaultPoolSize, EnginePool } from '@/lib/engine/stockfish';
import type { GameRecord } from '@/lib/games/types';
import type { AnalysisDepth } from '@/lib/settings';
import { analyzeForLibrary } from './analyze';
import {
  analysisId, analysisSpec, completedResult, MAX_BATCH_GAMES, playerColor, specKey, type BatchJob, type BatchItem,
} from './model';
import { analyticsStore, StorageError, type AnalyticsStore } from './store';

export interface BatchProgress {
  jobId: string;
  gameId: string;
  fraction: number;
  stage: 'search' | 'deep';
}
type Command = 'pause' | 'cancel';
type RunOptions = {
  update: (job: BatchJob) => void;
  progress: (progress: BatchProgress | null) => void;
  saved: (result: Awaited<ReturnType<typeof analyzeForLibrary>>['summary']) => void;
};
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Analysis failed.';
export const workerCount = (n: number) => Math.max(1, Math.min(defaultPoolSize(), Number.isFinite(n) ? Math.trunc(n) : 1));

export async function createBatch(
  games: GameRecord[], source: BatchJob['source'], username: string, depth: AnalysisDepth, workers: number,
  store = analyticsStore,
) {
  const unique = [...new Map(games.map((g) => [g.id, g])).values()].filter((g) => {
    const color = playerColor(g, username);
    return g.source === source && color !== null && completedResult(g, color) !== null;
  });
  if (!unique.length || unique.length > MAX_BATCH_GAMES) throw new Error(`Select 1–${MAX_BATCH_GAMES} finished games.`);
  const job: BatchJob = {
    id: crypto.randomUUID(), source, username: username.trim(), spec: analysisSpec(depth), workers: workerCount(workers),
    status: 'queued', createdAt: Date.now(), updatedAt: Date.now(),
    items: unique.map((g) => ({ gameId: g.id, label: `${g.white.name} vs ${g.black.name}`, status: 'pending' })),
  };
  await store.createJob(job, unique);
  return job;
}

const LOCK = 'chess-review-analytics:engine';
let localLock = false;
async function exclusive<T>(run: () => Promise<T>) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('A batch is running in another tab. Pause it there first.');
      return run();
    });
  }
  if (localLock) throw new Error('A batch is already running.');
  localLock = true;
  try { return await run(); } finally { localLock = false; }
}

export class BatchRunner {
  private running: string | null = null;
  private command: Command | null = null;
  private controller?: AbortController;

  constructor(private store: AnalyticsStore = analyticsStore,
    private analyze = analyzeForLibrary, private makePool = (n: number) => new EnginePool(n)) {}

  stop(command: Command) {
    if (this.running && (this.command !== 'cancel' || command === 'cancel')) this.command = command;
    this.controller?.abort();
  }

  async cancel(id: string, update: RunOptions['update']) {
    if (this.running === id) return this.stop('cancel');
    await exclusive(async () => {
      const job = await this.store.job(id);
      if (job && !['finished', 'cancelled'].includes(job.status)) {
        const next = { ...job, status: 'cancelled' as const, updatedAt: Date.now(),
          items: job.items.map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' as const } : item) };
        await this.store.writeJob(next);
        update(next);
      }
    });
  }

  async run(id: string, options: RunOptions, retry = false) {
    if (this.running) throw new Error('A batch is already running in this tab.');
    this.running = id;
    this.command = null;
    let pool: EnginePool | undefined;
    try {
      await exclusive(async () => {
        const found = await this.store.job(id);
        if (!found || found.status === 'cancelled' || (found.status === 'finished' && !retry)) return;
        if (specKey(found.spec) !== specKey(analysisSpec(found.spec.depth))) {
          throw new Error('This batch used an older analyzer. Select its games again to analyze them with the current version.');
        }
        let job: BatchJob = {
          ...found, status: 'running', updatedAt: Date.now(),
          items: retry ? found.items.map((item) => item.status === 'failed' ? { ...item, error: undefined, status: 'pending' } : item) : found.items,
        };
        await this.store.writeJob(job);
        options.update(job);
        try {
          for (let index = 0; index < job.items.length; index++) {
            const item = job.items[index];
            if (this.command) break;
            if (item.status !== 'pending') continue;
            const withItem = (change: BatchItem): BatchJob => {
              const items = [...job.items];
              items[index] = change;
              return { ...job, items, updatedAt: Date.now() };
            };
            const id = analysisId(item.gameId, job.spec);
            const existing = await this.store.summary(id);
            if (this.command) break;
            if (existing) {
              const detail = await this.store.detail(id);
              if (this.command) break;
              const game = await this.store.game(item.gameId);
              if (this.command) break;
              if (detail && game && detail.game.pgn === game.pgn && detail.game.bookPlies === game.bookPlies) {
                const next = withItem({ ...item, error: undefined, status: 'reused' });
                await this.store.writeJob(next);
                job = next;
                options.update(job);
                continue;
              }
            }

            const game = await this.store.game(item.gameId);
            if (this.command) break;
            this.controller = new AbortController();
            let lastProgress = 0;
            try {
              if (!game) throw new Error('Game record is missing.');
              pool ??= this.makePool(workerCount(job.workers));
              options.progress({ jobId: job.id, gameId: game.id, fraction: 0, stage: 'search' });
              const result = await this.analyze(game, job.spec, pool, this.controller.signal, (fraction, stage) => {
                if (performance.now() - lastProgress < 150) return;
                lastProgress = performance.now();
                options.progress({ jobId: job.id, gameId: game.id, fraction, stage });
              });
              if (this.command) break;
              const next = withItem({ ...item, error: undefined, status: 'done' });
              await this.store.finishGame(result, next);
              job = next;
              options.saved(result.summary);
            } catch (err) {
              // A failed or interrupted worker may have a late UCI reply. Discard the pool.
              pool?.terminate();
              pool = undefined;
              if (this.command || this.controller.signal.aborted) break;
              if (err instanceof StorageError) throw err;
              const next = withItem({ ...item, status: 'failed',
                error: err instanceof AbortError ? 'Stockfish stopped unexpectedly.' : errorMessage(err) });
              await this.store.writeJob(next);
              job = next;
            } finally {
              this.controller = undefined;
              options.progress(null);
            }
            options.update(job);
          }
        } catch (err) {
          job = { ...job, status: 'paused', updatedAt: Date.now() };
          try { await this.store.writeJob(job); } catch { /* Last durable progress remains recoverable. */ }
          options.update(job);
          throw err;
        }
        const command = this.command as Command | null;
        const next: BatchJob = { ...job, updatedAt: Date.now(),
          status: command === 'cancel' ? 'cancelled' : command === 'pause' ? 'paused' : 'finished',
          items: command === 'cancel' ? job.items.map((item) => item.status === 'pending' ? { ...item, status: 'cancelled' } : item) : job.items,
        };
        await this.store.writeJob(next);
        options.update(next);
      });
    } finally {
      pool?.terminate();
      this.running = null;
      this.command = null;
      options.progress(null);
    }
  }
}
