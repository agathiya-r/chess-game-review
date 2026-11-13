import { appendFileSync, existsSync, readFileSync, truncateSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { OpeningBook } from '@/lib/analysis/openings';
import { analyzeForLibrary } from '@/lib/analytics/analyze';
import { collectHistory, dayEnd, dayStart } from '@/lib/analytics/history';
import { analysisId, analysisSpec, MAX_BATCH_GAMES, PRESET_ORDER } from '@/lib/analytics/model';
import { readTransferLine, serializeAnalysis } from '@/lib/analytics/transfer';
import { EnginePool } from '@/lib/engine/stockfish';
import type { TimeClass } from '@/lib/games/types';
import { nodeEngine } from './support/node-engine';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: {
    limit: { type: 'string', default: '100' }, preset: { type: 'string', default: 'standard' },
    workers: { type: 'string', default: '2' }, out: { type: 'string', default: 'analyses.jsonl' },
    time: { type: 'string' }, rated: { type: 'string' }, from: { type: 'string' }, through: { type: 'string' },
  },
});
const [source, username, extra] = positionals;
const preset = PRESET_ORDER.find((p) => p === values.preset);
const time = (['bullet', 'blitz', 'rapid', 'classical', 'daily'] as TimeClass[]).find((v) => v === values.time);
const limit = Number(values.limit);
const workers = Number(values.workers);
const since = dayStart(values.from ?? '');
const until = dayEnd(values.through ?? '');
if ((source !== 'chesscom' && source !== 'lichess') || !username?.trim() || extra || !preset
  || !Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_GAMES || !Number.isInteger(workers) || workers < 1 || workers > 4
  || (values.time && !time) || (values.rated && !['yes', 'no'].includes(values.rated))
  || Number.isNaN(since) || Number.isNaN(until) || (since !== undefined && until !== undefined && since > until)) {
  console.error('Usage: npm run analyze:player -- <chesscom|lichess> <username> [--limit 100] [--time rapid] [--rated yes|no] [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--preset fast|standard|deep] [--workers 1–4] [--out analyses.jsonl]');
  process.exit(2);
}

const book = JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningBook;
const saved = new Set<string>();
if (existsSync(values.out)) {
  const content = readFileSync(values.out);
  const lastNewline = content.lastIndexOf(10) + 1;
  if (lastNewline < content.length) {
    // Each successful append ends in a newline; a crash may leave part of one row.
    console.error('Removing an incomplete trailing row from this output file.');
    truncateSync(values.out, lastNewline);
  }
  for (const line of content.subarray(0, lastNewline).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    saved.add(readTransferLine(line, book).summary.id);
  }
}

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
const spec = analysisSpec(preset);
let pool: EnginePool | undefined;
let failed = 0;
try {
  const games = await collectHistory(source, username, { limit, since, until, signal: controller.signal,
    timeClass: time, rated: values.rated === undefined ? undefined : values.rated === 'yes',
    onBackoff: (seconds) => { if (seconds) console.error(`Rate limited; retrying in ${seconds}s.`); } });
  console.log(`${games.length} matching games · writing ${values.out}`);
  for (const [index, game] of games.entries()) {
    if (controller.signal.aborted) break;
    if (saved.has(analysisId(game.id, spec))) { console.log(`${index + 1}/${games.length} reused ${game.id}`); continue; }
    pool ??= new EnginePool(workers, nodeEngine);
    let result;
    try { result = await analyzeForLibrary(game, spec, pool, controller.signal, undefined, book); }
    catch (err) {
      pool.terminate();
      pool = undefined;
      if (controller.signal.aborted) break;
      console.error(`${index + 1}/${games.length} failed ${game.id}:`, err instanceof Error ? err.message : err);
      failed++;
      continue;
    }
    appendFileSync(values.out, serializeAnalysis(result) + '\n', { flag: 'a' });
    console.log(`${index + 1}/${games.length} saved ${game.id}`);
  }
} catch (err) {
  if (!controller.signal.aborted) { console.error(err instanceof Error ? err.message : err); failed++; }
} finally {
  pool?.terminate();
  process.removeListener('SIGINT', interrupt);
}
process.exitCode = controller.signal.aborted ? 130 : failed ? 1 : 0;
