import type { AnalysisDepth } from '@/lib/settings';
import { dayEnd, dayStart } from './history';
import { completedResult, playerColor, PRESET_ORDER, type BatchJob, type GameMeta } from './model';
import type { Filters } from './filters';

export type PlayerAccount = Pick<BatchJob, 'source' | 'username'>;
export type ProfileFilters = Omit<Filters, 'since' | 'until'> & { from?: string; through?: string };
export interface AnalysisProfile extends PlayerAccount {
  depth: AnalysisDepth;
  version?: string;
  filters: ProfileFilters;
}

export const PROFILE_KEY = 'chess-review:analysis-profile';

export function loadProfile(): AnalysisProfile | null | undefined {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored === null) return undefined;
    const profile = JSON.parse(stored) as AnalysisProfile | null;
    if (profile && (profile.source === 'chesscom' || profile.source === 'lichess')
      && typeof profile.username === 'string' && profile.username.trim()
      && PRESET_ORDER.includes(profile.depth) && profile.filters && typeof profile.filters === 'object') {
      return profile;
    }
  } catch { /* Invalid or unavailable local storage. */ }
  return null;
}

export function profileFilters({ from, through, ...filters }: ProfileFilters): Filters {
  return { ...filters, since: dayStart(from ?? ''), until: dayEnd(through ?? '') };
}

export function profileColor(profile: PlayerAccount | null | undefined, game: GameMeta) {
  if (!profile || game.source !== profile.source) return null;
  const color = playerColor(game, profile.username);
  return color && completedResult(game, color) ? color : null;
}
