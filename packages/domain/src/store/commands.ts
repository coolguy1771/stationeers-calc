/**
 * Editor commands for the canonical store (FND-04; spec 2.2.1, 3.4, 4.1, 8).
 *
 * A command validates itself against the current canonical state and produces
 * the patch ops for its change; the store derives the inverse structurally
 * (see `patch.ts`), so no command carries hand-written inverse logic.
 *
 * Validation is total before any op is built: a rejected command describes a
 * stable diagnostic (spec 8) and leaves state, log, and revision untouched.
 * Reference rules mirror the SYNC contracts, e.g. removing a device removes
 * its intents as part of the same undoable command (SYNC-013) and refuses
 * while physical connections or scenario settings still reference it, so no
 * operation silently discards connections, intents, inventory, or settings
 * (SYNC-009).
 */
import { z } from '../schemas/zod';
import type { Z } from '../schemas/zod';
import type {
  ConnectionIntent,
  ConstructionElement,
  DeviceInstance,
  EntityId,
  PhysicalConnection,
  PhysicalPlacement,
  PortRef,
  Project,
  ProjectSettings,
  Scenario,
  SettingValue,
} from '../entities';
import {
  ConnectionIntentSchema,
  ConstructionElementSchema,
  DeviceInstanceSchema,
  PhysicalConnectionSchema,
  PhysicalPlacementSchema,
  ScenarioSchema,
  EntityIdSchema,
  SettingValueSchema,
  displayString,
  MAX_DISPLAY_NAME_LENGTH,
} from '../schemas';
import { buildPointer } from './pointer';
import type { Patch, PatchOp } from './types';
import { StoreError, StoreErrorCode } from './errors';

/** Canonical entity collections; every member stores entities with stable `id`s (4.1). */
export const ENTITY_COLLECTIONS = [
  'devices',
  'placements',
  'construction',
  'connections',
  'intents',
  'scenarios',
] as const;

export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];

/** Entity type stored in each collection. */
export interface CollectionTypes {
  devices: DeviceInstance;
  placements: PhysicalPlacement;
  construction: ConstructionElement;
  connections: PhysicalConnection;
  intents: ConnectionIntent;
  scenarios: Scenario;
}

export type EntityOf<C extends EntityCollection> = CollectionTypes[C];

/** Single schematic node position (9.1, presentation-only layout metadata). */
export const NodePositionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();

export type NodePosition = Z.infer<typeof NodePositionSchema>;

/** Mutable `Project.settings` keys (4.1). */
export type ProjectSettingKey = keyof ProjectSettings;

/**
 * The command vocabulary. Commands are plain data so they can cross workers
 * and devtools; every mutation of the canonical state must arrive as one.
 */
export type Command =
  | { readonly type: 'addEntity'; readonly collection: 'devices'; readonly entity: DeviceInstance }
  | { readonly type: 'addEntity'; readonly collection: 'placements'; readonly entity: PhysicalPlacement }
  | { readonly type: 'addEntity'; readonly collection: 'construction'; readonly entity: ConstructionElement }
  | { readonly type: 'addEntity'; readonly collection: 'connections'; readonly entity: PhysicalConnection }
  | { readonly type: 'addEntity'; readonly collection: 'intents'; readonly entity: ConnectionIntent }
  | { readonly type: 'addEntity'; readonly collection: 'scenarios'; readonly entity: Scenario }
  | { readonly type: 'replaceEntity'; readonly collection: 'devices'; readonly id: EntityId; readonly entity: DeviceInstance }
  | { readonly type: 'replaceEntity'; readonly collection: 'placements'; readonly id: EntityId; readonly entity: PhysicalPlacement }
  | { readonly type: 'replaceEntity'; readonly collection: 'construction'; readonly id: EntityId; readonly entity: ConstructionElement }
  | { readonly type: 'replaceEntity'; readonly collection: 'connections'; readonly id: EntityId; readonly entity: PhysicalConnection }
  | { readonly type: 'replaceEntity'; readonly collection: 'intents'; readonly id: EntityId; readonly entity: ConnectionIntent }
  | { readonly type: 'replaceEntity'; readonly collection: 'scenarios'; readonly id: EntityId; readonly entity: Scenario }
  | { readonly type: 'removeEntity'; readonly collection: EntityCollection; readonly id: EntityId }
  | { readonly type: 'setDeviceSetting'; readonly deviceId: EntityId; readonly key: string; readonly value: SettingValue }
  | { readonly type: 'removeDeviceSetting'; readonly deviceId: EntityId; readonly key: string }
  | { readonly type: 'assignDevicePlacement'; readonly deviceId: EntityId; readonly placementId: EntityId }
  | { readonly type: 'unassignDevicePlacement'; readonly deviceId: EntityId }
  | { readonly type: 'setNodePosition'; readonly entityId: EntityId; readonly position: NodePosition }
  | { readonly type: 'clearNodePosition'; readonly entityId: EntityId }
  | { readonly type: 'setProjectSetting'; readonly key: ProjectSettingKey; readonly value: boolean }
  | { readonly type: 'renameProject'; readonly name: string };

