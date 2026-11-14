import { X } from 'lucide-react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import type { AnalysisProfile } from '@/lib/analytics/profile';
import { platform } from './shared';

export function ActivePlayer({ profile, onClear }: {
  profile: AnalysisProfile;
  onClear: () => void;
}) {
  return <div className="active-player">
    <PlayerAvatar source={profile.source} name={profile.username} color="w" className="size-9 shrink-0 rounded-md" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-bold" title={profile.username}>{profile.username}</p>
      <p className="active-player-source text-xs text-muted">{platform(profile.source)} <span>· Active player</span></p>
    </div>
    <button type="button" className="icon-btn size-8 shrink-0" onClick={onClear}
      aria-label="Deselect player" title="Deselect player"><X size={16} /></button>
  </div>;
}
