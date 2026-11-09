import { cn } from '../../lib/utils';
import { StatusChip } from './StatusChip';
import type { IntentTopologyStatus } from './statusConfig';
import { INTENT_STATUS_CONFIG } from './statusConfig';

/**
 * Derived topology status of a ConnectionIntent (spec 3.5): Unrouted · Routed ·
 * Routed with warnings · Conflicting · Not buildable. Display-only vocabulary —
 * intents are stored bare (3.3); the status is derived, never serialized (9.1).
 */
export function IntentStatusChip({
  status,
  className,
}: {
  status: IntentTopologyStatus;
  className?: string;
}) {
  const config = INTENT_STATUS_CONFIG[status];
  return (
    <StatusChip
      icon={config.icon}
      title={config.title}
      className={cn(config.className, className)}
      data-intent-status={status}
    >
      {config.label}
    </StatusChip>
  );
}
