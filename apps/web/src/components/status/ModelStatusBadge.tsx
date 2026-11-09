import type { ModelStatus } from '@stationeers/domain';
import { cn } from '../../lib/utils';
import { StatusChip } from './StatusChip';
import { MODEL_STATUS_CONFIG } from './statusConfig';

/**
 * Model status (spec 5.2): does a behavior model match recorded in-game fixtures?
 * Filled chip; the Unverified variant is dashed-amber = experimental, never success.
 * Independent of TopologyStatusBadge — a result carries BOTH (spec 3.5).
 */
export function ModelStatusBadge({ status, className }: { status: ModelStatus; className?: string }) {
  const config = MODEL_STATUS_CONFIG[status];
  return (
    <StatusChip
      icon={config.icon}
      title={config.title}
      className={cn(config.className, className)}
      data-model-status={status}
    >
      {config.label}
    </StatusChip>
  );
}
