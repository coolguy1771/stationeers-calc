import type {
  ConnectionIntent,
  ConnectionMedium,
  EntityId,
  PortRef,
  Project,
} from '@stationeers/domain';
import { MEDIUM_LABEL } from '../lib/mediums';
import {
  describePortRef,
  instanceById,
  instanceLabel,
  portDefinition,
  samePortPair,
} from './deviceCatalog';

/**
 * Editor rules for schematic authoring (spec 3.4, 4.3, 7.3, 8).
 *
 * Pure checks and entity builders: the UI decides WHEN to ask, the canonical
 * store decides what a command may change. Nothing here mutates the project or
 * dispatches a command.
 */

/** Stable §8-style codes for refused connections. */
export const ConnectionRejectionCode = {
  EndpointMissing: 'CONN-ENDPOINT-MISSING',
  SameInstance: 'CONN-SELF',
  MediumMismatch: 'CONN-MEDIUM-MISMATCH',
  DuplicateIntent: 'CONN-DUPLICATE-INTENT',
  AlreadyRouted: 'CONN-ALREADY-ROUTED',
} as const;

export type ConnectionRejectionCode =
  (typeof ConnectionRejectionCode)[keyof typeof ConnectionRejectionCode];

export interface ConnectionRejection {
  readonly ok: false;
  readonly code: ConnectionRejectionCode;
  /** Inline reason shown to the user; never a bare code. */
  readonly reason: string;
}

export interface ConnectionApproval {
  readonly ok: true;
  readonly medium: ConnectionMedium;
  readonly from: PortRef;
  readonly to: PortRef;
}

export type PortConnectionCheck = ConnectionApproval | ConnectionRejection;

/**
 * Validates a handle→handle connection before an intent is authored.
 *
 * Media must match (4.3): a gas pipe cannot join an electrical port, and the
 * refusal names both endpoints. Re-declaring an existing intent or an existing
 * physical route is refused as redundant rather than silently duplicated
 * (intents are optional, SYNC-014).
 */
export function checkPortConnection(
  project: Project,
  from: PortRef,
  to: PortRef,
): PortConnectionCheck {
  const fromPort = portDefinition(project, from);
  const toPort = portDefinition(project, to);
  if (fromPort === undefined || toPort === undefined) {
    const unresolved = fromPort === undefined ? describePortRef(project, from) : describePortRef(project, to);
    return {
      ok: false,
      code: ConnectionRejectionCode.EndpointMissing,
      reason: `Cannot connect: ${unresolved}.`,
    };
  }
  if (from.instanceId === to.instanceId) {
    const instance = instanceById(project, from.instanceId);
    return {
      ok: false,
      code: ConnectionRejectionCode.SameInstance,
      reason: `Cannot connect ${instance === undefined ? 'a device' : instanceLabel(instance)} to itself; an intent joins two different components.`,
    };
  }
  if (fromPort.medium !== toPort.medium) {
    return {
      ok: false,
      code: ConnectionRejectionCode.MediumMismatch,
      reason: `${describePortRef(project, from)} is ${MEDIUM_LABEL[fromPort.medium]}, but ${describePortRef(
        project,
        to,
      )} is ${MEDIUM_LABEL[toPort.medium]}; connection media must match (spec 4.3).`,
    };
  }
  if (project.intents.some((intent) => samePortPair([intent.from, intent.to], from, to))) {
    return {
      ok: false,
      code: ConnectionRejectionCode.DuplicateIntent,
      reason: 'An intent between these two ports already exists.',
    };
  }
  if (project.connections.some((connection) => samePortPair(connection.endpoints, from, to))) {
    return {
      ok: false,
      code: ConnectionRejectionCode.AlreadyRouted,
      reason: 'These ports are already joined by a physical connection; an intent is optional (SYNC-014).',
    };
  }
  return { ok: true, medium: fromPort.medium, from, to };
}

/** The intent a connection authors, ready for the `addEntity` command. */
export type IntentCreation =
  | { readonly ok: true; readonly intent: ConnectionIntent }
  | ConnectionRejection;

export function createConnectionIntent(
  project: Project,
  from: PortRef,
  to: PortRef,
  id: EntityId,
): IntentCreation {
  const check = checkPortConnection(project, from, to);
  if (!check.ok) return check;
  return { ok: true, intent: { id, medium: check.medium, from: check.from, to: check.to } };
}

/**
 * What deleting a device removes, and whether it needs the SYNC-011/012
 * confirmation. The store still owns the final say (it refuses while physical
 * connections or scenario references remain, SYNC-009); this only decides
 * whether to ask first.
 */
export interface DeviceDeletionImpact {
  readonly deviceId: EntityId;
  readonly label: string;
  readonly intentIds: readonly EntityId[];
  readonly hasInventory: boolean;
  readonly hasSettings: boolean;
  /** What the user is about to lose, one line each. */
  readonly reasons: readonly string[];
  readonly requiresConfirmation: boolean;
}

export function deviceDeletionImpact(
  project: Project,
  deviceId: EntityId,
): DeviceDeletionImpact | undefined {
  const device = project.devices.find((candidate) => candidate.id === deviceId);
  if (device === undefined) return undefined;
  const intentIds = project.intents
    .filter((intent) => intent.from.instanceId === deviceId || intent.to.instanceId === deviceId)
    .map((intent) => intent.id);
  const hasInventory = device.inventory !== undefined;
  const hasSettings = Object.keys(device.settings).length > 0;
  const reasons: string[] = [];
  if (intentIds.length > 0) {
    reasons.push(
      `${intentIds.length} connection intent${intentIds.length === 1 ? '' : 's'} will be removed in the same command (SYNC-013).`,
    );
  }
  if (hasInventory) {
    reasons.push('The instance holds inventory state, which is discarded (SYNC-009).');
  }
  if (hasSettings) {
    reasons.push('The instance has non-default device settings, which are discarded (SYNC-011).');
  }
  return {
    deviceId,
    label: instanceLabel(device),
    intentIds,
    hasInventory,
    hasSettings,
    reasons,
    requiresConfirmation: reasons.length > 0,
  };
}
