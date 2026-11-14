import { CLASSIFICATION_LABEL, type Classification } from '@/lib/analysis/types';
import { ChessIcon } from './ChessIcon';

export function ClassificationIcon({ classification, size = 18, className }: {
  classification: Classification;
  size?: number;
  className?: string;
}) {
  return <ChessIcon name={classification} label={CLASSIFICATION_LABEL[classification]} size={size} className={className} />;
}
