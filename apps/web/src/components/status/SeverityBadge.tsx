import type { Severity } from '@stationeers/domain';
import { cn } from '../../lib/utils';
import { StatusChip } from './StatusChip';
import { SEVERITY_CONFIG } from './statusConfig';

/** Diagnostic severity (spec 8): error / warning / info, filled chips. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <StatusChip
      icon={config.icon}
      title={config.title}
      className={cn(config.className, className)}
      data-severity={severity}
    >
      {config.label}
    </StatusChip>
  );
}
