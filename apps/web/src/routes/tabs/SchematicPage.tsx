import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { EntityId } from '@stationeers/domain';
import { DeviceInstanceList } from '../../components/DeviceInstanceList';
import { DiagnosticsPanel } from '../../components/DiagnosticsPanel';
import { IntentsPanel } from '../../components/schematic/IntentsPanel';
import { InstancePalette } from '../../components/schematic/InstancePalette';
import { InstanceSettingsPanel } from '../../components/schematic/InstanceSettingsPanel';
import { SchematicCanvas } from '../../components/schematic/SchematicCanvas';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { isEditableTarget } from '../../lib/dom';
import { mockDiagnostics } from '../../mocks';
import {
  deriveIntentTopology,
  INTENT_DIAGNOSTIC_CODES,
  intentDiagnostics,
} from '../../state/intentTopology';
import { runProjectCommand, useProject } from '../../state/projectStore';
import { deviceDeletionImpact } from '../../state/schematicEditing';
import { useSelect, useSelection } from '../../state/selection';

/**
 * Schematic editor (spec 3.1, 3.3, 7.3; backlog UI-02).
 *
 * The canvas is a projection of the canonical store: instances are nodes typed
 * by their ports, intents are edges whose status is DERIVED (3.5) and never
 * stored (9.1). Every edit — placement of a new instance, an intent, a setting,
 * a deletion — is one canonical command, so undo/redo restores exactly what the
 * user did (2.2.1, SYNC-010).
 */
export function SchematicPage() {
  return (
    <ReactFlowProvider>
      <SchematicWorkspace />
    </ReactFlowProvider>
  );
}

function SchematicWorkspace() {
  const project = useProject();
  const selection = useSelection();
  const select = useSelect();
  const [pendingDeleteId, setPendingDeleteId] = useState<EntityId | null>(null);

  const statuses = useMemo(() => deriveIntentTopology(project), [project]);
  const diagnostics = useMemo(
    () => [
      ...intentDiagnostics(project, statuses),
      // Intent-topology codes now come from the derivation above; the remaining
      // mocks stand in for engine output until SIM-02/SIM-03 land.
      ...mockDiagnostics.filter((diagnostic) => !INTENT_DIAGNOSTIC_CODES.includes(diagnostic.code)),
    ],
    [project, statuses],
  );

  const pendingDelete = useMemo(
    () => (pendingDeleteId === null ? undefined : deviceDeletionImpact(project, pendingDeleteId)),
    [project, pendingDeleteId],
  );

  const deleteDevice = useCallback(
    (deviceId: EntityId) => {
      // One command removes the instance and cascades its intents (SYNC-013).
      const result = runProjectCommand({ type: 'removeEntity', collection: 'devices', id: deviceId });
      if (!result.ok) return;
      setPendingDeleteId(null);
      select(null);
    },
    [select],
  );

  const requestDeviceDeletion = useCallback(
    (deviceId: EntityId) => {
      const impact = deviceDeletionImpact(project, deviceId);
      if (impact === undefined) return;
      // Confirmation only when something beyond the instance goes away
      // (SYNC-011/012): intents, inventory, or non-default settings.
      if (impact.requiresConfirmation) setPendingDeleteId(deviceId);
      else deleteDevice(deviceId);
    },
    [project, deleteDevice],
  );

  const deleteIntent = useCallback(
    (intentId: EntityId) => {
      const result = runProjectCommand({ type: 'removeEntity', collection: 'intents', id: intentId });
      if (result.ok && selection?.kind === 'intent' && selection.id === intentId) select(null);
    },
    [select, selection],
  );

  // Delete/Backspace acts on the shared selection (SYNC-004); candidate refusals
  // surface as diagnostics rather than silently doing nothing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[data-slot="dialog-content"]') !== null) return;
      if (selection === null) return;
      event.preventDefault();
      if (selection.kind === 'device-instance') requestDeviceDeletion(selection.id);
      else if (selection.kind === 'intent') deleteIntent(selection.id);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, requestDeviceDeletion, deleteIntent]);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside
        aria-label="Schematic source"
        className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto"
      >
        <InstancePalette />
        <Card>
          <CardHeader>
            <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">
              Devices
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <DeviceInstanceList instances={project.devices} />
            <p className="text-[10px] text-muted-foreground/70">
              Unplaced instances stay schematic-only (SYNC-001); selecting one selects it in the
              physical layout too (SYNC-004).
            </p>
          </CardContent>
        </Card>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Drag between port handles to declare an intent — only matching media connect (spec 4.3).
            Select a node or intent and press Delete to remove it (SYNC-012).
          </span>
          <span className="ml-auto font-mono">
            {project.devices.length} node(s) · {project.intents.length} intent(s)
          </span>
        </div>
        <SchematicCanvas
          project={project}
          statuses={statuses}
          selection={selection}
          onSelect={select}
        />
      </div>

      <aside
        aria-label="Schematic inspector"
        className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto xl:w-84"
      >
        <InstanceSettingsPanel project={project} onRequestDelete={requestDeviceDeletion} />
        <IntentsPanel project={project} statuses={statuses} onDelete={deleteIntent} />
        <DiagnosticsPanel diagnostics={diagnostics} />
      </aside>

      <Dialog
        open={pendingDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <DialogContent>
          {pendingDelete === undefined ? null : (
            <>
              <DialogHeader>
                <DialogTitle>Delete {pendingDelete.label}?</DialogTitle>
                <DialogDescription>
                  Deleting removes the instance and its placement everywhere (SYNC-012), as one
                  undoable command (SYNC-013).
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {pendingDelete.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Undo restores the instance, its settings, and its intents (SYNC-010).
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingDeleteId(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => deleteDevice(pendingDelete.deviceId)}>
                  Delete device
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
