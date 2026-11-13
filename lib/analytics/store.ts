import type { GameRecord } from '@/lib/games/types';
import type { AnalysisResult, BatchJob, StoredDetail, StoredSummary } from './model';

const DATABASE = 'chess-review-analytics';
const SCHEMA = 1;
const STORES = ['games', 'summaries', 'details', 'jobs'] as const;
type StoreName = (typeof STORES)[number];

export class StorageError extends Error {
  constructor(action: string, cause?: unknown) {
    const quota = cause instanceof DOMException && cause.name === 'QuotaExceededError';
    super(quota
      ? 'Browser storage is full. Free some space and resume the batch. Previously saved games are still available.'
      : `Could not ${action} in browser storage. Check site storage access and try again.`, { cause });
    this.name = 'StorageError';
  }
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createAnalyticsStore(database = DATABASE) {
  let opening: Promise<IDBDatabase> | undefined;

  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const req = indexedDB.open(database, SCHEMA);
      let blocked = false;
      req.onblocked = () => {
        blocked = true;
        reject(new Error('Close the older Game Review tab'));
      };
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (event.oldVersion < 1) {
          for (const name of STORES) db.createObjectStore(name, { keyPath: 'id' });
        }
        // The original single-game cache is a separate database and stays intact.
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) return db.close();
        db.onversionchange = () => { db.close(); opening = undefined; };
        db.onclose = () => { opening = undefined; };
        resolve(db);
      };
    }).catch((err) => {
      opening = undefined;
      throw err;
    });
    return opening;
  };

  const transact = async <T>(names: StoreName[], mode: IDBTransactionMode, action: string,
    run: (tx: IDBTransaction) => T | Promise<T>): Promise<T> => {
    try {
      const tx = (await open()).transaction(names, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      });
      // Attach a rejection handler before enqueueing work, including synchronous failures.
      const result = Promise.resolve().then(() => run(tx)).catch((err) => {
        try { tx.abort(); } catch { /* Already finished. */ }
        throw err;
      });
      const [value] = await Promise.all([result, done]);
      return value;
    } catch (err) {
      throw new StorageError(action, err);
    }
  };

  const get = <T>(name: StoreName, id: string) => transact([name], 'readonly', 'read data',
    (tx) => request<T | undefined>(tx.objectStore(name).get(id)));
  const list = <T>(name: StoreName) => transact([name], 'readonly', 'read data',
    (tx) => request<T[]>(tx.objectStore(name).getAll()));
  const writeJob = (job: BatchJob) => transact(['jobs'], 'readwrite', 'save batch progress', (tx) => {
    tx.objectStore('jobs').put(job);
  });

  return {
    jobs: () => list<BatchJob>('jobs'),
    summaries: () => list<StoredSummary>('summaries'),
    job: (id: string) => get<BatchJob>('jobs', id),
    game: (id: string) => get<GameRecord>('games', id),
    summary: (id: string) => get<StoredSummary>('summaries', id),
    detail: (id: string) => get<StoredDetail>('details', id),
    writeJob,
    createJob: (job: BatchJob, games: GameRecord[]) =>
      transact(['games', 'jobs'], 'readwrite', 'save the batch', (tx) => {
        for (const game of games) tx.objectStore('games').put(game);
        tx.objectStore('jobs').add(job);
      }),
    /** Commit the result and its job status together, or commit neither. */
    finishGame: (result: AnalysisResult, job?: BatchJob) =>
      transact(['games', 'details', 'summaries', ...(job ? ['jobs' as const] : [])], 'readwrite', 'save a completed analysis', (tx) => {
        tx.objectStore('games').put(result.detail.game);
        tx.objectStore('details').put(result.detail);
        tx.objectStore('summaries').put(result.summary);
        if (job) tx.objectStore('jobs').put(job);
      }),
    close: async () => {
      const db = await opening;
      db?.close();
      opening = undefined;
    },
  };
}

export type AnalyticsStore = ReturnType<typeof createAnalyticsStore>;
export const analyticsStore = createAnalyticsStore();
