import { describe, expect, it } from 'vitest';
import type { BehaviorModel } from '@stationeers/domain';
import {
  ModelRegistryError,
  ModelRegistryErrorCode,
  createModelRegistry,
  findModelsAffectedBy,
  getModel,
  listModels,
  listVersions,
  modelRef,
  registerModel,
} from './registry';

function makeModel(
  id: string,
  version: string,
  consumes: BehaviorModel['consumes'] = { properties: [], constants: [] },
): BehaviorModel {
  return {
    id,
    version,
    domain: 'atmospherics',
    consumes,
    envelope: { inputs: {} },
    status: 'verified',
    fixtureIds: ['fx-1'],
  };
}

function registryWith(...models: BehaviorModel[]) {
  return models.reduce((registry, model) => registerModel(registry, model), createModelRegistry());
}

describe('behavior-model registry (spec 5.3)', () => {
  it('starts empty', () => {
    const registry = createModelRegistry();
    expect(listModels(registry)).toEqual([]);
    expect(getModel(registry, 'atmo.pressure', '1')).toBeUndefined();
    expect(listVersions(registry, 'atmo.pressure')).toEqual([]);
  });

  it('registers and queries by id + version', () => {
    const model = makeModel('atmo.pressure', '1');
    const registry = registerModel(createModelRegistry(), model);
    expect(getModel(registry, 'atmo.pressure', '1')).toBe(model);
    expect(getModel(registry, 'atmo.pressure', '2')).toBeUndefined();
    expect(getModel(registry, 'atmo.heat', '1')).toBeUndefined();
  });

  it('keeps multiple versions of one id coexisting', () => {
    const v1 = makeModel('atmo.pressure', '1');
    const v2 = makeModel('atmo.pressure', '2', {
      properties: ['gas.molarMass'],
      constants: [],
    });
    const registry = registryWith(v1, v2);
    expect(getModel(registry, 'atmo.pressure', '1')).toBe(v1);
    expect(getModel(registry, 'atmo.pressure', '2')).toBe(v2);
    expect(listVersions(registry, 'atmo.pressure')).toEqual(['1', '2']);
  });

  it('rejects duplicate id+version registration explicitly and leaves the registry unchanged', () => {
    const registry = registryWith(makeModel('atmo.pressure', '1'));
    const duplicate = makeModel('atmo.pressure', '1');
    expect(() => registerModel(registry, duplicate)).toThrowError(ModelRegistryError);
    try {
      registerModel(registry, duplicate);
    } catch (error) {
      expect((error as ModelRegistryError).code).toBe(ModelRegistryErrorCode.DuplicateModel);
      expect((error as ModelRegistryError).message).toContain('atmo.pressure@1');
    }
    // The original registry is untouched by the failed registration.
    expect(listModels(registry)).toHaveLength(1);
  });

  it('allows the same id with a different version', () => {
    const registry = registryWith(makeModel('a', '1'), makeModel('a', '2'));
    expect(listModels(registry)).toHaveLength(2);
  });

  it('never mutates the registry it was given', () => {
    const before = createModelRegistry();
    const after = registerModel(before, makeModel('a', '1'));
    expect(listModels(before)).toEqual([]);
    expect(listModels(after)).toHaveLength(1);
  });

  it('lists models sorted by id then version regardless of registration order', () => {
    const registry = registryWith(
      makeModel('b', '2'),
      makeModel('a', '1'),
      makeModel('b', '1'),
      makeModel('a', '2'),
    );
    expect(listModels(registry).map(modelRef)).toEqual(['a@1', 'a@2', 'b@1', 'b@2']);
  });

  it('orders versions by code unit — no invented semver semantics (spec 5.3)', () => {
    const registry = registryWith(makeModel('a', '10'), makeModel('a', '2'), makeModel('a', '1'));
    expect(listVersions(registry, 'a')).toEqual(['1', '10', '2']);
  });

  it('returns fresh arrays from list queries', () => {
    const registry = registryWith(makeModel('a', '1'));
    expect(listModels(registry)).not.toBe(listModels(registry));
    expect(listVersions(registry, 'a')).not.toBe(listVersions(registry, 'a'));
  });
});

describe('findModelsAffectedBy — EXT-04 pack-diff invalidation hook (spec 6.6)', () => {
  const gas = makeModel('atmo.gas', '1', {
    properties: ['gas.molarMass'],
    constants: ['C_R'],
  });
  const pipe = makeModel('atmo.pipe', '1', {
    properties: ['pipe.volume'],
    constants: [],
  });
  const both = makeModel('atmo.both', '1', {
    properties: ['gas.molarMass', 'pipe.volume'],
    constants: ['C_CP'],
  });
  const registry = registryWith(gas, pipe, both);
  const refs = (models: BehaviorModel[]) => models.map(modelRef);

  it('returns exactly the models consuming a changed property', () => {
    expect(
      refs(findModelsAffectedBy(registry, { properties: ['gas.molarMass'], constants: [] })),
    ).toEqual(['atmo.both@1', 'atmo.gas@1']);
  });

  it('returns exactly the models consuming a changed constant', () => {
    expect(refs(findModelsAffectedBy(registry, { properties: [], constants: ['C_R'] }))).toEqual(
      ['atmo.gas@1'],
    );
  });

  it('unions property and constant matches', () => {
    expect(
      refs(findModelsAffectedBy(registry, { properties: ['pipe.volume'], constants: ['C_CP'] })),
    ).toEqual(['atmo.both@1', 'atmo.pipe@1']);
  });

  it('returns every consuming model when all its inputs changed', () => {
    expect(
      refs(
        findModelsAffectedBy(registry, {
          properties: ['gas.molarMass', 'pipe.volume'],
          constants: ['C_R', 'C_CP'],
        }),
      ),
    ).toEqual(['atmo.both@1', 'atmo.gas@1', 'atmo.pipe@1']);
  });

  it('returns nothing when nothing overlaps', () => {
    expect(
      findModelsAffectedBy(registry, { properties: ['device.powerDraw'], constants: ['C_UNRELATED'] }),
    ).toEqual([]);
  });

  it('keeps properties and constants as separate namespaces', () => {
    // 'C_R' is consumed as a constant only; a changed *property* named 'C_R'
    // must not invalidate the constant consumer.
    expect(
      refs(findModelsAffectedBy(registry, { properties: ['C_R'], constants: [] })),
    ).toEqual([]);
  });

  it('ignores duplicate entries in the changed set', () => {
    expect(
      refs(
        findModelsAffectedBy(registry, {
          properties: ['gas.molarMass', 'gas.molarMass'],
          constants: [],
        }),
      ),
    ).toEqual(['atmo.both@1', 'atmo.gas@1']);
  });
});
