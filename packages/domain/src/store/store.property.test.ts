/**
 * Property-based tests for the canonical store (FND-04; spec 10.1).
 *
 * Invariants over arbitrary command sequences:
 * P1 — undo-to-start then redo-to-end forms a closed cycle: reaching back lands
 *      on the sanitized initial document structurally, and replaying forwards
 *      again produces a byte-identical end state on every pass;
 * P2 — over forward-only commands, each entry's inverse patch restores exactly
 *      its pre-command state, and its forward patch re-produces exactly the
 *      post-command state recorded in the log.
 *
 * Revision bookkeeping notes that shape P1's assertions:
 * - Every dispatch, undo, and redo is itself a commit (spec 2.2.1), so between
 *   two checkpoints the revision grows by exactly one per committed change.
 * - Undo/redo only move the log cursor; they never append entries. A final
 *   "reach backwards then replay forwards" therefore replays every retained
 *   dispatch again, even ones the original step sequence had already undone —
 *   comparing against a pre-cycle snapshot of `store.state` would be wrong in
 *   general; comparing whole cycles to each other is exact.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type {
  ConnectionIntent,
  DeviceInstance,
  PhysicalConnection,
  Project,
} from '../entities';
import { createStore } from './store';
import type { Command, EntityCollection } from './commands';
import { ENTITY_COLLECTIONS } from './commands';
import { applyPatch, deepEqualJson } from './patch';
import {
  INVENTORY_FIXTURE,
  makeConstruction,
  makeConnection,
  makeDevice,
  makeIntent,
  makePlacement,
  makeProject,
  makeScenario,
} from './test-fixtures';

// ------------------------------------------------------------ step model --

/** Arbitrary editor action resolved against live state by `commandFor`. */
type Step =
  | { readonly kind: 'addDevice'; portCount: number }
  | { readonly kind: 'addPlacement' }
  | { readonly kind: 'addConstruction' }
  | { readonly kind: 'addLink'; isIntent: boolean; deviceA: number; portA: number; deviceB: number; portB: number }
  | { readonly kind: 'addScenario'; useIntentsNetwork: boolean; networkChoice: number; deviceId: number }
  | { readonly kind: 'replaceEntity'; collectionIndex: number; choice: number }
  | { readonly kind: 'removeFirstDevice' }
  | { readonly kind: 'removeLastPlacementIfFree' }
  | { readonly kind: 'toggleSetting'; keyIndex: number }
  | { readonly kind: 'setDeviceSetting'; deviceChoice: number; valueIndex: number }
  | { readonly kind: 'assignPlacement'; deviceChoice: number; placementChoice: number }
  | { readonly kind: 'unassignPlacement'; deviceChoice: number }
  | { readonly kind: 'setPosition'; entityChoiceIsDevice: boolean; choice: number }
  | { readonly kind: 'clearPosition' }
  | { readonly kind: 'renameProject' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

const arbitraryStep = fc.oneof(
  fc.record({ kind: fc.constant('addDevice'), portCount: fc.integer({ min: 1, max: 2 }) }),
  fc.record({ kind: fc.constant('addPlacement') }),
  fc.record({ kind: fc.constant('addConstruction') }),
  fc.record({
    kind: fc.constant('addLink'),
    isIntent: fc.boolean(),
    deviceA: fc.integer({ min: 0, max: 3 }),
    portA: fc.integer({ min: 0, max: 1 }),
    deviceB: fc.integer({ min: 0, max: 3 }),
    portB: fc.integer({ min: 0, max: 1 }),
  }),
  fc.record({
    kind: fc.constant('addScenario'),
    useIntentsNetwork: fc.boolean(),
    networkChoice: fc.integer({ min: 0, max: 5 }),
    deviceId: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    kind: fc.constant('replaceEntity'),
    collectionIndex: fc.integer({ min: 0, max: ENTITY_COLLECTIONS.length - 1 }),
    choice: fc.integer({ min: 0, max: 7 }),
  }),
  fc.record({ kind: fc.constant('removeFirstDevice') }),
  fc.record({ kind: fc.constant('removeLastPlacementIfFree') }),
  fc.record({ kind: fc.constant('toggleSetting'), keyIndex: fc.integer({ min: 0, max: 1 }) }),
  fc.record({
    kind: fc.constant('setDeviceSetting'),
    deviceChoice: fc.integer({ min: 0, max: 7 }),
    valueIndex: fc.integer({ min: 0, max: 9 }),
  }),
  fc.record({
    kind: fc.constant('assignPlacement'),
    deviceChoice: fc.integer({ min: 0, max: 7 }),
    placementChoice: fc.integer({ min: 0, max: 7 }),
  }),
  fc.record({ kind: fc.constant('unassignPlacement'), deviceChoice: fc.integer({ min: 0, max: 7 }) }),
  fc.record({
    kind: fc.constant('setPosition'),
    entityChoiceIsDevice: fc.boolean(),
    choice: fc.integer({ min: 0, max: 7 }),
  }),
  fc.record({ kind: fc.constant('clearPosition') }),
  fc.record({ kind: fc.constant('renameProject') }),
  fc.record({ kind: fc.constant('undo') }),
  fc.record({ kind: fc.constant('redo') }),
) as fc.Arbitrary<Step>;

const arbitrarySteps = fc.array(arbitraryStep, { minLength: 0, maxLength: 25 });

// ----------------------------------------------------- command interpreter --

interface StepContext {
  readonly project: Project;
  readonly step: Step;
  readonly stepIndex: number;
}

function pickId<T extends { id: string }>(list: readonly T[], choice: number): string | undefined {
  if (list.length === 0) return undefined;
  return list[choice % list.length]!.id;
}

function portRef(project: Project, deviceChoice: number, portChoice: number): { instanceId: string; portId: string } | undefined {
  if (project.devices.length === 0) return undefined;
  const device = project.devices[deviceChoice % project.devices.length]!;
  if (device.ports.length === 0) return undefined;
  return { instanceId: device.id, portId: device.ports[portChoice % device.ports.length]!.id };
}

/** Network ids referenced by scenarios (intent or connection ids). */
function scenarioKeysNetwork(project: Project, networkId: string): boolean {
  return project.scenarios.some(
    (scenario) => scenario.inventories[networkId] !== undefined || scenario.assumedVolumes[networkId] !== undefined,
  );
}

/** Does any device hold this placement? */
function placementHeld(project: Project, placementId: string): boolean {
  return project.devices.some((device) => device.placementId === placementId);
}

function commandFor({ project, step, stepIndex }: StepContext): Command | undefined {
  const stepId = `s${stepIndex}`;
  switch (step.kind) {
    case 'addDevice':
      return {
        type: 'addEntity',
        collection: 'devices',
        entity: makeDevice(`dev-${stepId}`, ['in', 'out'].slice(0, step.portCount)),
      };
    case 'addPlacement':
      return { type: 'addEntity', collection: 'placements', entity: makePlacement(`place-${stepId}`, stepIndex) };
    case 'addConstruction':
      return { type: 'addEntity', collection: 'construction', entity: makeConstruction(`cons-${stepId}`, stepIndex) };
    case 'addLink': {
      const from = portRef(project, step.deviceA, step.portA);
      const to = portRef(project, step.deviceB, step.portB);
      if (from === undefined || to === undefined) return undefined;
      if (step.isIntent) {
        return { type: 'addEntity', collection: 'intents', entity: makeIntent(`intent-${stepId}`, 'gas-pipe', from, to) };
      }
      return { type: 'addEntity', collection: 'connections', entity: makeConnection(`conn-${stepId}`, 'gas-pipe', [from, to]) };
    }
    case 'addScenario': {
      const networks = step.useIntentsNetwork ? project.intents : project.connections;
      const networkId = pickId(networks.map((network) => ({ id: network.id })), step.networkChoice);
      if (networkId === undefined) return undefined;
      const deviceId = pickId(project.devices, step.deviceId);
      return {
        type: 'addEntity',
        collection: 'scenarios',
        entity: {
          id: `scenario-${stepId}`,
          name: `Scenario ${stepId}`,
          inventories: { [networkId]: INVENTORY_FIXTURE },
          assumedVolumes: {},
          ...(deviceId !== undefined
            ? { deviceSettings: { [deviceId]: { power: stepIndex } } }
            : {}),
        },
      };
    }
    case 'replaceEntity': {
      const collection = ENTITY_COLLECTIONS[step.collectionIndex] as EntityCollection;
      const list = project[collection] as readonly { id: string }[];
      const id = pickId(list, step.choice);
      if (id === undefined) return undefined;
      switch (collection) {
        case 'devices': {
          const device = project.devices.find((candidate) => candidate.id === id)!;
          // Same id and a superset of the original ports so every existing
          // connection/intent endpoint still resolves (SYNC-009 guard).
          return {
            type: 'replaceEntity',
            collection,
            id,
            entity: makeDevice(id, [...device.ports.map((port) => port.id)]) as DeviceInstance,
          };
        }
        case 'placements':
          return { type: 'replaceEntity', collection, id, entity: makePlacement(id, stepIndex) };
        case 'construction':
          return { type: 'replaceEntity', collection, id, entity: makeConstruction(id, stepIndex) };
        case 'connections': {
          const connection = project.connections.find((candidate) => candidate.id === id)!;
          return {
            type: 'replaceEntity',
            collection,
            id,
            entity: makeConnection(id, connection.medium, [connection.endpoints[0], connection.endpoints[1]], connection.elements) as PhysicalConnection,
          };
        }
        case 'intents': {
          const intent = project.intents.find((candidate) => candidate.id === id)!;
          return {
            type: 'replaceEntity',
            collection,
            id,
            entity: makeIntent(id, intent.medium, intent.from, intent.to, intent.label) as ConnectionIntent,
          };
        }
        case 'scenarios':
          return { type: 'replaceEntity', collection, id, entity: makeScenario(id, `Scenario ${stepIndex}`) };
      }
      return undefined;
    }
    case 'removeFirstDevice': {
      // A device is removable only when unconnected, unscenario'd, and its
      // intents are not scenario-referenced; guard the interpreter accordingly.
      const device = project.devices[0];
      if (device === undefined) return undefined;
      const connected = project.connections.some(
        (connection) => connection.endpoints.some((ref) => ref.instanceId === device.id),
      );
      if (connected) return undefined;
      const overridden = project.scenarios.some(
        (scenario) => scenario.deviceSettings?.[device.id] !== undefined,
      );
      if (overridden) return undefined;
      const intentIds = project.intents
        .filter((intent) => intent.from.instanceId === device.id || intent.to.instanceId === device.id)
        .map((intent) => intent.id);
      if (intentIds.some((intentId) => scenarioKeysNetwork(project, intentId))) return undefined;
      return { type: 'removeEntity', collection: 'devices', id: device.id };
    }
    case 'removeLastPlacementIfFree': {
      const placement = project.placements[project.placements.length - 1];
      if (placement === undefined || placementHeld(project, placement.id)) return undefined;
      return { type: 'removeEntity', collection: 'placements', id: placement.id };
    }
    case 'toggleSetting':
      return {
        type: 'setProjectSetting',
        key: step.keyIndex === 0 ? 'autoSave' : 'showExperimental',
        value: !project.settings[step.keyIndex === 0 ? 'autoSave' : 'showExperimental'],
      };
    case 'setDeviceSetting': {
      const deviceId = pickId(project.devices, step.deviceChoice);
      if (deviceId === undefined) return undefined;
      return { type: 'setDeviceSetting', deviceId, key: `key-${stepIndex}`, value: stepIndex };
    }
    case 'assignPlacement': {
      const deviceId = pickId(project.devices, step.deviceChoice);
      const placementId = pickId(project.placements, step.placementChoice);
      if (deviceId === undefined || placementId === undefined) return undefined;
      if (placementHeld(project, placementId)) return undefined;
      return { type: 'assignDevicePlacement', deviceId, placementId };
    }
    case 'unassignPlacement': {
      const device = project.devices.length === 0 ? undefined : project.devices[step.deviceChoice % project.devices.length]!;
      if (device === undefined || device.placementId === undefined) return undefined;
      return { type: 'unassignDevicePlacement', deviceId: device.id };
    }
    case 'setPosition': {
      const id = step.entityChoiceIsDevice ? pickId(project.devices, step.choice) : pickId(project.construction, step.choice);
      if (id === undefined) return undefined;
      return { type: 'setNodePosition', entityId: id, position: { x: stepIndex, y: stepIndex } };
    }
    case 'clearPosition': {
      const keys = Object.keys(project.schematicLayout.nodePositions);
      if (keys.length === 0) return undefined;
      return { type: 'clearNodePosition', entityId: keys[0]! };
    }
    case 'renameProject':
      return { type: 'renameProject', name: `Project ${stepIndex}` };
    case 'undo':
    case 'redo':
      return undefined;
  }
}

/** Drives the store; interpreter must never emit a rejected command. */
function driveSteps(store: ReturnType<typeof createStore>, steps: readonly Step[]): void {
  steps.forEach((step, stepIndex) => {
    if (step.kind === 'undo') {
      store.undo();
      return;
    }
    if (step.kind === 'redo') {
      store.redo();
      return;
    }
    const command = commandFor({ project: store.state, step, stepIndex });
    if (command === undefined) return;
    const result = store.dispatch(command);
    if (!result.ok) {
      throw new Error(`interpreter produced a rejected command: ${result.error.code} ${result.error.message}`);
    }
  });
}

// ------------------------------------------------------------- properties --

// ------------------------------------------------------------- properties --

describe('store property: undo/redo round trip', () => {
  it('undo-to-start then redo-to-end closes into a byte-identical loop (P1)', () => {
    const run = fc.property(arbitrarySteps, (steps) => {
      const store = createStore({ project: makeProject() });
      const initialJson = JSON.stringify(store.state);
      driveSteps(store, steps);
      const commits = store.revision;

      // Undo to start. Each undo is itself a commit (spec 2.2.1), so the
      // revision grows by exactly the number of undos performed.
      let undos = 0;
      while (store.canUndo) {
        const result = store.undo();
        expect(result.ok).toBe(true);
        undos += 1;
      }
      const startState = store.state;
      // The undo path reaches back exactly the initial document. Structural
      // equality is the contract here: inverse `add` ops re-insert object
      // members at the end of their object, so byte-identical JSON is not
      // guaranteed on the undo path (spec 2.2.1 discussion in test-fixtures).
      expect(deepEqualJson(startState, JSON.parse(initialJson))).toBe(true);
      expect(startState.devices).toEqual([]);
      expect(startState.placements).toEqual([]);
      expect(store.revision).toBe(commits + undos);

      // Redo to end.
      let redos = 0;
      while (store.canRedo) {
        const result = store.redo();
        expect(result.ok).toBe(true);
        redos += 1;
      }
      const replayedState = store.state;
      const replayedJson = JSON.stringify(replayedState);
      expect(store.revision).toBe(commits + undos + redos);

      // Undo to start again to prove the cycle is fully closed.
      while (store.canUndo) store.undo();
      expect(deepEqualJson(store.state, startState)).toBe(true);
      expect(JSON.stringify(store.state)).toBe(JSON.stringify(startState));

      // Redo to end again: byte-identical to the first replay.
      while (store.canRedo) store.redo();
      expect(deepEqualJson(store.state, replayedState)).toBe(true);
      expect(JSON.stringify(store.state)).toBe(replayedJson);
    });
    fc.assert(run, { numRuns: 250 });
  });

  it('each recorded entry\u0027s inverse restores exactly its pre-command state (P2)', () => {
    const run = fc.property(arbitrarySteps, (steps) => {
      const store = createStore({ project: makeProject() });
      const initialJson = JSON.stringify(store.state);
      // Forward-only walk: every step must be a dispatch (no undo/redo), so
      // each entry's base snapshot is the state before its own dispatch.
      const forwardOnly = steps.filter((step) => step.kind !== 'undo' && step.kind !== 'redo');
      driveSteps(store, forwardOnly);
      const log = store.exportLog();
      const json = (value: unknown): string => JSON.stringify(value);

      // Walk each entry's state chain: replay the forward patches from the
      // initial document, and verify the entry's inverse against the captured
      // pre-command state. Structural equality is the contract; byte-identity
      // is checked on the redo replay (the patch engine is copy-on-write).
      let current = JSON.parse(initialJson);
      log.entries.forEach((entry, index) => {
        const before = current;
        const after = applyPatch(before, entry.ops);
        // The inverse patch must restore exactly the pre-command state.
        const restored = applyPatch(after, entry.inverse);
        expect(deepEqualJson(restored, before)).toBe(true);
        expect(json(restored)).toBe(json(before));
        current = after;
      });
      // Replaying all forward patches from the initial document lands on the
      // store's own committed end state exactly.
      expect(deepEqualJson(current, store.state)).toBe(true);
      expect(JSON.stringify(current)).toBe(JSON.stringify(store.state));
    });
    fc.assert(run, { numRuns: 250 });
  });
});

