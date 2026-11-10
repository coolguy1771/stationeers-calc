import type {
  ConnectionMedium,
  DefinitionId,
  DeviceDefinition,
  DeviceInstance,
  EntityId,
  PortDefinition,
  PortInstance,
  PortRef,
  Project,
} from '@stationeers/domain';
import { definitionById } from '../mocks';
import { newEntityId } from '../lib/ids';

/**
 * Device definitions + instance/port lookup for the editors (spec 3.3, 4.3).
 *
 * Seam (EXT-03): definitions still come from the mock catalog in `src/mocks/`.
 * This module is the only place the editors ask for a definition, so the pack
 * loader replaces the `definitionById` import here and nowhere else. A missing
 * definition or port is reported as `undefined` — never guessed (4.7, 6.5).
 */
export { definitionById };

/** Display name of an instance's definition, falling back to its id. */
export function instanceLabel(instance: DeviceInstance): string {
  return definitionById(instance.definitionId)?.displayName ?? instance.definitionId;
}

export function instanceById(project: Project, instanceId: EntityId): DeviceInstance | undefined {
  return project.devices.find((instance) => instance.id === instanceId);
}

/** The instance's stored port, or `undefined` when the intent endpoint is stale. */
export function instancePort(project: Project, ref: PortRef): PortInstance | undefined {
  return instanceById(project, ref.instanceId)?.ports.find((port) => port.id === ref.portId);
}

/**
 * The definition port an instance port instantiates. `undefined` means the
 * pinned pack no longer declares it (retargeted/imported project, SYNC-009).
 */
export function portDefinition(project: Project, ref: PortRef): PortDefinition | undefined {
  const port = instancePort(project, ref);
  if (port === undefined) return undefined;
  const instance = instanceById(project, ref.instanceId);
  if (instance === undefined) return undefined;
  return definitionById(instance.definitionId)?.ports.find(
    (definitionPort) => definitionPort.id === port.definitionId,
  );
}

export function portMedium(project: Project, ref: PortRef): ConnectionMedium | undefined {
  return portDefinition(project, ref)?.medium;
}

/** Compact port name for nodes/lists; the full id stays available as a title. */
export function portShortLabel(definitionId: DefinitionId | undefined, fallback: EntityId): string {
  if (definitionId === undefined) return fallback;
  const segments = definitionId.split('.');
  return segments[segments.length - 1] ?? definitionId;
}

/** True when both references name the same port of the same instance. */
export function samePortRef(a: PortRef, b: PortRef): boolean {
  return a.instanceId === b.instanceId && a.portId === b.portId;
}

/** True when two endpoint tuples name the same two ports, in either direction. */
export function samePortPair(
  endpoints: readonly [PortRef, PortRef],
  from: PortRef,
  to: PortRef,
): boolean {
  const [a, b] = endpoints;
  return (samePortRef(a, from) && samePortRef(b, to)) || (samePortRef(a, to) && samePortRef(b, from));
}

/**
 * An endpoint resolves when its device, its port instance, AND the definition
 * port that instance instantiates all exist. A retargeted pack that dropped a
 * port therefore surfaces as missing, never as a silent drop (SYNC-009).
 */
export function portRefResolves(project: Project, ref: PortRef): boolean {
  return portDefinition(project, ref) !== undefined;
}

/** Names what an unresolved endpoint is missing, for diagnostics and refusals. */
export function describePortRef(project: Project, ref: PortRef): string {
  const instance = instanceById(project, ref.instanceId);
  if (instance === undefined) return `device ${ref.instanceId} no longer exists`;
  const port = instancePort(project, ref);
  if (port === undefined) {
    return `port ${ref.portId} no longer exists on ${instanceLabel(instance)}`;
  }
  const definitionPort = definitionById(instance.definitionId)?.ports.find(
    (candidate) => candidate.id === port.definitionId,
  );
  if (definitionPort === undefined) {
    return `port ${ref.portId} names definition port ${port.definitionId}, which the pinned data no longer declares`;
  }
  return `${instanceLabel(instance)} · ${portShortLabel(definitionPort.id, ref.portId)}`;
}

/**
 * A new unplaced engineering component (SYNC-001): no `placementId`, settings
 * empty. Port instances carry the definition port id they instantiate so a
 * retargeted pack can resolve them (4.3, SYNC-009).
 */
export function createDeviceInstance(
  definition: DeviceDefinition,
  id: EntityId = newEntityId('inst'),
): DeviceInstance {
  return {
    id,
    definitionId: definition.id,
    ports: definition.ports.map((port) => ({
      id: `${id}:${port.id}`,
      definitionId: port.id,
    })),
    settings: {},
  };
}
