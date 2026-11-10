import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EntityId, Project } from '@stationeers/domain';
import { toast } from 'sonner';
import { mediumColor, mediumLabel } from '../../lib/mediums';
import { newEntityId } from '../../lib/ids';
import { cn } from '../../lib/utils';
import { deviceSelection, type SelectionRef } from '../../state/selection';
import { instanceLabel, portDefinition, portShortLabel } from '../../state/deviceCatalog';
import type { IntentStatusEntry } from '../../state/intentTopology';
import { createConnectionIntent } from '../../state/schematicEditing';
import {
  flushNodePositions,
  nodePositionFor,
  scheduleNodePositions,
} from '../../state/schematicLayout';
import { dispatchProjectCommand } from '../../state/projectStore';
import { useThemeStore } from '../../state/themeStore';
import { DeviceNode, type DeviceNodeData, type DeviceNodeType, type SchematicPortView } from './DeviceNode';

/**
 * Schematic canvas (spec 3.1, 2.2, 9.1).
 *
 * React Flow renders a PROJECTION of the canonical project: nodes are device
 * instances, edges are either derived physical connections or stored intents.
 * It is never the model — drags become `setNodePosition` commands, connections
 * become `addEntity` intent commands, and every render is rebuilt from the
 * store (2.2, 2.2.1).
 */
const NODE_TYPES: NodeTypes = { device: DeviceNode };

const EMPTY_STATE_FEATURES = [
  'Device nodes with typed connection ports',
  'Pipes, electrical, and data-network connections',
  'Subsystems and reusable groups',
  'Device settings editor',
  'Network inspection',
  'Automatic logical network resolution (DOM-01)',
  'Connection validation and error/warning highlighting',
  'Undo/redo (canonical command log, spec 2.2.1)',
  'Automatic diagram layout',
] as const;

export interface SchematicCanvasProps {
  readonly project: Project;
  readonly statuses: ReadonlyMap<EntityId, IntentStatusEntry>;
  readonly selection: SelectionRef;
  readonly onSelect: (selection: SelectionRef) => void;
}

interface ConnectionFeedback {
  readonly tone: 'ok' | 'error';
  readonly message: string;
}

/** Devices → nodes, with stored positions or the deterministic derived slot. */
function buildDeviceNodes(project: Project): DeviceNodeType[] {
  return project.devices.map((instance, index) => {
    const ports: SchematicPortView[] = instance.ports.map((port, portIndex) => ({
      id: port.id,
      label: portShortLabel(port.definitionId, port.id),
      medium: portDefinition(project, { instanceId: instance.id, portId: port.id })?.medium,
      // Alternating sides shorten edges; never a flow direction (3.1).
      side: portIndex % 2 === 0 ? 'left' : 'right',
    }));
    const data: DeviceNodeData = {
      instanceId: instance.id,
      label: instanceLabel(instance),
      definitionId: instance.definitionId,
      placed: instance.placementId !== undefined,
      ports,
    };
    return { id: instance.id, type: 'device', position: nodePositionFor(project, instance.id, index), data };
  });
}

/**
 * Derived physical edges (3.3): solid, because the physical layout is
 * authoritative. They are shown but not editable here — routing belongs to the
 * physical editor (UI-03/UI-04).
 */
function buildConnectionEdges(project: Project): Edge[] {
  return project.connections.map((connection) => {
    const [from, to] = connection.endpoints;
    return {
      id: connection.id,
      source: from.instanceId,
      sourceHandle: from.portId,
      target: to.instanceId,
      targetHandle: to.portId,
      type: 'smoothstep',
      style: { stroke: mediumColor(connection.medium), strokeWidth: 2 },
      data: { connectionId: connection.id, medium: connection.medium },
    } satisfies Edge;
  });
}

/** Intent overlay edges (3.3): dashed declarations, colored by derived status. */
function buildIntentEdges(
  project: Project,
  statuses: ReadonlyMap<EntityId, IntentStatusEntry>,
  selection: SelectionRef,
): Edge[] {
  return project.intents.map((intent) => {
    const status = statuses.get(intent.id)?.status ?? 'unrouted';
    const stroke =
      status === 'conflicting' ? '#f87171' : status === 'routed-with-warnings' ? '#fbbf24' : mediumColor(intent.medium);
    return {
      id: intent.id,
      source: intent.from.instanceId,
      sourceHandle: intent.from.portId,
      target: intent.to.instanceId,
      targetHandle: intent.to.portId,
      type: 'smoothstep',
      selected: selection?.kind === 'intent' && selection.id === intent.id,
      label: intent.label,
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 2,
      labelStyle: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--color-muted-foreground)' },
      labelBgStyle: { fill: 'var(--color-card)', fillOpacity: 0.85 },
      style: {
        stroke,
        strokeWidth: 1.75,
        strokeDasharray: status === 'conflicting' ? '2 4' : '7 4',
      },
      data: { intentId: intent.id, intentStatus: status, medium: intent.medium },
    } satisfies Edge;
  });
}

