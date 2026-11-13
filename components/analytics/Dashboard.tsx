'use client';

import { useMemo, useState } from 'react';
import { ChartNoAxesCombined, Gauge, Layers3, ListChecks, TrendingUp } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { ClassificationIcon } from '@/components/ClassificationIcon';
import type { Phase } from '@/lib/analysis/phases';
import { CLASSIFICATION_LABEL, CLASSIFICATIONS } from '@/lib/analysis/types';
import { dateLabel } from '@/lib/analytics/history';
import { analysisSpec, playerKey, PRESET_ORDER, specKey, type StoredSummary } from '@/lib/analytics/model';
import { aggregate, filterSample, groupSample, PHASES, ratio, sampleFor, trend, type Interval, type SampleGame } from '@/lib/analytics/stats';
import { profileFilters, type AnalysisProfile } from '@/lib/analytics/profile';
import { ProfileFilters } from './ProfileFilters';
import { BrilliantMoves } from './BrilliantMoves';
import { SampleDisclosure } from './SampleDisclosure';
import { GameLibrary } from './GameLibrary';
import { OpeningRepertoire } from './OpeningRepertoire';
import { PracticePlan } from './PracticePlan';
import { Conditions, groupers, groupLabels, PhasePerformance, type Group } from './PerformanceSections';
import { AccuracyChart } from './AccuracyChart';
import { Empty, Field, Section, Table, num, pct, titleCase, type AnalyticsPage, type OpenReview } from './shared';

type DashboardPage = Exclude<AnalyticsPage, 'bulk'>;
const pageInfo = {
  dashboard: { title: 'Player dashboard', description: 'Track your accuracy, compare conditions, and open any game behind the numbers.' },
  openings: { title: 'Opening performance', description: 'See how you play in the opening and what happens in the rest of those games.' },
  weaknesses: { title: 'Weaknesses & training', description: 'Find recurring mistakes in engine lines, then retry the positions yourself.' },
};

export function Dashboard({ rows, page, profile, onProfileChange, onBulk, onReview }: {
  rows: StoredSummary[];
  page: DashboardPage;
  profile: AnalysisProfile | null;
  onProfileChange: (profile: AnalysisProfile) => void;
  onBulk: () => void;
  onReview: OpenReview;
}) {
  const versions = useMemo(() => {
    const all = new Map(PRESET_ORDER.map((depth) => {
      const spec = analysisSpec(depth);
      return [specKey(spec), spec] as const;
    }));
    if (profile) for (const row of rows) {
      if (row.game.source === profile.source && [row.game.white, row.game.black].some((p) => p.name.toLowerCase() === profile.username.toLowerCase())) {
        all.set(specKey(row.spec), row.spec);
      }
    }
    return all;
  }, [rows, profile]);
  const chosenVersion = profile
    ? profile.version && versions.has(profile.version) ? profile.version : specKey(analysisSpec(profile.depth))
    : '';
  const spec = versions.get(chosenVersion);
  const sample = useMemo(() => profile ? sampleFor(rows, profile.source, profile.username, chosenVersion) : [], [rows, profile, chosenVersion]);
  const matching = useMemo(() => profile ? filterSample(sample, profileFilters(profile.filters)) : [], [sample, profile]);
  const totals = useMemo(() => aggregate(matching), [matching]);
  const info = pageInfo[page];

  return <div className="grid gap-5">
    <PageHero variant={page} title={info.title} description={info.description} />
    {!profile ? <Section title="Choose your player" icon={<ListChecks size={20} />}>
      <Empty><p>Set your Chess.com or Lichess username in Bulk Analysis to see your games here.</p>
        <button className="btn btn-primary mt-4" onClick={onBulk}><ListChecks size={16} /> Set up player</button>
      </Empty>
    </Section> : <>
      <SampleDisclosure key={page} filters={profile.filters} preset={`${titleCase(profile.depth)}${spec && chosenVersion !== specKey(analysisSpec(spec.depth)) ? ' (archived)' : ''}`} detail={`${totals.n.toLocaleString()} of ${sample.length.toLocaleString()} saved games · ${totals.dateRange ? totals.dateRange.map(dateLabel).join(' – ') : 'No known dates in this sample'}`}>
        <ProfileFilters values={profile.filters} onChange={(filters) => onProfileChange({ ...profile, filters })} />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <Field label="Analysis preset"><select className="input" value={chosenVersion} onChange={(e) => {
            const next = versions.get(e.target.value);
            if (next) onProfileChange({ ...profile, depth: next.depth,
              version: e.target.value === specKey(analysisSpec(next.depth)) ? undefined : e.target.value });
          }}>
            {[...versions].map(([key, s]) => <option key={key} value={key}>{titleCase(s.depth)}{key !== specKey(analysisSpec(s.depth)) ? ` · v${s.algorithm}.${s.metrics} (archived)` : ''}</option>)}
          </select></Field>
          <p className="text-xs text-muted">{spec?.engine} · algorithm v{spec?.algorithm} · metrics v{spec?.metrics}</p>
          <button className="btn btn-ghost border border-line" onClick={() => onProfileChange({ ...profile, filters: {} })}>Reset filters</button>
        </div>
      </SampleDisclosure>
      {!matching.length ? <Empty>No analyzed games match these filters.</Empty> : page === 'openings' ? <OpeningRepertoire rows={matching} onReview={onReview} />
        : page === 'weaknesses' ? <PracticePlan rows={matching} onReview={onReview} />
        : <>
          <Metrics totals={totals} />
          <History key={playerKey(profile.source, profile.username) + chosenVersion} rows={matching} onReview={onReview} />
          <Breakdown rows={matching} />
          <BrilliantMoves key={playerKey(profile.source, profile.username) + chosenVersion} rows={matching} onReview={onReview} />
          <PhasePerformance rows={matching} />
          <Conditions rows={matching} />
          <GameLibrary rows={matching} onReview={onReview} />
        </>}
    </>}
  </div>;
}

