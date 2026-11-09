import type { TopologyStatus } from '@stationeers/domain';
import { cn } from '../../lib/utils';
import { StatusChip } from './StatusChip';
import { TOPOLOGY_STATUS_CONFIG } from './statusConfig';

/**
 * Topology status (spec 3.5): can the participating networks physically exist?
 * OUTLINE chip — deliberately distinct from the filled model-status language,
 * because the two statuses are independent (Verified + Conceptual is valid
 * and must read as "correct mechanics, assumed topology", never as exact).
 */
export function TopologyStatusBadge({ status, className }: { status: TopologyStatus; className?: string }) {
  const config = TOPOLOGY_STATUS_CONFIG[status];
  return (
    <StatusChip
      icon={config.icon}
      title={config.title}
      className={cn(config.className, className)}
      data-topology-status={status}
    >
      {config.label}
    </StatusChip>
  );
}
