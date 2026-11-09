/**
 * Unit tests for the canonical store (FND-04; spec 2.2.1, 2.2, 5.6, 8).
 */
import { describe, expect, it } from 'vitest';
import type { DeviceInstance } from '../entities';
import { createStore } from './store';
import { StoreErrorCode, asStoreError } from './errors';
import { applyPatch, applyWithInverse, deepEqualJson } from './patch';
import type { PatchOp } from './types';
import {
  INVENTORY_FIXTURE,
  makeConnection,
  makeDevice,
  makeIntent,
  makePlacement,
  makeProject,
  makeScenario,
} from './test-fixtures';

const DEVICE_PORTS = ['in', 'out'] as const;

/** Asserts the closure throws a `StoreError` with the given code. */
function expectPatchCode(fn: () => unknown, code: StoreErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(asStoreError(error).code).toBe(code);
    return;
  }
  expect.unreachable('expected the closure to throw a StoreError');
}

function dev(id: string, ports: readonly string[] = DEVICE_PORTS): DeviceInstance {
  return makeDevice(id, ports);
}

describe('store: dispatch', () => {
  it('adds an entity and reports the commit', () => {
    const store = createStore({ project: makeProject() });
    const before = store.state;
    const result = store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(1);
      expect(result.revisionId).toBe('1');
    }
    expect(store.state.devices).toHaveLength(1);
    expect(store.state.devices[0]!.id).toBe('dev-1');
    expect(store.state).not.toBe(before);
    expect(before.devices).toHaveLength(0);
  });

  it('rejects a duplicate id with STORE-ENTITY-EXISTS', () => {
    const store = createStore({ project: makeProject() });
    expect(store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') }).ok).toBe(true);
    const result = store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(StoreErrorCode.EntityExists);
      expect(result.error.entityIds).toEqual(['dev-1']);
    }
  });

  it('rejects removeEntity on a missing id with STORE-ENTITY-MISSING', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(StoreErrorCode.EntityMissing);
      expect(result.error.entityIds).toEqual(['dev-nope']);
    }
  });

  it('rejects schema-invalid entities with STORE-SCHEMA-INVALID', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({
      type: 'addEntity',
      collection: 'devices',
      entity: { id: 'dev-1', definitionId: 'x', ports: 'two', settings: {} } as unknown as DeviceInstance,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.SchemaInvalid);
  });

  it('rejects a connection whose endpoints do not resolve', () => {
    const store = createStore({ project: makeProject() });
    expect(store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') }).ok).toBe(true);
    const result = store.dispatch({
      type: 'addEntity',
      collection: 'connections',
      entity: makeConnection('conn-1', 'gas-pipe', [
        { instanceId: 'dev-1', portId: 'in' },
        { instanceId: 'dev-nope', portId: 'in' },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.EntityMissing);
  });

  it('rejects a device whose declared port id is missing from an intent', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    const result = store.dispatch({
      type: 'addEntity',
      collection: 'intents',
      entity: makeIntent('intent-1', 'gas-pipe', { instanceId: 'dev-1', portId: 'in' }, { instanceId: 'dev-2', portId: 'nope' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.PortMissing);
  });

  it('rejects a scenario whose inventory keys a non-network id', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({
      type: 'addEntity',
      collection: 'scenarios',
      entity: makeScenario('scenario-1', 'S'),
    });
    expect(result.ok).toBe(true);
    const result2 = store.dispatch({
      type: 'addEntity',
      collection: 'scenarios',
      entity: { ...makeScenario('scenario-2', 'S'), inventories: { 'conn-nope': INVENTORY_FIXTURE } },
    });
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.error.code).toBe(StoreErrorCode.EntityMissing);
  });

  it('rejects an unknown command type with STORE-COMMAND-INVALID', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({ type: 'nonsense' } as unknown as Parameters<typeof store.dispatch>[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.CommandInvalid);
  });

  it('removes a device with its intents in one command (SYNC-013)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'intents',
      entity: makeIntent('intent-1', 'gas-pipe', { instanceId: 'dev-1', portId: 'in' }, { instanceId: 'dev-2', portId: 'in' }),
    });
    const result = store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-1' });
    expect(result.ok).toBe(true);
    expect(store.state.devices).toHaveLength(1);
    expect(store.state.intents).toHaveLength(0);
  });

  it('refuses device removal while physical connections exist (SYNC-009)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'connections',
      entity: makeConnection('conn-1', 'gas-pipe', [
        { instanceId: 'dev-1', portId: 'in' },
        { instanceId: 'dev-2', portId: 'in' },
      ]),
    });
    const result = store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(StoreErrorCode.EntityReferenced);
      expect(result.error.entityIds).toEqual(['dev-1', 'conn-1']);
    }
  });

  it('refuses device removal while a scenario overrides its settings (SYNC-009)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'intents',
      entity: makeIntent('intent-1', 'gas-pipe', { instanceId: 'dev-1', portId: 'in' }, { instanceId: 'dev-2', portId: 'in' }),
    });
    store.dispatch({
      type: 'addEntity',
      collection: 'scenarios',
      entity: {
        ...makeScenario('scenario-1', 'S'),
        inventories: { 'intent-1': INVENTORY_FIXTURE },
        deviceSettings: { 'dev-1': { power: 100 } },
      },
    });
    const result = store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.EntityReferenced);
  });

  it('refuses removing a device whose intents are scenario-referenced (SYNC-013 cascade)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'intents',
      entity: makeIntent('intent-1', 'gas-pipe', { instanceId: 'dev-1', portId: 'in' }, { instanceId: 'dev-2', portId: 'in' }),
    });
    store.dispatch({
      type: 'addEntity',
      collection: 'scenarios',
      entity: { ...makeScenario('scenario-1', 'S'), inventories: { 'intent-1': INVENTORY_FIXTURE } },
    });
    const result = store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(StoreErrorCode.EntityReferenced);
      expect(result.error.entityIds).toEqual(['dev-1', 'intent-1', 'scenario-1']);
    }
  });

  it('replaceEntity keeps the same id and rejects id mismatches', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const result = store.dispatch({ type: 'replaceEntity', collection: 'devices', id: 'dev-1', entity: dev('dev-2') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.CommandInvalid);
  });

  it('replaceEntity rejects replacements that would strand endpoints (SYNC-009)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1', ['in']) });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'connections',
      entity: makeConnection('conn-1', 'gas-pipe', [
        { instanceId: 'dev-1', portId: 'in' },
        { instanceId: 'dev-2', portId: 'in' },
      ]),
    });
    const result = store.dispatch({ type: 'replaceEntity', collection: 'devices', id: 'dev-1', entity: dev('dev-1', ['out']) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.PortMissing);
  });

  it('rejects a placement assignment when the placement is held (SYNC-002)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({ type: 'addEntity', collection: 'placements', entity: makePlacement('place-1', 0) });
    expect(store.dispatch({ type: 'assignDevicePlacement', deviceId: 'dev-1', placementId: 'place-1' }).ok).toBe(true);
    const result = store.dispatch({ type: 'assignDevicePlacement', deviceId: 'dev-2', placementId: 'place-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.PlacementInUse);
  });

  it('rejects unassignDevicePlacement when the device has no placement', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const result = store.dispatch({ type: 'unassignDevicePlacement', deviceId: 'dev-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.PlacementMissing);
  });

  it('rejects clearNodePosition when the position is absent (STORE-POSITION-MISSING)', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const result = store.dispatch({ type: 'clearNodePosition', entityId: 'dev-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.PositionMissing);
  });

  it('rejects a too-long rename (STORE-SCHEMA-INVALID)', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({ type: 'renameProject', name: 'x'.repeat(201) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.SchemaInvalid);
  });

  it('renames the project and keeps meta.updatedAt untouched', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({ type: 'renameProject', name: 'Renamed' });
    expect(result.ok).toBe(true);
    expect(store.state.meta.name).toBe('Renamed');
    expect(store.state.meta.updatedAt).toBe('2025-11-09T12:00:00.000Z');
  });

  it('rejects a rejected setDeviceSetting value with STORE-SCHEMA-INVALID', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const result = store.dispatch({
      type: 'setDeviceSetting',
      deviceId: 'dev-1',
      key: 'k',
      value: { nested: true } as unknown as number,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(StoreErrorCode.SchemaInvalid);
  });
});

describe('store: undo/redo', () => {
  it('undoes and redos a single command', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(store.canUndo).toBe(true);
    const undoResult = store.undo();
    expect(undoResult.ok).toBe(true);
    expect(store.state.devices).toEqual([]);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
    const redoResult = store.redo();
    expect(redoResult.ok).toBe(true);
    expect(store.state.devices).toHaveLength(1);
    expect(store.state.devices[0]!.id).toBe('dev-1');
  });

  it('reports STORE-NOTHING-TO-UNDO / STORE-NOTHING-TO-REDO', () => {
    const store = createStore({ project: makeProject() });
    const undoResult = store.undo();
    expect(undoResult.ok).toBe(false);
    if (!undoResult.ok) expect(undoResult.error.code).toBe(StoreErrorCode.NothingToUndo);
    const redoResult = store.redo();
    expect(redoResult.ok).toBe(false);
    if (!redoResult.ok) expect(redoResult.error.code).toBe(StoreErrorCode.NothingToRedo);
  });

  it('undoes a multi-op command (device removal cascades intents) atomically', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({
      type: 'addEntity',
      collection: 'intents',
      entity: makeIntent('intent-1', 'gas-pipe', { instanceId: 'dev-1', portId: 'in' }, { instanceId: 'dev-2', portId: 'in' }),
    });
    store.dispatch({ type: 'removeEntity', collection: 'devices', id: 'dev-1' });
    expect(store.state.intents).toHaveLength(0);
    const undoResult = store.undo();
    expect(undoResult.ok).toBe(true);
    expect(store.state.devices).toHaveLength(2);
    expect(store.state.intents).toHaveLength(1);
    expect(store.state.intents[0]!.id).toBe('intent-1');
  });

  it('undo restores the exact prior state object shape', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'renameProject', name: 'Renamed' });
    const midState = store.state;
    const midJson = JSON.stringify(midState);
    store.undo();
    store.undo();
    store.redo();
    store.redo();
    expect(JSON.stringify(store.state)).toBe(midJson);
  });

  it('a new dispatch after undo truncates the redo tail', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-3') });
    expect(store.canRedo).toBe(false);
    expect(store.state.devices.map((d) => d.id)).toEqual(['dev-1', 'dev-3']);
  });
});