function Metrics({ totals: t }: { totals: ReturnType<typeof aggregate> }) {
  const highlights = [
    { label: 'Game accuracy', value: pct(t.accuracy), detail: `${t.accuracyN} scored games`, icon: Gauge, tone: 'accuracy' },
    { label: 'Win rate', value: pct(t.winPct), detail: `${t.wins} wins · ${t.draws} draws · ${t.losses} losses`, icon: TrendingUp, tone: 'results' },
    { label: 'Analyzed games', value: t.n.toLocaleString(), detail: `${t.totals.all.toLocaleString()} player moves`, icon: Layers3, tone: 'games' },
  ];
  const metrics = [
    ['Move accuracy', pct(t.moveAccuracy)],
    ['Best moves', pct(t.bestPct)],
    ['Avg. centipawn loss', num(t.acpl)],
    ['Mistakes per game', num(t.mistakes, 2)],
    ['Blunders per game', num(t.blunders, 2)],
  ];
  return (
    <section className="grid gap-3" aria-label="Performance overview">
      <dl className="scorecard">
        {highlights.map(({ label, value, detail, icon: Icon, tone }) => (
          <div className="scorecard-highlight" data-tone={tone} key={label}>
            <dt><Icon size={17} aria-hidden="true" />{label}</dt>
            <dd className="scorecard-value">{value}</dd>
            <dd className="scorecard-detail">{detail}</dd>
          </div>
        ))}
      </dl>
      <dl className="scorecard-stats">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function History({ rows, onReview }: { rows: SampleGame[]; onReview: OpenReview }) {
  const [interval, setInterval] = useState<Interval>('game');
  const [window, setWindow] = useState(10);
  const [phase, setPhase] = useState<Phase | ''>('');
  const [rating, setRating] = useState(false);
  const points = useMemo(() => trend(rows, interval, window, phase || undefined), [rows, interval, window, phase]);
  return <Section title="Accuracy over time" icon={<ChartNoAxesCombined size={20} />} detail="Game accuracy approximates Chess.com’s score. Phase trends use graded move accuracy. Accuracy alone does not measure playing strength.">
    <div className="analytics-controls mb-4 flex flex-wrap items-end gap-3">
      <Field label="Group by"><select className="input" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
        <option value="game">Game</option><option value="day">Day</option><option value="week">Week (Monday)</option><option value="month">Month</option></select></Field>
      <Field label={`Rolling window (${interval === 'game' ? 'games' : 'observed periods'})`}><input className="input w-32" type="number" min={1} max={100} value={window} onChange={(e) => setWindow(Math.max(1, Math.min(100, e.target.valueAsNumber || 1)))} /></Field>
      <Field label="Accuracy series"><select className="input" value={phase} onChange={(e) => setPhase(e.target.value as Phase | '')}>
        <option value="">Game accuracy</option>{PHASES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select></Field>
      <label className="flex items-center gap-2 py-3 text-sm text-muted"><input type="checkbox" checked={rating} onChange={(e) => setRating(e.target.checked)} /> Show player rating</label>
    </div>
    <AccuracyChart key={`${interval}:${phase}:${points.length}:${points[0]?.date}:${points.at(-1)?.date}`} points={points} showRating={rating} onReview={onReview} />
  </Section>;
}

function Breakdown({ rows }: { rows: SampleGame[] }) {
  const [phase, setPhase] = useState<Phase | ''>('');
  const [group, setGroup] = useState<Group | ''>('');
  const groups = group ? [...groupSample(rows, groupers[group])] : [];
  const { totals } = aggregate(rows, phase || undefined);
  return <Section title="Move classifications" icon={<ListChecks size={20} />} detail="Percentages use all classified player moves in this view, including Book and Forced.">
    <div className="analytics-controls mb-4 flex flex-wrap gap-3">
      <Field label="Classification phase"><select className="input" value={phase} onChange={(e) => setPhase(e.target.value as Phase | '')}><option value="">All phases</option>
        {PHASES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select></Field>
      <Field label="Compare classifications by"><select className="input" value={group} onChange={(e) => setGroup(e.target.value as Group | '')}>
        <option value="">No groups</option>{Object.entries(groupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    </div>
    {!totals.all ? <Empty>No classified moves in this phase.</Empty> : <>
      <div className="classification-distribution" aria-hidden="true">
        {CLASSIFICATIONS.filter((c) => totals.counts[c] > 0).map((c) => (
          <span key={c} style={{ flexGrow: totals.counts[c], backgroundColor: `var(--color-${c})` }} />
        ))}
      </div>
      <dl className="classification-stats">
        {CLASSIFICATIONS.map((c) => (
          <div key={c}>
            <dt><span aria-hidden="true"><ClassificationIcon classification={c} /></span>{CLASSIFICATION_LABEL[c]}</dt>
            <dd>{totals.counts[c].toLocaleString()} <span>{pct(100 * totals.counts[c] / totals.all)}</span></dd>
          </div>
        ))}
      </dl>
      {!!groups.length && <div className="mt-4"><Table headers={['Group', 'Moves', ...CLASSIFICATIONS.map((c) => CLASSIFICATION_LABEL[c])]}>
        {groups.map(([label, sample]) => {
          const { totals } = aggregate(sample, phase || undefined);
          return <tr key={label}><th scope="row">{label}</th><td>{totals.all}</td>{CLASSIFICATIONS.map((c) =>
            <td key={c}>{totals.counts[c]} · {pct(ratio(totals.counts[c] * 100, totals.all))}</td>)}</tr>;
        })}
      </Table></div>}
    </>}
  </Section>;
}
