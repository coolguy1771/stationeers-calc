/**
 * Applying a pack diff to behavior models (EXT-04; spec 6.6 step 6, 10.2).
 *
 * The engine decides which models are affected (`findModelsAffectedBy`); this
 * module decides what to record for them. The tests pin the two rules that
 * matter: an affected model is not automatically downgraded (a weaker status is
 * never raised), and properties and constants stay separate namespaces.
 */
import type { BehaviorModel, ModelStatus } from '@stationeers/domain';
import { createModelRegistry, registerModel } from '@stationeers/engine';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { diffPacks, type PackChangelog } from './diff';
import { planModelInvalidation } from './invalidation';
import type { IrInput } from './input';
import { buildSyntheticPack, syntheticExtraction } from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';

function makeModel(
  id: string,
  version: string,
  consumes: BehaviorModel['consumes'],
  status: ModelStatus = 'verified',
): BehaviorModel {
  return {
    id,
    version,
    domain: 'smelting',
    consumes,
    envelope: { inputs: {} },
    status,
    fixtureIds: [`fixture-${id}`],
  };
}

function registryWith(...models: BehaviorModel[]) {
  return models.reduce((registry, model) => registerModel(registry, model), createModelRegistry());
}

/** A changelog in which the fixture recipe's `time` value moved. */
async function changedTimeChangelog(): Promise<PackChangelog> {
  const extraction = syntheticExtraction();
  const before = await buildSyntheticPack();
  const mutated: IrInput = structuredClone(extraction.ir);
  const target = mutated.recipes.find((candidate) => candidate.id === ALPHA);
  if (target === undefined) throw new Error('fixture recipe is missing');
  target.time = { text: '7', value: 7, unitStatus: 'unverified' };
  const after = await buildSyntheticPack({ ir: mutated });
  return diffPacks(before, after);
}

describe('planModelInvalidation', () => {
  it('returns the model consuming a changed property, with its reason', async () => {
    const changelog = await changedTimeChangelog();
    expect(changelog.invalidatingProperties).toEqual(['time']);

    const registry = registryWith(
      makeModel('smelter.throughput', '1', { properties: ['time'], constants: [] }),
      makeModel('smelter.idle', '1', { properties: ['energy'], constants: [] }),
      // Same name, different namespace: `time` is consumed as a *constant* here.
      makeModel('smelter.time-constant', '1', { properties: [], constants: ['time'] }),
    );
    const plan = planModelInvalidation(registry, changelog);

    expect(plan.models.map((entry) => entry.model)).toEqual(['smelter.throughput@1']);
    expect(plan.markUnverified).toEqual(['smelter.throughput@1']);
    expect(plan.models[0]).toMatchObject({
      id: 'smelter.throughput',
      version: '1',
      changedProperties: ['time'],
      changedConstants: [],
      statusBefore: 'verified',
      statusAfter: 'unverified',
    });
    expect(plan.models[0]?.reason).toBe('consumes changed pack inputs (spec 6.6): property "time" (value-changed)');
  });

  it('keeps properties and constants in separate namespaces', async () => {
    const changelog = await changedTimeChangelog();
    const withConstants: PackChangelog = { ...changelog, invalidatingConstants: ['C_R'] };
    const registry = registryWith(
      makeModel('gas.density', '1', { properties: [], constants: ['C_R'] }),
      // A *property* named C_R is not the constant C_R.
      makeModel('odd.property-named-like-a-constant', '1', { properties: ['C_R'], constants: [] }),
    );
    const plan = planModelInvalidation(registry, withConstants);

    expect(plan.models.map((entry) => entry.model)).toEqual(['gas.density@1']);
    expect(plan.models[0]).toMatchObject({ changedProperties: [], changedConstants: ['C_R'] });
    expect(plan.models[0]?.reason).toBe('consumes changed pack inputs (spec 6.6): constant "C_R"');
  });

  it('never raises a weaker status to unverified', async () => {
    const changelog = await changedTimeChangelog();
    const registry = registryWith(
      makeModel('smelter.verified', '1', { properties: ['time'], constants: [] }, 'verified'),
      makeModel('smelter.already-unverified', '1', { properties: ['time'], constants: [] }, 'unverified'),
      makeModel('smelter.unsupported', '1', { properties: ['time'], constants: [] }, 'unsupported'),
      makeModel('smelter.incompatible', '1', { properties: ['time'], constants: [] }, 'incompatible'),
    );
    const plan = planModelInvalidation(registry, changelog);

    expect(plan.models.map((entry) => entry.model)).toEqual([
      'smelter.already-unverified@1',
      'smelter.incompatible@1',
      'smelter.unsupported@1',
      'smelter.verified@1',
    ]);
    expect(plan.markUnverified).toEqual(['smelter.verified@1']);
    expect(plan.models.find((entry) => entry.id === 'smelter.unsupported')).toMatchObject({
      statusBefore: 'unsupported',
      statusAfter: 'unsupported',
    });
  });

  it('lists every registered version of an affected model, in canonical order', async () => {
    const changelog = await changedTimeChangelog();
    const registry = registryWith(
      makeModel('smelter.throughput', '2', { properties: ['time'], constants: [] }),
      makeModel('smelter.throughput', '1', { properties: ['time'], constants: [] }),
    );
    const plan = planModelInvalidation(registry, changelog);

    expect(plan.models.map((entry) => entry.model)).toEqual(['smelter.throughput@1', 'smelter.throughput@2']);
  });

  it('names only the inputs this model declares, not the whole changed set', async () => {
    const changelog = await changedTimeChangelog();
    const registry = registryWith(
      makeModel('smelter.throughput', '1', { properties: ['energy', 'time', 'time'], constants: [] }),
    );
    const plan = planModelInvalidation(registry, changelog);

    expect(plan.models[0]?.changedProperties).toEqual(['time']);
  });

  it('invalidates nothing when the packs are semantically identical', async () => {
    const pack = await buildSyntheticPack();
    const registry = registryWith(makeModel('smelter.throughput', '1', { properties: ['time'], constants: [] }));
    const plan = planModelInvalidation(registry, diffPacks(pack, pack));

    expect(plan.models).toEqual([]);
    expect(plan.markUnverified).toEqual([]);
    expect(plan.prevPackId).toBe(plan.nextPackId);
  });

  it('is deterministic and leaves the registry untouched', async () => {
    const changelog = await changedTimeChangelog();
    const registry = registryWith(makeModel('smelter.throughput', '1', { properties: ['time'], constants: [] }));
    const before = registry.byId.size;

    const first = planModelInvalidation(registry, changelog);
    const second = planModelInvalidation(registry, changelog);

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(registry.byId.size).toBe(before);
    expect(first.prevPackId).toBe(changelog.prevPackId);
    expect(first.nextPackId).toBe(changelog.nextPackId);
  });
});
