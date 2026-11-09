import { Trash2 } from 'lucide-react';
import type { ConnectionIntent, DeviceInstance, EntityId } from '@stationeers/domain';
import { definitionById, mockDiagnostics, mockIntentTopology } from '../../mocks';
import { DeviceInstanceList } from '../../components/DeviceInstanceList';
import { DiagnosticsPanel } from '../../components/DiagnosticsPanel';
import { IntentStatusChip } from '../../components/status/IntentStatusChip';
import { Placeholder } from '../../components/Placeholder';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { runProjectCommand, useProject } from '../../state/projectStore';

/**
 * Schematic tab (spec 3.1). The React Flow canvas is a mount point only — React
 * Flow never becomes the authoritative data model (spec 2.2). The right rail
 * previews the intent inspector and reads intents and device instances straight
 * from the canonical store: intents are canonical stored entities (3.3) and
 * their topology status stays DERIVED, never stored (9.1) — the display map in
 * `src/mocks/intents.ts` stands in for that derivation until DOM-01.
 *
 * Deleting an intent is a real command (`removeEntity`), so it bumps the
 * revision, is written by autosave, and is undone by the shell's undo/redo —
 * the smallest honest proof that the command loop is wired end to end.
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
              Devices
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <DeviceInstanceList instances={project.devices} />
            <p className="text-[11px] text-muted-foreground">
              Selecting an instance here selects it in the physical layout too (SYNC-004).
            </p>
          </CardContent>
        </Card>

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
                    <div className="flex items-center gap-1">
                      <IntentStatusChip status={mockIntentTopology[intent.id] ?? 'unrouted'} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete intent ${intent.label ?? intent.id}`}
                        onClick={() => deleteIntent(intent)}
                      >
                        <Trash2 aria-hidden className="size-3" />
                      </Button>
                    </div>
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
              {project.intents.length} intent(s) · canonical stored entities, deletable as one undoable
              command (2.2.1).
            </p>
          </CardContent>
        </Card>

        <DiagnosticsPanel diagnostics={mockDiagnostics} />
      </aside>
    </div>
  );
}

/** Intent deletion is one undoable command (2.2.1); the store owns the cascade rules. */
function deleteIntent(intent: ConnectionIntent): void {
  runProjectCommand({ type: 'removeEntity', collection: 'intents', id: intent.id });
}
