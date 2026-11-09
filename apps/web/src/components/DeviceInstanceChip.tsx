import type { EntityId } from '@stationeers/domain';
import { cn } from '../lib/utils';
import { deviceSelection, isSelected, useSelect, useSelection } from '../state/selection';

/**
 * Selectable device instance (SYNC-004): the catalog and both editors render the
 * same chip, so selecting an instance anywhere selects the same underlying
 * instance everywhere. Clicks toggle — a second click clears the selection.
 */
export function DeviceInstanceChip({
  instanceId,
  label,
  className,
}: {
  instanceId: EntityId;
  label: string;
  className?: string;
}) {
  const selection = useSelection();
  const select = useSelect();
  const selected = isSelected(selection, 'device-instance', instanceId);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={instanceId}
      onClick={() => select(selected ? null : deviceSelection(instanceId))}
      className={cn(
        'rounded-full border px-2 py-0.5 text-left font-mono text-[10px] transition-colors',
        selected
          ? 'border-primary text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {label}
    </button>
  );
}