describe('store: revisions', () => {
  it('starts at 0 and bumps on every commit', () => {
    const store = createStore({ project: makeProject() });
    expect(store.revision).toBe(0);
    expect(store.revisionId).toBe('0');
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(store.revision).toBe(1);
    store.undo();
    expect(store.revision).toBe(2);
    store.redo();
    expect(store.revision).toBe(3);
  });

  it('isStale/isCurrent implement 5.6 semantics', () => {
    const store = createStore({ project: makeProject() });
    expect(store.isStale('0')).toBe(false);
    expect(store.isCurrent('0')).toBe(true);
    const result = store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(store.isStale('0')).toBe(true);
      expect(store.isCurrent('0')).toBe(false);
      expect(store.isCurrent('1')).toBe(true);
      expect(store.isCurrent(result.revisionId)).toBe(true);
    }
    expect(store.isStale('not-a-number')).toBe(false);
    store.undo();
    expect(store.isStale('1')).toBe(true);
    expect(store.isCurrent('2')).toBe(true);
  });

  it('resumes from a persisted initialRevision', () => {
    const store = createStore({ project: makeProject(), initialRevision: 41 });
    expect(store.revision).toBe(41);
    expect(store.revisionId).toBe('41');
    const result = store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    if (result.ok) expect(result.revisionId).toBe('42');
  });

  it('refuses initialRevision below 0', () => {
    expect(() => createStore({ project: makeProject(), initialRevision: -1 })).toThrow(RangeError);
    expect(() => createStore({ project: makeProject(), maxLogEntries: 0 })).toThrow(RangeError);
  });
});

