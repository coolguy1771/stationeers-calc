import type { DeviceInstance, EntityId } from '@stationeers/domain';
import { definitionById, mockDiagnostics, mockIntentTopology } from '../../mocks';
import { DiagnosticsPanel } from '../../components/DiagnosticsPanel';
import { IntentStatusChip } from '../../components/status/IntentStatusChip';
import { Placeholder } from '../../components/Placeholder';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { useProject } from '../../state/projectStore';

/**
 * Schematic tab (spec 3.1). The React Flow canvas is a mount point only — React
 * Flow never becomes the authoritative data model (spec 2.2). The right rail
 * previews the intent inspector and reads intents and device instances straight
 * from the canonical store: intents are canonical stored entities (3.3) and
 * their topology status stays DERIVED, never stored (9.1) — the display map in
 * `src/mocks/intents.ts` stands in for that derivation until DOM-01.
 */
export function SchematicPage() {
  const project = useProject();
  const instancesById = new Map<EntityId, DeviceInstance>(
    project.devices.map((instance) => [instance.id, instance]),
  );

  return (
    <div className="flex h-full min-h-0 gap-3">
      <Placeholder
        className="min-h-64"
        title="Schematic canvas — React Flow mounts here"
        seam="UI-02 · schematic editor with typed connections and intents (spec 3.1). The canvas is a projection; project data stays in the canonical store (spec 2.2, FND-04)."
        plannedFeatures={[
          'Device nodes with typed connection ports',
          'Pipes, electrical, and data-network connections',
          'Subsystems and reusable groups',
          'Device settings editor',
          'Network inspection',
          'Automatic logical network resolution (DOM-01)',
          'Connection validation and error/warning highlighting',
          'Undo/redo (canonical command log, spec 2.2.1)',
          'Automatic diagram layout',
        ]}
      />

      <aside className="flex w-84 min-h-0 shrink-0 flex-col gap-3 overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">
              Connection intents
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {project.intents.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No connection intents in the project. Intents are optional (SYNC-014).
              </p>
            ) : null}
            {project.intents.map((intent) => {
              const fromInstance = instancesById.get(intent.from.instanceId);
              const toInstance = instancesById.get(intent.to.instanceId);
              const fromName = fromInstance ? definitionById(fromInstance.definitionId)?.displayName : undefined;
              const toName = toInstance ? definitionById(toInstance.definitionId)?.displayName : undefined;
              return (
                <div key={intent.id} className="rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{intent.label ?? intent.id}</span>
                    <IntentStatusChip status={mockIntentTopology[intent.id] ?? 'unrouted'} />
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                    {fromName ?? intent.from.instanceId} · {intent.from.portId}
                    <br />→ {toName ?? intent.to.instanceId} · {intent.to.portId}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    medium <span className="font-mono uppercase">{intent.medium}</span> · canonical stored
                    entity, status derived (spec 9.1)
                  </p>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">
              {project.devices.length} device instances in the project · selecting syncs across
              both editors (SYNC-004).
            </p>
          </CardContent>
        </Card>

        <DiagnosticsPanel diagnostics={mockDiagnostics} />
      </aside>
    </div>
  );
}
