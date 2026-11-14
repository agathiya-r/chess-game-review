import type { ReactNode } from 'react';
import type { StoredSummary } from '@/lib/analytics/model';
import type { Color, TimeClass } from '@/lib/games/types';

export type AnalyticsPage = 'dashboard' | 'openings' | 'weaknesses';
export type OpenReview = (row: StoredSummary, color: Color, ply?: number, retry?: boolean) => void;
export const TIME_CLASSES: TimeClass[] = ['bullet', 'blitz', 'rapid', 'classical', 'daily', 'unknown'];
export const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const num = (n: number | null | undefined, decimals = 1) => n == null ? '—' : n.toFixed(decimals);
export const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1)}%`;
export const platform = (source: string) => source === 'chesscom' ? 'Chess.com' : 'Lichess';

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`grid min-w-0 gap-1.5 text-xs font-semibold text-muted ${className}`}>{label}{children}</label>;
}
export function Section({ id, tabIndex, title, detail, icon, className, children }: {
  id?: string;
  tabIndex?: number;
  title: string;
  detail?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <section id={id} tabIndex={tabIndex} aria-label={title} className={`analytics-section card min-w-0 ${className ?? ''}`}>
    <div className="flex items-center gap-2.5">
      {icon && <span aria-hidden="true" className="analytics-section-icon">{icon}</span>}
      <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
    </div>
    {detail && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{detail}</p>}
    <div className="mt-4">{children}</div>
  </section>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center text-sm text-muted">{children}</div>;
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={headers.join(', ')}>
    <table className="analytics-table w-full whitespace-nowrap text-left text-sm">
      <thead><tr>{headers.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function StatStrip({ entries }: { entries: readonly (readonly [label: string, value: ReactNode])[] }) {
  return (
    <dl className="analytics-stat-strip">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