describe('store: command log', () => {
  it('exports an empty log with the current revision as base', () => {
    const store = createStore({ project: makeProject() });
    const log = store.exportLog();
    expect(log.format).toBe('stationeers.command-log');
    expect(log.version).toBe(1);
    expect(log.entries).toEqual([]);
    expect(log.cursor).toBe(0);
    expect(log.baseRevision).toBe(0);
    expect(JSON.parse(JSON.stringify(log))).toEqual({ format: 'stationeers.command-log', version: 1, baseRevision: 0, entries: [], cursor: 0 });
  });

  it('serializes the log round-trip through JSON, including undo/redo cursor', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.undo();
    const log = store.exportLog();
    const parsed = JSON.parse(JSON.stringify(log)) as typeof log;
    expect(parsed).toEqual(log);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.cursor).toBe(1);
    expect(parsed.entries[0]!.seq).toBe(1);
    expect(parsed.entries[0]!.baseRevision).toBe(0);
    expect(parsed.entries[0]!.ops).toHaveLength(1);
    expect(parsed.entries[0]!.inverse).toHaveLength(1);
    expect(parsed.entries[1]!.seq).toBe(2);
    expect(parsed.entries[1]!.baseRevision).toBe(1);
  });

  it('the log carries a structural baseRevision chain 0..n-1', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({ type: 'renameProject', name: 'Renamed' });
    const log = store.exportLog();
    expect(log.entries.map((entry) => entry.baseRevision)).toEqual([0, 1, 2]);
  });

  it('evicts the oldest entries when the bound is exceeded', () => {
    const store = createStore({ project: makeProject(), maxLogEntries: 2 });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-3') });
    const log = store.exportLog();
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]!.seq).toBe(2);
    expect(log.baseRevision).toBe(1);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
    store.undo();
    expect(store.state.devices.map((d) => d.id)).toEqual(['dev-1', 'dev-2']);
    store.undo();
    expect(store.state.devices.map((d) => d.id)).toEqual(['dev-1']);
    expect(store.canUndo).toBe(false);
  });

  it('the log is deep-frozen', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const log = store.exportLog();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.entries[0]!.ops)).toBe(true);
    expect(Object.isFrozen(log.entries[0]!.ops[0])).toBe(true);
    expect(Object.isFrozen(log.entries[0]!.inverse)).toBe(true);
  });
});

