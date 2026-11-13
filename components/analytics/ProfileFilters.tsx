import type { Color, GameResult, TimeClass } from '@/lib/games/types';
import { gameLength, ratingBracket } from '@/lib/analytics/filters';
import type { ProfileFilters as FilterValues } from '@/lib/analytics/profile';
import { Field, TIME_CLASSES, titleCase } from './shared';

export function ProfileFilters({ values, onChange }: {
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}) {
  const update = (filter: Partial<FilterValues>) => onChange({ ...values, ...filter });

  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    <Field label="Time control"><select className="input" value={values.time ?? ''} onChange={(e) => update({ time: (e.target.value || undefined) as TimeClass | undefined })}>
      <option value="">Any time control</option>{TIME_CLASSES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
    </select></Field>
    <Field label="Rated status"><select className="input" value={values.rated === undefined ? '' : String(values.rated)} onChange={(e) => update({ rated: e.target.value ? e.target.value === 'true' : undefined })}>
      <option value="">Rated and unrated</option><option value="true">Rated only</option><option value="false">Unrated only</option>
    </select></Field>
    <Field label="From (UTC)"><input className="input" type="date" max={values.through} value={values.from ?? ''} onChange={(e) => update({ from: e.target.value || undefined })} /></Field>
    <Field label="Through (UTC)"><input className="input" type="date" min={values.from} value={values.through ?? ''} onChange={(e) => update({ through: e.target.value || undefined })} /></Field>
    <Field label="Color"><select className="input" value={values.color ?? ''} onChange={(e) => update({ color: (e.target.value || undefined) as Color | undefined })}>
      <option value="">Both colors</option><option value="w">White</option><option value="b">Black</option>
    </select></Field>
    <Field label="Result"><select className="input" value={values.result ?? ''} onChange={(e) => update({ result: (e.target.value || undefined) as GameResult | undefined })}>
      <option value="">Any result</option>{['win', 'draw', 'loss'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
    </select></Field>
    <Field label="Opponent rating"><select className="input" value={values.rating ?? ''} onChange={(e) => update({ rating: e.target.value || undefined })}>
      <option value="">Any rating</option>{[500, 1200, 1600, 2100, 2700, undefined].map(ratingBracket).map((v) => <option key={v}>{v}</option>)}
    </select></Field>
    <Field label="Game length"><select className="input" value={values.length ?? ''} onChange={(e) => update({ length: e.target.value || undefined })}>
      <option value="">Any length</option>{[20, 60, 100].map(gameLength).map((v) => <option key={v}>{v}</option>)}
    </select></Field>
  </div>;
}