function sameIdList(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function SchematicCanvas({ project, statuses, selection, onSelect }: SchematicCanvasProps) {
  const theme = useThemeStore((state) => state.theme);
  const [nodes, setNodes] = useState<DeviceNodeType[]>(() => buildDeviceNodes(project));
  const [selectedIds, setSelectedIds] = useState<readonly EntityId[]>([]);
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);

  // One revision of the canonical project → one rebuild of the projection.
  useEffect(() => {
    setNodes(buildDeviceNodes(project));
  }, [project]);

  // External selection (list chips, physical tab, intents panel) drives node
  // highlighting; multi-selection keeps its extra ids until the selection moves.
  useEffect(() => {
    const selectedId = selection?.kind === 'device-instance' ? selection.id : null;
    setSelectedIds((current) => {
      if (selectedId === null) return current.length === 0 ? current : [];
      return current.includes(selectedId) ? current : [selectedId];
    });
  }, [selection]);

  // A pending drag is committed when the canvas goes away (tab switch).
  useEffect(() => () => flushNodePositions(), []);

  const displayNodes = useMemo(
    () => nodes.map((node) => ({ ...node, selected: selectedIds.includes(node.id) })),
    [nodes, selectedIds],
  );

  const edges = useMemo(
    () => [
      ...buildConnectionEdges(project),
      ...buildIntentEdges(project, statuses, selection),
    ],
    [project, statuses, selection],
  );

  const handleNodesChange = useCallback((changes: NodeChange<DeviceNodeType>[]) => {
    // Selection is shared with the other views (SYNC-004), so it is applied
    // from one place; React Flow's own select changes are ignored.
    const positional = changes.filter((change) => change.type !== 'select');
    if (positional.length === 0) return;
    setNodes((current) => applyNodeChanges(positional, current));
  }, []);

  // Multi-selection is transient view state: React Flow reports the whole
  // selection and the component keeps it for highlighting. The SHARED selection
  // (SYNC-004) is written by explicit gestures only (node click, pane click,
  // edge click). Feeding React Flow's own selection events back into it loops:
  // while the controlled nodes prop reconciles, React Flow re-emits selections,
  // including transient empty ones.
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams<DeviceNodeType>) => {
      const ids = selectedNodes.map((node) => node.id);
      if (ids.length === 0) return;
      setSelectedIds((current) => (sameIdList(current, ids) ? current : ids));
    },
    [],
  );

  const handleNodeDragStop: OnNodeDrag<DeviceNodeType> = useCallback((_event, _node, dragged) => {
    scheduleNodePositions(dragged.map((node) => [node.id, node.position] as const));
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (source === null || target === null || sourceHandle === null || targetHandle === null) return;
      const from = { instanceId: source, portId: sourceHandle };
      const to = { instanceId: target, portId: targetHandle };
      const creation = createConnectionIntent(project, from, to, newEntityId('intent'));
      if (!creation.ok) {
        setFeedback({ tone: 'error', message: creation.reason });
        toast.error(creation.code, { description: creation.reason });
        return;
      }
      const result = dispatchProjectCommand({
        type: 'addEntity',
        collection: 'intents',
        entity: creation.intent,
      });
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.error.message });
        toast.error(result.error.code, { description: result.error.message });
        return;
      }
      setFeedback({
        tone: 'ok',
        message: `Intent created (${mediumLabel(creation.intent.medium)}). No physical route yet — shown as Unrouted (SYNC-007/014).`,
      });
      onSelect({ kind: 'intent', id: creation.intent.id });
    },
    [onSelect, project],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const intentId = edge.data?.intentId;
      if (typeof intentId === 'string') {
        onSelect({ kind: 'intent', id: intentId });
        return;
      }
      toast.info('Physical connection', {
        description: 'This edge is derived from the physical layout; edit the route in the physical editor (UI-04).',
      });
    },
    [onSelect],
  );

  const isEmpty = project.devices.length === 0;

  return (
    <div
      role="region"
      aria-label="Schematic canvas"
      className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background"
    >
      <ReactFlow<DeviceNodeType>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onNodeDragStart={(_event, node) => onSelect(deviceSelection(node.id))}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_event, node) => onSelect(deviceSelection(node.id))}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
        onPaneClick={() => onSelect(null)}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: 'var(--color-primary)', strokeDasharray: '4 3' }}
        deleteKeyCode={null}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => (node.data as DeviceNodeData | undefined)?.placed === false ? '#b45309' : '#475569'}
          maskColor="rgba(0, 0, 0, 0.6)"
        />
      </ReactFlow>

      {feedback === null ? null : (
        <div className="absolute inset-x-3 top-3 z-10 flex justify-center">
          <div
            className={cn(
              'pointer-events-auto flex max-w-xl items-start gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-[11px]',
              feedback.tone === 'error'
                ? 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            )}
          >
            <p role="status" aria-live="polite" data-connection-feedback={feedback.tone}>
              {feedback.message}
            </p>
            <button
              type="button"
              aria-label="Dismiss connection message"
              className="shrink-0 rounded-sm px-1 opacity-70 hover:opacity-100"
              onClick={() => setFeedback(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {isEmpty ? <SchematicEmptyState /> : null}
    </div>
  );
}

/** Empty project: the canvas stays mounted (adding a device fills it) with the §3.1 feature list. */
function SchematicEmptyState() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="max-w-xl rounded-md border border-dashed border-border bg-background/90 p-6 text-center">
        <p className="text-sm font-medium">Schematic canvas — add a device to begin</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a definition in the catalog palette. Instances start unplaced and stay editable here
          (SYNC-001); intents are optional and valid without a physical route (SYNC-014).
        </p>
        <p className="mt-3 text-[10px] tracking-wider text-muted-foreground uppercase">
          Editor capabilities (spec 3.1)
        </p>
        <ul className="mt-1 grid list-none gap-1 text-left text-xs text-muted-foreground sm:grid-cols-2">
          {EMPTY_STATE_FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-1.5">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
