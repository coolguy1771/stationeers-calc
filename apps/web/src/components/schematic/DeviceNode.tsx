import type { ConnectionMedium, DefinitionId, EntityId } from '@stationeers/domain';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { mediumColor, mediumLabel } from '../../lib/mediums';
import { cn } from '../../lib/utils';

/**
 * Schematic device node (spec 3.1, 4.3): definition name, unplaced badge, and
 * one typed port handle per instance port.
 *
 * The node is a pure projection of one `DeviceInstance` — it owns no project
 * data (2.2). Port sides alternate purely to shorten edges; a handle side never
 * means flow direction (3.1: edges are connectivity, not flow).
 */
export interface SchematicPortView {
  /** Instance port id — also the React Flow handle id the intent references. */
  readonly id: EntityId;
  readonly label: string;
  /** `undefined` when the pinned data no longer declares the port (6.5). */
  readonly medium?: ConnectionMedium;
  readonly side: 'left' | 'right';
}

export interface DeviceNodeData extends Record<string, unknown> {
  readonly instanceId: EntityId;
  readonly label: string;
  readonly definitionId: DefinitionId;
  /** False = no placement claimed; shown as "unplaced" (3.3, SYNC-001). */
  readonly placed: boolean;
  readonly ports: readonly SchematicPortView[];
}

export type DeviceNodeType = Node<DeviceNodeData, 'device'>;

export const DEVICE_NODE_WIDTH = 216;

/* Handle positions are computed from the fixed row geometry below so a port
 * row and its handle always line up, in the browser and in tests. */
const HEADER_HEIGHT = 43;
const PORT_ROW_HEIGHT = 22;

function handleTop(index: number): number {
  return HEADER_HEIGHT + PORT_ROW_HEIGHT * index + PORT_ROW_HEIGHT / 2;
}

export function DeviceNode({ data, selected }: NodeProps<DeviceNodeType>) {
  return (
    <div
      className={cn(
        'rounded-md border bg-card text-left shadow-sm transition-colors',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      )}
      style={{ width: DEVICE_NODE_WIDTH }}
      data-instance-id={data.instanceId}
    >
      <div className="border-b border-border/60 px-2.5 py-1.5">
        <div className="flex h-4 items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold leading-none">{data.label}</span>
          {data.placed ? null : (
            <span
              className="shrink-0 rounded-sm border border-dashed border-amber-600/60 px-1 font-mono text-[9px] leading-3 tracking-wide text-amber-700 uppercase dark:text-amber-300"
              title="No physical placement: schematic-only instance (SYNC-001)"
              data-unplaced="true"
            >
              unplaced
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] leading-3 text-muted-foreground">
          {data.definitionId}
        </p>
      </div>

      <ul className="px-2.5">
        {data.ports.map((port) => (
          <li
            key={port.id}
            className="flex items-center gap-1.5"
            style={{ height: PORT_ROW_HEIGHT }}
            title={`${port.label} · ${mediumLabel(port.medium)} · ${port.id}`}
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: mediumColor(port.medium) }}
            />
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {port.label}
            </span>
          </li>
        ))}
        {data.ports.length === 0 ? (
          <li className="py-1.5 text-[10px] text-muted-foreground">no ports declared</li>
        ) : null}
      </ul>

      {data.ports.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={port.side === 'left' ? Position.Left : Position.Right}
          className="size-2.5 nodrag"
          style={{
            top: handleTop(index),
            background: mediumColor(port.medium),
            borderColor: mediumColor(port.medium),
          }}
          title={`${port.label} — ${mediumLabel(port.medium)}`}
          data-port-medium={port.medium ?? 'unknown'}
        />
      ))}
    </div>
  );
}
