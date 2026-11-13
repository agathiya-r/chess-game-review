import type { OpeningBook } from '@/lib/analysis/openings';
import { buildReview } from '@/lib/analysis/review';
import type { EngineLine, PositionAnalysis } from '@/lib/engine/uci';
import { parseGame } from '@/lib/games/pgn';
import type { GameRecord } from '@/lib/games/types';
import { summarizeGame } from './metrics';
import { analysisSpec, PRESET_ORDER, specKey, type AnalysisResult, type AnalysisSpec } from './model';

export const TRANSFER_FORMAT = 'chess-review-analysis/1';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const optional = (value: unknown, predicate: (v: unknown) => boolean) => value === undefined || predicate(value);
const string = (value: unknown) => typeof value === 'string';
const bool = (value: unknown) => typeof value === 'boolean';
const player = (value: unknown) => object(value) && typeof value.name === 'string' && value.name.trim() !== ''
  && optional(value.rating, positive);
const classes = ['bullet', 'blitz', 'rapid', 'classical', 'daily', 'unknown'];

function gameRecord(value: unknown): value is GameRecord {
  if (!object(value)) return false;
  const source = value.source;
  if ((source !== 'chesscom' && source !== 'lichess') || typeof value.id !== 'string') return false;
  if (!(source === 'chesscom' ? /^chesscom:[\da-f-]{36}$/i : /^lichess:[\da-z]{8}$/i).test(value.id)) return false;
  return typeof value.pgn === 'string' && player(value.white) && player(value.black)
    && typeof value.result === 'string' && ['1-0', '0-1', '1/2-1/2'].includes(value.result)
    && typeof value.timeClass === 'string' && classes.includes(value.timeClass)
    && ['endTime', 'startedAt'].every((k) => optional(value[k], (v) => positive(v) && Number(v) <= 8.64e15))
    && optional(value.rated, bool)
    && optional(value.bookPlies, (v) => positive(v) && Number.isInteger(v))
    && ['opening', 'eco', 'timeControl', 'termination'].every((k) => optional(value[k], string))
    && optional(value.url, (v) => typeof v === 'string' && (source === 'chesscom'
      ? /^https:\/\/(?:www\.)?chess\.com\//.test(v) : /^https:\/\/lichess\.org\//.test(v)));
}
function line(value: unknown): value is EngineLine {
  if (!object(value) || !positive(value.rank) || !positive(value.depth) || !object(value.score)) return false;
  const score = value.score;
  return (Number.isFinite(score.cp) && score.mate === undefined || Number.isInteger(score.mate) && score.cp === undefined)
    && Array.isArray(value.pv) && value.pv.length > 0 && value.pv.length <= 14
    && value.pv.every((uci) => typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci));
}
function position(value: unknown, fen: string): value is PositionAnalysis {
  return object(value) && value.fen === fen && positive(value.depth) && Array.isArray(value.lines)
    && value.lines.length <= 3 && value.lines.every(line) && optional(value.played, line);
}

export function serializeAnalysis(result: AnalysisResult) {
  return JSON.stringify({ format: TRANSFER_FORMAT, spec: result.summary.spec,
    game: result.detail.game, positions: result.detail.positions });
}

export function readTransferLine(text: string, book: OpeningBook): AnalysisResult {
  const record: unknown = JSON.parse(text);
  if (!object(record) || record.format !== TRANSFER_FORMAT || !object(record.spec)) throw new Error('Unsupported analysis file format.');
  const incoming = record.spec;
  const preset = PRESET_ORDER.find((value) => value === incoming.depth);
  if (!preset) throw new Error('Unknown analysis preset.');
  const spec = analysisSpec(preset);
  const looksLikeSpec = object(incoming.search) && object(incoming.deep);
  if (!looksLikeSpec || specKey(incoming as unknown as AnalysisSpec) !== specKey(spec)) {
    throw new Error('The file was produced with incompatible analysis settings. Re-run the CLI from this version.');
  }
  if (!gameRecord(record.game)) throw new Error('Invalid game metadata.');
  const game = { ...record.game, perspective: undefined };
  const parsed = parseGame(game.pgn);
  const fens = [parsed.startFen, ...parsed.plies.map((p) => p.fenAfter)];
  if (!Array.isArray(record.positions) || record.positions.length !== fens.length
    || !record.positions.every((p, index) => position(p, fens[index]))) throw new Error('Engine positions do not match this game.');
  const review = buildReview(parsed.plies, record.positions, book, undefined, undefined, game.bookPlies);
  return summarizeGame(game, parsed, review, book, spec);
}

export async function* transferLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        if (newline > 8_000_000) throw new Error('An analysis row is larger than the import limit.');
        const line = buffer.slice(0, newline).trim();
        if (line) yield line;
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > 8_000_000) throw new Error('An analysis row is larger than the import limit.');
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer.trim();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
