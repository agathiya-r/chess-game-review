import { useEffect, useState } from 'react';
import { Board } from '@/components/review/Board';
import type { StoredDetail } from '@/lib/analytics/model';
import { analyticsStore } from '@/lib/analytics/store';
import type { Color } from '@/lib/games/types';

export function useSavedGame(id: string) {
  const [loaded, setLoaded] = useState<{ id: string; detail?: StoredDetail }>();

  useEffect(() => {
    let cancelled = false;
    const settle = (detail?: StoredDetail) => {
      if (!cancelled) setLoaded({ id, detail });
    };

    void analyticsStore.detail(id).then(settle, () => settle());
    return () => { cancelled = true; };
  }, [id]);

  return loaded?.id === id ? loaded.detail ?? null : undefined;
}

export function SavedPosition({ fen, color }: { fen: string | null | undefined; color: Color }) {
  return (
    <div className="saved-position">
      {fen ? (
        <Board fen={fen} orientation={color === 'w' ? 'white' : 'black'} theme="green" className="rounded-sm" />
      ) : (
        <div className="saved-position-placeholder">
          {fen === null ? 'Position preview unavailable' : 'Loading position…'}
        </div>
      )}
    </div>
  );
}
