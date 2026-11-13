import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { dateLabel, dayStart } from '@/lib/analytics/history';
import type { ProfileFilters } from '@/lib/analytics/profile';
import { titleCase } from './shared';

function filterLabels(filters: ProfileFilters) {
  const from = filters.from && dateLabel(dayStart(filters.from));
  const through = filters.through && dateLabel(dayStart(filters.through));
  const period = from && through ? `${from} – ${through}` : from ? `From ${from}` : through ? `Through ${through}` : null;
  return [
    period,
    filters.time && titleCase(filters.time),
    filters.rated === undefined ? null : filters.rated ? 'Rated' : 'Unrated',
    filters.color && (filters.color === 'w' ? 'White' : 'Black'),
    filters.result && (filters.result === 'loss' ? 'Losses' : `${titleCase(filters.result)}s`),
    filters.rating && (filters.rating === 'Unknown rating' ? filters.rating : `Opponent ${filters.rating}`),
    filters.length,
  ].filter((label): label is string => Boolean(label));
}

export function SampleDisclosure({ filters, detail, preset, initiallyOpen = false, children }: {
  filters: ProfileFilters;
  detail?: string;
  preset?: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const labels = filterLabels(filters);
  return <details className="sample-disclosure group" open={initiallyOpen || undefined}>
    <summary className="sample-toggle">
      <span className="sample-icon"><SlidersHorizontal size={20} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">Analysis sample</span>
        {detail && <span className="mt-0.5 block text-sm text-muted">{detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-accent-strong sm:text-sm">
        <span className="group-open:hidden">Edit filters</span>
        <span className="hidden group-open:inline">Hide filters</span>
        <ChevronDown size={17} className="group-open:rotate-180" aria-hidden />
      </span>
      <span aria-label="Active sample filters" className="sample-tags">
        {preset && <span className="sample-tag font-semibold text-fg">{preset}</span>}
        {(labels.length ? labels : ['All games']).map((label) => <span key={label} className="sample-tag">{label}</span>)}
      </span>
    </summary>
    <div className="sample-fields">{children}</div>
  </details>;
}
