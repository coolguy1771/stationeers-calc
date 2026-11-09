/**
 * The shipped synthetic example, played end to end (SIM-01): the JSON file must
 * parse, pass against a trivial fake ideal-gas model, and fail when that model
 * drifts outside the fixture's tolerance.
 *
 * The example is deliberately labelled as invented. These tests prove the
 * *machinery* works on a real file; they say nothing about the game.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalStateModel, promoteFixture, replayFixture } from './replay';
import type { ReplayModel } from './replay';
import { parseReferenceFixture } from './schema';
import type { FixtureScenario, ReferenceFixture } from './schema';
import { makeBehaviorModel } from './testing';

const EXAMPLE_ID = 'example.synthetic.atmo-pressure-steady';
const PRESSURE = 'net-a.outputs.pressureKpa';
const TEMPERATURE = 'net-a.thermal.temperature';
const NETWORK = 'net-a';

/** Ideal gas constant, only so the fake model produces a plausible number. */
const IDEAL_GAS_R = 8.314462618;

function loadExample(): ReferenceFixture {
  const text = readFileSync(
    new URL('./examples/atmo-pressure-steady.example.json', import.meta.url),
    'utf8',
  );
  return parseReferenceFixture(JSON.parse(text) as unknown);
}

function exampleModel(volumeScale: number): ReplayModel {
  return finalStateModel((scenario: FixtureScenario) => {
    const inventory = scenario.inventories[NETWORK];
    if (inventory === undefined) {
      throw new Error(`example fixture must record an inventory for '${NETWORK}'`);
    }
    const volumeM3 = scenario.conditions['networkVolumeM3'];
    if (volumeM3 === undefined) {
      throw new Error('example fixture must record the network volume as a condition');
    }
    const quantities: Record<string, number | undefined> = {};
    let totalMoles = 0;
    for (const amount of inventory.species) {
      totalMoles += amount.moles;
      quantities[`${NETWORK}.moles.${amount.speciesId}.${amount.phase}`] = amount.moles;
    }
    quantities[TEMPERATURE] = inventory.thermal.value;
    quantities[PRESSURE] =
      (totalMoles * IDEAL_GAS_R * inventory.thermal.value) / (volumeM3 * volumeScale) / 1000;
    return quantities;
  });
}

function exampleBehaviorModel() {
  return makeBehaviorModel({
    envelope: {
      inputs: { temperatureK: { min: 293.15, max: 293.15 }, networkVolumeM3: { min: 1, max: 1 } },
    },
    fixtureIds: [EXAMPLE_ID],
  });
}

describe('synthetic example fixture', () => {
  it('parses, and is labelled as invented and unpromoted', () => {
    const fixture = loadExample();
    expect(fixture.fixtureId).toBe(EXAMPLE_ID);
    expect(fixture.verificationStatus).toBe('captured');
    expect(fixture.notes ?? '').toContain('SYNTHETIC');
    expect(fixture.capturedBy.notes ?? '').toContain('invented');
  });

  it('passes against the fake model and can then be promoted', () => {
    const fixture = loadExample();
    const verdict = replayFixture(fixture, exampleBehaviorModel(), exampleModel(1));
    expect(verdict.outcome).toBe('pass');
    expect(verdict.statusClaim).toBe('verified');
    expect(verdict.diagnostics).toEqual([]);
    expect(verdict.worst?.quantity).toBe(PRESSURE);
    expect(verdict.worst?.ratio).toBeLessThan(1);

    const promotion = promoteFixture(fixture, verdict);
    expect(promotion.fixture?.verificationStatus).toBe('verified');
    // The file on disk is untouched by the tests.
    expect(loadExample().verificationStatus).toBe('captured');
  });

  it('fails with the right diagnostic when the fake model drifts outside tolerance', () => {
    const fixture = loadExample();
    const verdict = replayFixture(fixture, exampleBehaviorModel(), exampleModel(1.1));
    expect(verdict.outcome).toBe('fail');
    expect(verdict.statusClaim).toBe('unverified');

    const pressure = verdict.comparisons.find((comparison) => comparison.quantity === PRESSURE);
    expect(pressure?.failureCode).toBe('SIM-FIXTURE-QUANTITY-MISMATCH');
    expect(pressure?.deviation).toBeGreaterThan(pressure?.allowed ?? 0);
    expect(verdict.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'SIM-FIXTURE-QUANTITY-MISMATCH',
    ]);
    expect(verdict.worst?.quantity).toBe(PRESSURE);
    expect(promoteFixture(fixture, verdict).fixture).toBeUndefined();
  });
});