describe('store: immutability', () => {
  it('freezeState keeps the state frozen and the previous state untouched', () => {
    const store = createStore({ project: makeProject(), freezeState: true });
    const before = store.state;
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(Object.isFrozen(store.state)).toBe(true);
    expect(Object.isFrozen(store.state.devices[0])).toBe(true);
    expect(Object.isFrozen(before)).toBe(true);
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    expect(store.state.devices[0]!.id).toBe('dev-1');
    expect(store.state.devices[0]).not.toBe(before.devices[0]);
  });

  it('freezeState prevents dispatching a mutated entity', () => {
    const store = createStore({ project: makeProject(), freezeState: true });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(() => {
      (store.state.devices[0] as unknown as { id: string }).id = 'mutated';
    }).toThrow();
  });

  it('the previous state is not the same array as the new state', () => {
    const store = createStore({ project: makeProject() });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    const s1 = store.state;
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    expect(store.state).not.toBe(s1);
    expect(store.state.devices).not.toBe(s1.devices);
    expect(s1.devices).toHaveLength(1);
    expect(store.state.devices).toHaveLength(2);
  });

  it('freezeState freezes the state after every commit', () => {
    const store = createStore({ project: makeProject(), freezeState: true });
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(Object.isFrozen(store.state)).toBe(true);
    store.dispatch({ type: 'renameProject', name: 'Renamed' });
    expect(Object.isFrozen(store.state)).toBe(true);
    expect(store.state.meta.name).toBe('Renamed');
  });
});

describe('store: listeners', () => {
  it('notifies after every committed change', () => {
    const store = createStore({ project: makeProject() });
    const events: string[] = [];
    const unsubscribe = store.subscribe(() => events.push(`commit ${store.revision}`));
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    store.undo();
    store.redo();
    expect(events).toEqual(['commit 1', 'commit 2', 'commit 3']);
    unsubscribe();
    store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-2') });
    expect(events).toEqual(['commit 1', 'commit 2', 'commit 3']);
  });
});

describe('store: sanitized initial state', () => {
  it('rejects a bundle-invalid project', () => {
    const project = makeProject();
    (project.meta as unknown as { gameBuild: string }).gameBuild = '';
    expect(() => createStore({ project })).toThrow();
  });

  it('sanitizes control characters from the project name', () => {
    const project = makeProject();
    (project.meta as unknown as { name: string }).name = 'Name\u0007';
    const store = createStore({ project });
    expect(store.state.meta.name).toBe('Name');
  });
});

