import type { DataQuality } from '@stationeers/domain';
import { cn } from '../../lib/utils';
import { DATA_QUALITY_CONFIG } from './statusConfig';

/**
 * Data-quality level of an extracted property (spec 6.5), used for provenance
 * display (spec 13 #3: every displayed property shows provenance and quality).
 * Compact dot + label so it fits on per-property rows in the catalog.
 */
export function DataQualityBadge({ quality, className }: { quality: DataQuality; className?: string }) {
  const config = DATA_QUALITY_CONFIG[quality];
  return (
    <span
      data-quality={quality}
      title={config.title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase',
        className,
      )}
    >
      <span aria-hidden className={cn('inline-block size-1.5 rounded-full', config.dotClassName)} />
      <span>{config.label}</span>
    </span>
  );
}
