'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, Database, ListChecks, X } from 'lucide-react';
import type { AnalyticsState } from '@/hooks/useAnalytics';
import { batchItemCounts, type BatchProgress } from '@/lib/analytics/jobs';
import type { BatchJob } from '@/lib/analytics/model';

const DIALOG_ID = 'bulk-analysis-dialog';

export function BulkAnalysisLauncher({ analytics, savedCount, open, onOpen }: {
  analytics: AnalyticsState;
  savedCount: number;
  open: boolean;
  onOpen: () => void;
}) {
  const job = analytics.jobs.find((item) => item.id === analytics.active);
  const running = analytics.active !== null;
  const progress = job ? batchPercent(job, analytics.progress) : 0;
  const label = running ? `${progress}% complete`
    : analytics.ready ? `${savedCount.toLocaleString()} saved ${savedCount === 1 ? 'game' : 'games'}`
    : analytics.error ? 'Library unavailable' : 'Loading library…';

  return (
    <button type="button" className="bulk-launcher" aria-label="Bulk Analysis"
      aria-haspopup="dialog" aria-controls={DIALOG_ID} aria-expanded={open} aria-describedby="bulk-launcher-status" onClick={onOpen}>
      <span className="bulk-launcher-icon" aria-hidden="true">{running ? <ListChecks size={17} /> : <Database size={17} />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">Bulk Analysis</span>
        <span id="bulk-launcher-status" className="block text-xs text-muted tabular-nums">{label}</span>
        {running && <progress aria-label="Bulk analysis progress" className="bulk-launcher-progress" max={100} value={progress} />}
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  );
}

function batchPercent(job: BatchJob, progress: BatchProgress | null) {
  const { pending } = batchItemCounts(job);
  const current = progress?.jobId === job.id && job.items.some((item) => item.gameId === progress.gameId && item.status === 'pending')
    ? progress.fraction : 0;
  if (!job.items.length) return 0;
  return Math.min(pending ? 99 : 100, Math.floor((job.items.length - pending + current) / job.items.length * 100));
}

const shortcuts = [
  ['bulk-game-filters', 'Find games'],
  ['bulk-batch-queue', 'Batch queue'],
  ['bulk-import', 'Import'],
] as const;

export function BulkAnalysisDialog({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} id={DIALOG_ID} className="bulk-dialog" aria-labelledby="bulk-dialog-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="bulk-dialog-shell">
        <header className="bulk-dialog-header">
          <div className="flex items-center justify-between gap-2">
            <h2 id="bulk-dialog-title" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
              <ListChecks size={20} className="text-accent-strong" aria-hidden="true" /> Bulk Analysis
            </h2>
            <button type="button" className="icon-btn size-9" aria-label="Close Bulk Analysis" onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {children && <nav aria-label="Bulk analysis settings" className="bulk-dialog-shortcuts">
            {shortcuts.map(([id, label]) => (
              <button type="button" key={id} onClick={() => {
                const target = content.current?.querySelector<HTMLElement>(`#${id}`);
                target?.scrollIntoView({ block: 'start' });
                target?.focus({ preventScroll: true });
              }}>{label}</button>
            ))}
          </nav>}
        </header>
        <div className="bulk-dialog-content analytics-wrap" ref={content}>
          {children ?? <p role="status" className="text-sm text-muted">Loading the local library…</p>}
        </div>
      </div>
    </dialog>
  );
}
