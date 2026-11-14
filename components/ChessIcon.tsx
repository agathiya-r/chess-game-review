import Image from 'next/image';
import type { Classification } from '@/lib/analysis/types';
import type { TimeClass } from '@/lib/games/types';
import { CalendarDays, Hourglass, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

const featureIcons = ['magnifier-analysis', 'explorer', 'board-stack-green', 'training', 'board-find'] as const;
type FeatureIcon = typeof featureIcons[number];
type IconName = Classification | FeatureIcon | 'bullet' | 'blitz' | 'rapid';

export function ChessIcon({ name, label, size = 24, className }: {
  name: IconName;
  label?: string;
  size?: number;
  className?: string;
}) {
  const extension = (featureIcons as readonly IconName[]).includes(name) ? 'svg' : 'webp';
  return (
    <Image src={`/chess-icons/${name}.${extension}`} alt={label ?? ''} width={size} height={size}
      unoptimized className={cn('inline-block shrink-0 object-contain', className)} />
  );
}

export function TimeControlIcon({ time, size = 18 }: { time: TimeClass; size?: number }) {
  if (time === 'bullet' || time === 'blitz' || time === 'rapid') return <ChessIcon name={time} size={size} />;
  const Icon = time === 'daily' ? CalendarDays : time === 'classical' ? Hourglass : Timer;
  return <Icon size={size} aria-hidden="true" />;
}
