import type { DeviceInstance } from '@stationeers/domain';
import { cn } from '../lib/utils';
import { instanceLabel } from '../state/deviceCatalog';
import { DeviceInstanceChip } from './DeviceInstanceChip';

/**
 * Device instances of the canonical project, selectable (SYNC-004). The
 * schematic and the physical layout render the same list over the same shared
 * selection; only the surrounding chrome differs.
 */
export function DeviceInstanceList({ instances }: { instances: readonly DeviceInstance[] }) {
  if (instances.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No device instances in the project yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {instances.map((instance) => {
        const placed = instance.placementId !== undefined;
        return (
          <li key={instance.id} className="flex items-center justify-between gap-2">
            <DeviceInstanceChip instanceId={instance.id} label={instanceLabel(instance)} />
            <span
              className={cn(
                'font-mono text-[10px]',
                placed ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-300',
              )}
            >
              {placed ? 'placed' : 'unplaced'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