describe('patch engine: RFC 6902 semantics', () => {
  it('applies add/replace/remove on members and arrays', () => {
    const doc = { a: { b: [1, 2] }, c: 'x' };
    const next = applyPatch(doc, [
      { op: 'add', path: '/a/b/-', value: 3 },
      { op: 'replace', path: '/c', value: 'y' },
    ] as PatchOp[]);
    expect(next).toEqual({ a: { b: [1, 2, 3] }, c: 'y' });
    expect(doc).toEqual({ a: { b: [1, 2] }, c: 'x' });
  });

  it('applies move and copy', () => {
    const doc = { a: [1, 2], b: { c: 'x' } };
    const next = applyPatch(doc, [
      { op: 'copy', from: '/a/0', path: '/b/d' },
      { op: 'move', from: '/a/0', path: '/b/e' },
    ] as PatchOp[]);
    expect(next).toEqual({ a: [2], b: { c: 'x', d: 1, e: 1 } });
  });

  it('test acts as a gate and fails the whole patch', () => {
    const doc = { a: 1 };
    expectPatchCode(() => applyPatch(doc, [{ op: 'test', path: '/a', value: 2 }]), StoreErrorCode.PatchTestFailed);
    expect(applyPatch(doc, [{ op: 'test', path: '/a', value: 1 }])).toEqual(doc);
  });

  it('an add on an existing object member is replaced, and its undo restores the prior value', () => {
    const doc = { a: 1 };
    const { next, inverse } = applyWithInverse(doc, [{ op: 'add', path: '/a', value: 2 }]);
    expect(next).toEqual({ a: 2 });
    expect(inverse).toEqual([{ op: 'replace', path: '/a', value: 1 }]);
    expect(applyPatch(next, inverse)).toEqual(doc);
  });

  it('a failed mid-patch leaves the input document untouched', () => {
    const doc = { a: { b: 1 } };
    const ops: PatchOp[] = [
      { op: 'replace', path: '/a/b', value: 2 },
      { op: 'remove', path: '/a/b/c' },
    ];
    expectPatchCode(() => applyPatch(doc, ops), StoreErrorCode.PatchPathMissing);
    expect(doc).toEqual({ a: { b: 1 } });
  });

  it('rejects root-level operations', () => {
    const doc = { a: 1 };
    expectPatchCode(() => applyPatch(doc, [{ op: 'remove', path: '' }]), StoreErrorCode.PatchRoot);
    expectPatchCode(() => applyPatch(doc, [{ op: 'replace', path: '', value: {} }]), StoreErrorCode.PatchRoot);
  });

  it('rejects malformed pointers', () => {
    const doc = { a: 1 };
    expectPatchCode(() => applyPatch(doc, [{ op: 'add', path: '/a/b', value: 1 }]), StoreErrorCode.PatchPathMissing);
    expectPatchCode(() => applyPatch(doc, [{ op: 'add', path: '/a/x', value: 1 }]), StoreErrorCode.PatchPathMissing);
  });

  it('escapes ~ and / in pointers', () => {
    const doc = { 'a/b': { 'c~d': 1 } };
    const next = applyPatch(doc, [{ op: 'replace', path: '/a~1b/c~0d', value: 2 }]);
    expect(next).toEqual({ 'a/b': { 'c~d': 2 } });
  });

  it('rejects an array index beyond length', () => {
    const doc = { a: [1] };
    expectPatchCode(() => applyPatch(doc, [{ op: 'add', path: '/a/2', value: 1 }]), StoreErrorCode.PatchPathMissing);
    expectPatchCode(() => applyPatch(doc, [{ op: 'replace', path: '/a/1', value: 1 }]), StoreErrorCode.PatchPathMissing);
  });

  it('rejects an undefined value in add', () => {
    const doc = { a: 1 };
    expectPatchCode(() => applyPatch(doc, [{ op: 'add', path: '/a', value: undefined }]), StoreErrorCode.PatchInvalid);
  });

  it('the store\'s inverted patch is a pure function of the command', () => {
    const store = createStore({ project: makeProject() });
    const result = store.dispatch({ type: 'addEntity', collection: 'devices', entity: dev('dev-1') });
    expect(result.ok).toBe(true);
    const log = store.exportLog();
    const entry = log.entries[0]!;
    expect(entry.ops).toEqual([{ op: 'add', path: '/devices/-', value: dev('dev-1') }]);
    expect(entry.inverse).toEqual([{ op: 'remove', path: '/devices/0' }]);
  });
});

describe('patch engine: deepEqualJson', () => {
  it('matches structurally equal trees', () => {
    expect(deepEqualJson({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqualJson({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(deepEqualJson({ a: 1 }, { a: '1' })).toBe(false);
    // `undefined` is not a JSON value, so the member counts differ and the
    // trees are not equal (RFC 6902 test semantics compare members, not
    // serialized text).
    expect(deepEqualJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqualJson([1, 2], [2, 1])).toBe(false);
    expect(deepEqualJson(null, null)).toBe(true);
    expect(deepEqualJson(null, undefined)).toBe(false);
  });
});
