import type { EntityId, NodePosition, Project } from '@stationeers/domain';
import { dispatchProjectCommand, projectStore } from './projectStore';

/**
 * Schematic layout (spec 9.1 "schematic layout metadata", 3.1 "automatic
 * diagram layout").
 *
 * Positions are PRESENTATION metadata stored in `Project.schematicLayout`:
 * they survive undo/redo and reload, but they are not part of the engineering
 * model. A node without a stored position gets a deterministic derived slot,
 * so layout is never authoritative data — only a dragged position is stored.
 *
 * Drags are coalesced and committed through `setNodePosition` commands after a
 * short idle period, so one drag is one undo step instead of one per frame.
 */
export const NODE_POSITION_DEBOUNCE_MS = 250;

/** Derived layout grid: columns before wrapping, then spacing in px. */
const GRID_COLUMNS = 4;
const COLUMN_SPACING = 280;
const ROW_SPACING = 190;

/** Deterministic slot for the n-th node whose position was never stored. */
export function defaultNodePosition(index: number): NodePosition {
  return {
    x: (index % GRID_COLUMNS) * COLUMN_SPACING,
    y: Math.floor(index / GRID_COLUMNS) * ROW_SPACING,
  };
}

/** Stored position, or the derived slot when the user never dragged the node. */
export function nodePositionFor(
  project: Project,
  instanceId: EntityId,
  index: number,
): NodePosition {
  return project.schematicLayout.nodePositions[instanceId] ?? defaultNodePosition(index);
}

let pending = new Map<EntityId, NodePosition>();
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Queues dragged positions and commits them after a short idle period. Safe to
 * call per drag event: only the last position per node survives.
 */
export function scheduleNodePositions(
  entries: Iterable<readonly [EntityId, NodePosition]>,
): void {
  for (const [entityId, position] of entries) pending.set(entityId, position);
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(flushNodePositions, NODE_POSITION_DEBOUNCE_MS);
}

/**
 * Commits every queued position now (drag stop, unmount, tests). Rejections are
 * ignored on purpose: layout is presentation metadata, so a node deleted
 * between drag and flush must not produce an error toast; the engineering
 * command path keeps its own, loud, validation.
 */
export function flushNodePositions(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (pending.size === 0) return;
  const entries = [...pending];
  pending = new Map();
  for (const [entityId, position] of entries) {
    const current = projectStore.state.schematicLayout.nodePositions[entityId];
    if (current !== undefined && current.x === position.x && current.y === position.y) continue;
    dispatchProjectCommand({ type: 'setNodePosition', entityId, position });
  }
}

/** Drops queued positions without committing them (unmount in tests, reload). */
export function cancelScheduledNodePositions(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  pending = new Map();
}
