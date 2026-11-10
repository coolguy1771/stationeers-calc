import { Plus } from 'lucide-react';
import type { DeviceDefinition } from '@stationeers/domain';
import { mockCatalog } from '../../mocks';
import { mediumLabel } from '../../lib/mediums';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { createDeviceInstance } from '../../state/deviceCatalog';
import { runProjectCommand } from '../../state/projectStore';
import { deviceSelection, useSelect } from '../../state/selection';

/**
 * Catalog palette for the schematic editor (spec 3.1, 7.3 "place component
 * instances"). Adding a definition creates an UNPLACED instance (SYNC-001) —
 * no placement is fabricated until the physical editor owns one (UI-03).
 */
export function InstancePalette() {
  const select = useSelect();

  function addInstance(definition: DeviceDefinition): void {
    const instance = createDeviceInstance(definition);
    const result = runProjectCommand({
      type: 'addEntity',
      collection: 'devices',
      entity: instance,
    });
    if (result.ok) select(deviceSelection(instance.id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">Catalog</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {mockCatalog.map(({ definition }) => (
          <div key={definition.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{definition.displayName}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {definition.id} · {definition.ports.map((port) => mediumLabel(port.medium)).join('/')}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Add ${definition.displayName}`}
              onClick={() => addInstance(definition)}
            >
              <Plus aria-hidden />
              Add
            </Button>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground/70">
          Instances start unplaced: schematic-only until placed in the physical layout (SYNC-001/002).
        </p>
      </CardContent>
    </Card>
  );
}
