import type { OpeningBook } from '@/lib/analysis/openings';
import type { Phase } from '@/lib/analysis/phases';
import type { Classification, PlayerSummary } from '@/lib/analysis/types';
import type { PositionAnalysis } from '@/lib/engine/uci';
import type { Color, GameRecord, GameResult } from '@/lib/games/types';
import { ANALYSIS_VERSION, DEPTH_PRESETS, type AnalysisDepth } from '@/lib/settings';

export const ENGINE_VERSION = 'Stockfish 17.1 lite WASM';
/** Bump when summary/evidence semantics change and older summaries cannot be compared. */
export const METRICS_VERSION = 1;
export const MAX_BATCH_GAMES = 5_000;
export const PRESET_ORDER: AnalysisDepth[] = ['fast', 'standard', 'deep'];

export type AnalysisSpec = ReturnType<typeof analysisSpec>;
export function analysisSpec(depth: AnalysisDepth) {
  const { search, deep, deepMoves } = DEPTH_PRESETS[depth];
  return { depth, algorithm: ANALYSIS_VERSION, engine: ENGINE_VERSION, metrics: METRICS_VERSION, search, deep, deepMoves };
}

export const specKey = (spec: AnalysisSpec) => JSON.stringify([
  spec.depth, spec.algorithm, spec.engine, spec.metrics,
  ...[spec.search, spec.deep].flatMap((s) => [s.depth, s.nodes, s.moveTimeMs, s.multiPv]), spec.deepMoves,
]);
export const analysisId = (gameId: string, spec: AnalysisSpec) => JSON.stringify([gameId, specKey(spec)]);

export type GameMeta = Omit<GameRecord, 'pgn' | 'perspective'>;
export interface MoveTotals {
  all: number;
  graded: number;
  accuracySum: number;
  cpLossSum: number;
  counts: Record<Classification, number>;
}
export type Pattern = 'missed-mate' | 'allowed-mate' | 'missed-fork' | 'missed-pin' | 'missed-skewer'
  | 'missed-capture' | 'hung-piece' | 'bad-exchange' | 'opening-errors' | 'rook-endgame';
export interface Evidence {
  pattern: Pattern;
  confidence: 'high' | 'possible';
  ply: number;
  notation: string;
  loss: number;
  detail: string;
}
export interface SideMetrics {
  summary: PlayerSummary;
  estimatedRating: number | null;
  moves: MoveTotals;
  phases: Partial<Record<Phase, MoveTotals>>;
  evidence: Evidence[];
}
export interface StoredSummary {
  id: string;
  game: GameMeta;
  spec: AnalysisSpec;
  finishedAt: number;
  opening?: { eco?: string; name: string };
  plies: number;
  keyMoments: number[];
  sides: Record<Color, SideMetrics>;
}
export interface StoredDetail {
  id: string;
  game: GameRecord;
  /** Compact engine lines are sufficient to rebuild the original review. */
  positions: PositionAnalysis[];
  /** The subset needed to reproduce this review, even without network access. */
  book: OpeningBook;
}
export interface AnalysisResult {
  summary: StoredSummary;
  detail: StoredDetail;
}

export type ItemStatus = 'pending' | 'done' | 'reused' | 'failed' | 'cancelled';
export interface BatchItem {
  gameId: string;
  label: string;
  status: ItemStatus;
  error?: string;
}
export interface BatchJob {
  id: string;
  source: 'chesscom' | 'lichess';
  username: string;
  spec: AnalysisSpec;
  workers: number;
  status: 'queued' | 'running' | 'paused' | 'cancelled' | 'finished';
  createdAt: number;
  updatedAt: number;
  items: BatchItem[];
}

export const playerKey = (source: string, username: string) => JSON.stringify([source, username.trim().toLowerCase()]);
export function playerColor(game: GameMeta, username: string): Color | null {
  const target = username.trim().toLowerCase();
  if (game.white.name.toLowerCase() === target) return 'w';
  if (game.black.name.toLowerCase() === target) return 'b';
  return null;
}
export function completedResult(game: GameMeta, color: Color): GameResult | null {
  if (game.result === '1/2-1/2') return 'draw';
  if (game.result === '1-0') return color === 'w' ? 'win' : 'loss';
  if (game.result === '0-1') return color === 'b' ? 'win' : 'loss';
  return null;
}
