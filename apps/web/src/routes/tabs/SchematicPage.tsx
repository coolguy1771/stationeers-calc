import {
  definitionById,
  instanceById,
  mockDeviceInstances,
  mockDiagnostics,
  mockIntentTopology,
  mockIntents,
} from '../../mocks';
import { DiagnosticsPanel } from '../../components/DiagnosticsPanel';
import { IntentStatusChip } from '../../components/status/IntentStatusChip';
import { Placeholder } from '../../components/Placeholder';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

/**
 * Schematic tab (spec 3.1). The React Flow canvas is a mount point only —
 * React Flow never becomes the authoritative data model (spec 2.2). The right
 * rail previews the intent/connection inspector: intents are canonical stored
 * entities (3.3); their topology status is derived, never stored (9.1).
 */
export function SchematicPage() {
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
            {mockIntents.map((intent) => {
              const fromInstance = instanceById(intent.from.instanceId);
              const toInstance = instanceById(intent.to.instanceId);
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
              {mockDeviceInstances.length} device instances in the mock project · selecting syncs across both
              editors (SYNC-004).
            </p>
          </CardContent>
        </Card>

        <DiagnosticsPanel diagnostics={mockDiagnostics} />
      </aside>
    </div>
  );
}