const COLLECTION_LABELS: Record<EntityCollection, string> = {
  devices: 'device',
  placements: 'placement',
  construction: 'construction element',
  connections: 'connection',
  intents: 'intent',
  scenarios: 'scenario',
};

const CollectionSchema = z.enum(ENTITY_COLLECTIONS);

function parseCollection(raw: unknown): EntityCollection {
  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StoreError(
      StoreErrorCode.CommandInvalid,
      `Unknown entity collection ${JSON.stringify(raw)}.`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------- parsing --

function schemaInvalid(error: Z.ZodError, label: string): StoreError {
  const issues = error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`);
  return new StoreError(
    StoreErrorCode.SchemaInvalid,
    `${label} failed schema validation: ${issues.join('; ')}`,
    { rule: '9.4' },
  );
}

function parseDevice(raw: unknown): DeviceInstance {
  const parsed = DeviceInstanceSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'device');
  return parsed.data;
}

function parsePlacement(raw: unknown): PhysicalPlacement {
  const parsed = PhysicalPlacementSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'placement');
  return parsed.data;
}

function parseConstruction(raw: unknown): ConstructionElement {
  const parsed = ConstructionElementSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'construction element');
  return parsed.data;
}

function parseConnection(raw: unknown): PhysicalConnection {
  const parsed = PhysicalConnectionSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'connection');
  return parsed.data;
}

function parseIntent(raw: unknown): ConnectionIntent {
  const parsed = ConnectionIntentSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'intent');
  return parsed.data;
}

function parseScenario(raw: unknown): Scenario {
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'scenario');
  return parsed.data;
}

function parseNodePosition(raw: unknown): NodePosition {
  const parsed = NodePositionSchema.safeParse(raw);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'node position');
  return parsed.data;
}

// -------------------------------------------------------------- id lookup --

interface HasId {
  readonly id: EntityId;
}

function indexOfId(list: readonly HasId[], id: EntityId): number {
  return list.findIndex((entity) => entity.id === id);
}

function collectionList(project: Project, collection: EntityCollection): readonly HasId[] {
  switch (collection) {
    case 'devices': return project.devices;
    case 'placements': return project.placements;
    case 'construction': return project.construction;
    case 'connections': return project.connections;
    case 'intents': return project.intents;
    case 'scenarios': return project.scenarios;
  }
}

/** Index of `id` in a collection, or `STORE-ENTITY-MISSING`. */
function requireIndexOf(project: Project, collection: EntityCollection, id: EntityId): number {
  const index = indexOfId(collectionList(project, collection), id);
  if (index < 0) {
    throw new StoreError(
      StoreErrorCode.EntityMissing,
      `No ${COLLECTION_LABELS[collection]} with id ${JSON.stringify(id)} exists in the project.`,
      { entityIds: [id], rule: '2.2.1' },
    );
  }
  return index;
}

/** `STORE-ENTITY-EXISTS` when `id` is already stored in the collection. */
function assertIdAvailable(project: Project, collection: EntityCollection, id: EntityId): void {
  if (indexOfId(collectionList(project, collection), id) >= 0) {
    throw new StoreError(
      StoreErrorCode.EntityExists,
      `A ${COLLECTION_LABELS[collection]} with id ${JSON.stringify(id)} already exists.`,
      { entityIds: [id], rule: '2.2.1' },
    );
  }
}

// ---------------------------------------------------- reference validation --

/** Devices claim at most one placement; a placement holds at most one device (3.3, SYNC-002). */
function assertPlacementFree(
  project: Project,
  placementId: EntityId,
  excludeDeviceId: EntityId | undefined,
): void {
  const placementIndex = indexOfId(project.placements, placementId);
  if (placementIndex < 0) {
    throw new StoreError(
      StoreErrorCode.EntityMissing,
      `Device references placement ${JSON.stringify(placementId)}, which does not exist.`,
      { entityIds: [placementId], rule: '3.3' },
    );
  }
  const holder = project.devices.find(
    (device) => device.placementId === placementId && device.id !== excludeDeviceId,
  );
  if (holder !== undefined) {
    throw new StoreError(
      StoreErrorCode.PlacementInUse,
      `Placement ${JSON.stringify(placementId)} is already used by device ${JSON.stringify(holder.id)}.`,
      { entityIds: [placementId, holder.id], rule: 'SYNC-002' },
    );
  }
}

/** Port ids are local identifiers of a device (4.3); duplicates corrupt endpoint references. */
function assertPortsUnique(device: DeviceInstance): void {
  const seen = new Set<string>();
  const duplicates: EntityId[] = [];
  for (const port of device.ports) {
    if (seen.has(port.id)) duplicates.push(port.id);
    seen.add(port.id);
  }
  if (duplicates.length > 0) {
    throw new StoreError(
      StoreErrorCode.PortDuplicate,
      `Device ${JSON.stringify(device.id)} declares duplicate port ids: ${duplicates.join(', ')}.`,
      { entityIds: [device.id, ...duplicates], rule: '4.3' },
    );
  }
}

/** Every PortRef must resolve to an existing device and one of its ports (4.3). */
function assertPortRef(project: Project, ref: PortRef): void {
  const device = project.devices.find((candidate) => candidate.id === ref.instanceId);
  if (device === undefined) {
    throw new StoreError(
      StoreErrorCode.EntityMissing,
      `Endpoint references device ${JSON.stringify(ref.instanceId)}, which does not exist.`,
      { entityIds: [ref.instanceId], rule: '3.3' },
    );
  }
  if (!device.ports.some((port) => port.id === ref.portId)) {
    throw new StoreError(
      StoreErrorCode.PortMissing,
      `Endpoint references port ${JSON.stringify(ref.portId)}, which device ${JSON.stringify(ref.instanceId)} does not declare.`,
      { entityIds: [ref.instanceId, ref.portId], rule: '4.3' },
    );
  }
}

function assertConnectionReferences(project: Project, connection: PhysicalConnection): void {
  for (const ref of connection.endpoints) assertPortRef(project, ref);
  for (const elementId of connection.elements) {
    if (indexOfId(project.construction, elementId) < 0) {
      throw new StoreError(
        StoreErrorCode.EntityMissing,
        `Connection references construction element ${JSON.stringify(elementId)}, which does not exist.`,
        { entityIds: [elementId], rule: '3.3' },
      );
    }
  }
}

function assertIntentReferences(project: Project, intent: ConnectionIntent): void {
  assertPortRef(project, intent.from);
  assertPortRef(project, intent.to);
}

/** Scenario records key on existing network references and devices (4.1, 4.5). */
function assertScenarioReferences(project: Project, scenario: Scenario): void {
  const networkIds = new Set<string>([
    ...project.intents.map((intent) => intent.id),
    ...project.connections.map((connection) => connection.id),
  ]);
  for (const key of Object.keys(scenario.inventories)) {
    if (!networkIds.has(key)) {
      throw new StoreError(
        StoreErrorCode.EntityMissing,
        `Scenario inventory references ${JSON.stringify(key)}, which is neither a connection nor an intent.`,
        { entityIds: [scenario.id, key], rule: '4.5' },
      );
    }
  }
  for (const key of Object.keys(scenario.assumedVolumes)) {
    if (!networkIds.has(key)) {
      throw new StoreError(
        StoreErrorCode.EntityMissing,
        `Scenario assumed volume references ${JSON.stringify(key)}, which is neither a connection nor an intent.`,
        { entityIds: [scenario.id, key], rule: '4.7' },
      );
    }
  }
  for (const deviceId of Object.keys(scenario.deviceSettings ?? {})) {
    if (indexOfId(project.devices, deviceId) < 0) {
      throw new StoreError(
        StoreErrorCode.EntityMissing,
        `Scenario device settings reference device ${JSON.stringify(deviceId)}, which does not exist.`,
        { entityIds: [scenario.id, deviceId], rule: '4.1' },
      );
    }
  }
}

// ------------------------------------------------------------- op builders --

function removeOp(collection: EntityCollection, index: number): PatchOp {
  return { op: 'remove', path: buildPointer([collection, String(index)]) };
}

function replaceOp(collection: EntityCollection, index: number, entity: unknown): PatchOp {
  return { op: 'replace', path: buildPointer([collection, String(index)]), value: entity };
}

/**
 * Existing connections and intents whose endpoints name this device must
 * resolve against the replacement's port set; otherwise they would silently
 * dangle (SYNC-009).
 */
function assertDeviceEndpointsResolvable(project: Project, device: DeviceInstance): void {
  const portIds = new Set(device.ports.map((port) => port.id));
  const dangling: { ref: PortRef; owner: EntityId; kind: string }[] = [];
  for (const connection of project.connections) {
    for (const ref of connection.endpoints) {
      if (ref.instanceId === device.id && !portIds.has(ref.portId)) {
        dangling.push({ ref, owner: connection.id, kind: 'connection' });
      }
    }
  }
  for (const intent of project.intents) {
    for (const ref of [intent.from, intent.to]) {
      if (ref.instanceId === device.id && !portIds.has(ref.portId)) {
        dangling.push({ ref, owner: intent.id, kind: 'intent' });
      }
    }
  }
  if (dangling.length > 0) {
    const first = dangling[0]!;
    throw new StoreError(
      StoreErrorCode.PortMissing,
      `Replacing device ${JSON.stringify(device.id)} would strand ${dangling.length} endpoint(s); first: ${first.kind} ${JSON.stringify(first.owner)} references port ${JSON.stringify(first.ref.portId)}.`,
      { entityIds: [device.id, first.ref.portId, first.owner], rule: 'SYNC-009' },
    );
  }
}

/** Scenario keys referencing a network id (intent or connection), if any. */
function scenarioIdsKeyingNetwork(project: Project, networkId: EntityId): EntityId[] {
  return project.scenarios
    .filter(
      (scenario) =>
        Object.hasOwn(scenario.inventories, networkId) ||
        Object.hasOwn(scenario.assumedVolumes, networkId),
    )
    .map((scenario) => scenario.id);
}

/**
 * Removing a device: refuses while physically connected or while scenario
 * settings or cascaded intents still anchor state that would be silently
 * discarded (SYNC-009); cascades its intents in the same command (SYNC-013).
 * Schematic layout positions are presentation metadata and are left alone.
 */
function removeDeviceOps(project: Project, deviceId: EntityId, deviceIndex: number): Patch {
  const connected = project.connections
    .filter((connection) => connection.endpoints.some((ref) => ref.instanceId === deviceId))
    .map((connection) => connection.id);
  if (connected.length > 0) {
    throw new StoreError(
      StoreErrorCode.EntityReferenced,
      `Device ${JSON.stringify(deviceId)} has physical connections (${connected.join(', ')}); remove them first.`,
      { entityIds: [deviceId, ...connected], rule: 'SYNC-009' },
    );
  }
  const overridden = project.scenarios
    .filter((scenario) => Object.hasOwn(scenario.deviceSettings ?? {}, deviceId))
    .map((scenario) => scenario.id);
  if (overridden.length > 0) {
    throw new StoreError(
      StoreErrorCode.EntityReferenced,
      `Scenario(s) ${overridden.join(', ')} override settings of device ${JSON.stringify(deviceId)}; clear them first.`,
      { entityIds: [deviceId, ...overridden], rule: 'SYNC-009' },
    );
  }
  const intentIndices = project.intents
    .map((intent, index) =>
      intent.from.instanceId === deviceId || intent.to.instanceId === deviceId ? index : -1,
    )
    .filter((index) => index >= 0);
  const cascadedIds = intentIndices.map((index) => project.intents[index]!.id);
  const scenarioUsers = new Set<EntityId>();
  for (const intentId of cascadedIds) {
    for (const scenarioId of scenarioIdsKeyingNetwork(project, intentId)) scenarioUsers.add(scenarioId);
  }
  if (scenarioUsers.size > 0) {
    throw new StoreError(
      StoreErrorCode.EntityReferenced,
      `Removing device ${JSON.stringify(deviceId)} would cascade intent(s) ${cascadedIds.join(', ')} still referenced by scenario(s) ${[...scenarioUsers].join(', ')}; clear the scenario references first.`,
      { entityIds: [deviceId, ...cascadedIds, ...scenarioUsers], rule: 'SYNC-013' },
    );
  }
  // Remove cascaded intents in descending index order so earlier removals
  // never shift the index a later removal targets.
  const ops: PatchOp[] = intentIndices
    .sort((a, b) => b - a)
    .map((index) => removeOp('intents', index));
  ops.push(removeOp('devices', deviceIndex));
  return ops;
}

// ---------------------------------------------------------- command builder --

/**
 * Validates `command` against `project` and returns its patch ops. Throws a
 * `StoreError` on any failure; never mutates `project`.
 */
export function buildCommandPatch(project: Project, command: Command): Patch {
  if (command === null || typeof command !== 'object') {
    throw new StoreError(StoreErrorCode.CommandInvalid, 'Command must be an object.');
  }
  switch (command.type) {
    case 'addEntity':
      return buildAddEntity(project, parseCollection(command.collection), command.entity);
    case 'replaceEntity':
      return buildReplaceEntity(project, parseCollection(command.collection), command.id, command.entity);
    case 'removeEntity':
      return buildRemoveEntity(project, parseCollection(command.collection), command.id);
    case 'setDeviceSetting':
      return buildSetDeviceSetting(project, command.deviceId, command.key, command.value);
    case 'removeDeviceSetting':
      return buildRemoveDeviceSetting(project, command.deviceId, command.key);
    case 'assignDevicePlacement':
      return buildAssignDevicePlacement(project, command.deviceId, command.placementId);
    case 'unassignDevicePlacement':
      return buildUnassignDevicePlacement(project, command.deviceId);
    case 'setNodePosition':
      return buildSetNodePosition(project, command.entityId, command.position);
    case 'clearNodePosition':
      return buildClearNodePosition(project, command.entityId);
    case 'setProjectSetting':
      return buildSetProjectSetting(project, command.key, command.value);
    case 'renameProject':
      return buildRenameProject(command.name);
    default:
      throw new StoreError(
        StoreErrorCode.CommandInvalid,
        `Unknown command type ${JSON.stringify((command as { type?: unknown }).type)}.`,
      );
  }
}

function buildAddEntity(project: Project, collection: EntityCollection, raw: unknown): Patch {
  assertIdAvailable(project, collection, readEntityId(raw));
  switch (collection) {
    case 'devices': {
      const device = parseDevice(raw);
      assertPortsUnique(device);
      if (device.placementId !== undefined) assertPlacementFree(project, device.placementId, undefined);
      return [{ op: 'add', path: buildPointer(['devices', '-']), value: device }];
    }
    case 'placements':
      return [{ op: 'add', path: buildPointer(['placements', '-']), value: parsePlacement(raw) }];
    case 'construction':
      return [{ op: 'add', path: buildPointer(['construction', '-']), value: parseConstruction(raw) }];
    case 'connections': {
      const connection = parseConnection(raw);
      assertConnectionReferences(project, connection);
      return [{ op: 'add', path: buildPointer(['connections', '-']), value: connection }];
    }
    case 'intents': {
      const intent = parseIntent(raw);
      assertIntentReferences(project, intent);
      return [{ op: 'add', path: buildPointer(['intents', '-']), value: intent }];
    }
    case 'scenarios': {
      const scenario = parseScenario(raw);
      assertScenarioReferences(project, scenario);
      return [{ op: 'add', path: buildPointer(['scenarios', '-']), value: scenario }];
    }
  }
}

function buildReplaceEntity(
  project: Project,
  collection: EntityCollection,
  id: EntityId,
  raw: unknown,
): Patch {
  const index = requireIndexOf(project, collection, id);
  switch (collection) {
    case 'devices': {
      const device = parseDevice(raw);
      if (device.id !== id) {
        throw new StoreError(
          StoreErrorCode.CommandInvalid,
          `replaceEntity id ${JSON.stringify(id)} does not match entity id ${JSON.stringify(device.id)}.`,
          { entityIds: [id] },
        );
      }
      assertPortsUnique(device);
      if (device.placementId !== undefined) assertPlacementFree(project, device.placementId, id);
      assertDeviceEndpointsResolvable(project, device);
      return [replaceOp('devices', index, device)];
    }
    case 'placements':
      return [replaceOp('placements', index, checkedEntityId(parsePlacement(raw), id))];
    case 'construction':
      return [replaceOp('construction', index, checkedEntityId(parseConstruction(raw), id))];
    case 'connections': {
      const connection = checkedEntityId(parseConnection(raw), id);
      assertConnectionReferences(project, connection);
      return [replaceOp('connections', index, connection)];
    }
    case 'intents': {
      const intent = checkedEntityId(parseIntent(raw), id);
      assertIntentReferences(project, intent);
      return [replaceOp('intents', index, intent)];
    }
    case 'scenarios': {
      const scenario = checkedEntityId(parseScenario(raw), id);
      assertScenarioReferences(project, scenario);
      return [replaceOp('scenarios', index, scenario)];
    }
  }
}

/** Enforces `parsed.id === id` for entity types parsed as unions. */
function checkedEntityId<T extends HasId>(entity: T, id: EntityId): T {
  if (entity.id !== id) {
    throw new StoreError(
      StoreErrorCode.CommandInvalid,
      `replaceEntity id ${JSON.stringify(id)} does not match entity id ${JSON.stringify(entity.id)}.`,
      { entityIds: [id] },
    );
  }
  return entity;
}

/** Cheap id pre-read so duplicate ids fail before schema parsing. */
function readEntityId(raw: unknown): EntityId {
  const parsed = EntityIdSchema.safeParse(
    raw !== null && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined,
  );
  if (!parsed.success) {
    throw new StoreError(
      StoreErrorCode.SchemaInvalid,
      'Entity requires a valid id (STORE-ENTITY-EXISTS/MISSING checks run on it).',
      { rule: '9.4' },
    );
  }
  return parsed.data;
}

function buildRemoveEntity(project: Project, collection: EntityCollection, id: EntityId): Patch {
  const index = requireIndexOf(project, collection, id);
  switch (collection) {
    case 'devices':
      return removeDeviceOps(project, id, index);
    case 'placements': {
      const holders = project.devices.filter((device) => device.placementId === id).map((device) => device.id);
      if (holders.length > 0) {
        throw new StoreError(
          StoreErrorCode.EntityReferenced,
          `Placement ${JSON.stringify(id)} is used by device(s) ${holders.join(', ')}; unassign them first.`,
          { entityIds: [id, ...holders], rule: '3.3' },
        );
      }
      return [removeOp('placements', index)];
    }
    case 'construction': {
      const users = project.connections
        .filter((connection) => connection.elements.includes(id))
        .map((connection) => connection.id);
      if (users.length > 0) {
        throw new StoreError(
          StoreErrorCode.EntityReferenced,
          `Construction element ${JSON.stringify(id)} is part of connection(s) ${users.join(', ')}; remove them first.`,
          { entityIds: [id, ...users], rule: '3.3' },
        );
      }
      return [removeOp('construction', index)];
    }
    case 'connections': {
      const users = scenarioIdsKeyingNetwork(project, id);
      if (users.length > 0) {
        throw new StoreError(
          StoreErrorCode.EntityReferenced,
          `Scenario(s) ${users.join(', ')} key inventory or assumed volumes on connection ${JSON.stringify(id)}; clear them first.`,
          { entityIds: [id, ...users], rule: 'SYNC-009' },
        );
      }
      return [removeOp('connections', index)];
    }
    case 'intents': {
      const users = scenarioIdsKeyingNetwork(project, id);
      if (users.length > 0) {
        throw new StoreError(
          StoreErrorCode.EntityReferenced,
          `Scenario(s) ${users.join(', ')} key inventory or assumed volumes on intent ${JSON.stringify(id)}; clear them first.`,
          { entityIds: [id, ...users], rule: 'SYNC-009' },
        );
      }
      return [removeOp('intents', index)];
    }
    case 'scenarios':
      return [removeOp('scenarios', index)];
  }
}

function buildSetDeviceSetting(project: Project, deviceId: EntityId, key: string, value: SettingValue): Patch {
  const index = requireIndexOf(project, 'devices', deviceId);
  const keyParsed = z.string().min(1).safeParse(key);
  if (!keyParsed.success) {
    throw new StoreError(
      StoreErrorCode.CommandInvalid,
      'Device setting key must be a non-empty string.',
      { entityIds: [deviceId] },
    );
  }
  const valueParsed = SettingValueSchema.safeParse(value);
  if (!valueParsed.success) throw schemaInvalid(valueParsed.error, 'device setting value');
  return [{
    op: 'add',
    path: buildPointer(['devices', String(index), 'settings', keyParsed.data]),
    value: valueParsed.data,
  }];
}

function buildRemoveDeviceSetting(project: Project, deviceId: EntityId, key: string): Patch {
  const index = requireIndexOf(project, 'devices', deviceId);
  const device = project.devices[index]!;
  if (!Object.hasOwn(device.settings, key)) {
    throw new StoreError(
      StoreErrorCode.SettingMissing,
      `Device ${JSON.stringify(deviceId)} has no setting ${JSON.stringify(key)}.`,
      { entityIds: [deviceId], rule: '2.2.1' },
    );
  }
  return [{ op: 'remove', path: buildPointer(['devices', String(index), 'settings', key]) }];
}

function buildAssignDevicePlacement(project: Project, deviceId: EntityId, placementId: EntityId): Patch {
  const index = requireIndexOf(project, 'devices', deviceId);
  assertPlacementFree(project, placementId, deviceId);
  return [{
    op: 'add',
    path: buildPointer(['devices', String(index), 'placementId']),
    value: placementId,
  }];
}

function buildUnassignDevicePlacement(project: Project, deviceId: EntityId): Patch {
  const index = requireIndexOf(project, 'devices', deviceId);
  const device = project.devices[index]!;
  if (device.placementId === undefined) {
    throw new StoreError(
      StoreErrorCode.PlacementMissing,
      `Device ${JSON.stringify(deviceId)} is already unplaced.`,
      { entityIds: [deviceId], rule: '3.3' },
    );
  }
  return [{ op: 'remove', path: buildPointer(['devices', String(index), 'placementId']) }];
}

function buildSetNodePosition(project: Project, entityId: EntityId, rawPosition: unknown): Patch {
  const known =
    indexOfId(project.devices, entityId) >= 0 || indexOfId(project.construction, entityId) >= 0;
  if (!known) {
    throw new StoreError(
      StoreErrorCode.EntityMissing,
      `Schematic layout positions apply to devices and construction elements; ${JSON.stringify(entityId)} is neither.`,
      { entityIds: [entityId], rule: '9.1' },
    );
  }
  const position = parseNodePosition(rawPosition);
  return [{
    op: 'add',
    path: buildPointer(['schematicLayout', 'nodePositions', entityId]),
    value: position,
  }];
}

function buildClearNodePosition(project: Project, entityId: EntityId): Patch {
  if (!Object.hasOwn(project.schematicLayout.nodePositions, entityId)) {
    throw new StoreError(
      StoreErrorCode.PositionMissing,
      `Schematic layout has no position for ${JSON.stringify(entityId)}.`,
      { entityIds: [entityId], rule: '2.2.1' },
    );
  }
  return [{ op: 'remove', path: buildPointer(['schematicLayout', 'nodePositions', entityId]) }];
}

function buildSetProjectSetting(project: Project, key: ProjectSettingKey, value: boolean): Patch {
  if (key !== 'autoSave' && key !== 'showExperimental') {
    throw new StoreError(
      StoreErrorCode.CommandInvalid,
      `Unknown project setting ${JSON.stringify(key)}.`,
    );
  }
  const valueParsed = z.boolean().safeParse(value);
  if (!valueParsed.success) throw schemaInvalid(valueParsed.error, 'project setting value');
  return [{ op: 'add', path: buildPointer(['settings', key]), value: valueParsed.data }];
}

function buildRenameProject(name: string): Patch {
  const parsed = displayString(MAX_DISPLAY_NAME_LENGTH).safeParse(name);
  if (!parsed.success) throw schemaInvalid(parsed.error, 'project name');
  // meta.updatedAt is not touched here: the store never reads a clock (5.1.1);
  // the persistence layer stamps timestamps when it saves.
  return [{ op: 'replace', path: buildPointer(['meta', 'name']), value: parsed.data }];
}
