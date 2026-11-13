'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BatchRunner, createBatch, type BatchProgress } from '@/lib/analytics/jobs';
import type { BatchJob, StoredSummary } from '@/lib/analytics/model';
import { analyticsStore } from '@/lib/analytics/store';

function updateById<T extends { id: string }>(rows: T[], row: T) {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index < 0) return [...rows, row];
  const next = [...rows];
  next[index] = row;
  return next;
}

export function useAnalytics() {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [summaries, setSummaries] = useState<StoredSummary[]>([]);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [control, setControl] = useState<'pause' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [runner] = useState(() => new BatchRunner());
  const channel = useRef<BroadcastChannel | null>(null);

  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong.'), []);
  const reload = useCallback(async () => {
    try {
      const [jobs, summaries] = await Promise.all([analyticsStore.jobs(), analyticsStore.summaries()]);
      setJobs(jobs);
      setError(null);
      setSummaries(summaries);
      setReady(true);
    } catch (err) { fail(err); }
  }, [fail]);

  useEffect(() => {
    queueMicrotask(() => void reload());
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('chess-review-analytics');
      channel.current.onmessage = (e: MessageEvent<{ job?: BatchJob; summary?: StoredSummary }>) => {
        const { job, summary } = e.data;
        if (job) setJobs((prev) => updateById(prev, job));
        if (summary) setSummaries((prev) => updateById(prev, summary));
      };
    }
    return () => {
      channel.current?.close();
      channel.current = null;
      runner.stop('pause');
    };
  }, [reload, runner]);

  const update = (job: BatchJob) => {
    setJobs((prev) => updateById(prev, job));
    channel.current?.postMessage({ job });
  };
  const saved = (summary: StoredSummary) => {
    setSummaries((prev) => updateById(prev, summary));
    channel.current?.postMessage({ summary });
  };
  const run = async (id: string, retry = false) => {
    if (active) return;
    setError(null);
    setActive(id);
    try { await runner.run(id, { update, saved, progress: setProgress }, retry); }
    catch (err) { fail(err); }
    finally { setActive(null); setControl(null); }
  };
  const start = async (...args: Parameters<typeof createBatch>) => {
    setError(null);
    try {
      const job = await createBatch(...args);
      update(job);
      return job;
    } catch (err) { fail(err); }
  };
  const stop = (command: 'pause' | 'cancel') => {
    setControl(command);
    runner.stop(command);
  };
  const cancel = async (id: string) => {
    if (active === id) return stop('cancel');
    setError(null);
    try { await runner.cancel(id, update); } catch (err) { fail(err); }
  };

  return { jobs, summaries, progress, active, control, error, ready, reload, start, run, stop, cancel, saved, fail };
}
export type AnalyticsState = ReturnType<typeof useAnalytics>;
