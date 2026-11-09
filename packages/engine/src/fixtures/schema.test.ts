import { describe, expect, it } from 'vitest';
import {
  FIXTURE_FORMAT_VERSION,
  ReferenceFixtureSchema,
  describeFixtureIssues,
  parseReferenceFixture,
} from './schema';
import { makeFixture, makeObservation, makeSample } from './testing';

/** Issue paths of a rejected document, so a test can name the exact field. */
function issuePaths(value: unknown): string[] {
  const result = ReferenceFixtureSchema.safeParse(value);
  if (result.success) {
    throw new Error(`expected the fixture to be rejected: ${JSON.stringify(value)}`);
  }
  return result.error.issues.map((issue) => issue.path.map(String).join('.'));
}

describe('ReferenceFixtureSchema — the format itself (10.3)', () => {
  it('pins the format version', () => {
    expect(FIXTURE_FORMAT_VERSION).toBe('1');
  });

  it('accepts a complete fixture', () => {
    const fixture = makeFixture();
    expect(parseReferenceFixture(fixture)).toEqual(fixture);
  });

  it('round-trips through JSON unchanged', () => {
    const fixture = makeFixture();
    const parsed = parseReferenceFixture(JSON.parse(JSON.stringify(fixture)) as unknown);
    expect(parsed).toEqual(fixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(JSON.parse(JSON.stringify(fixture)));
  });

  it('has no defaults: every field must be written down', () => {
    const withoutOptionalNotes = makeFixture();
    delete withoutOptionalNotes.notes;
    expect(parseReferenceFixture(withoutOptionalNotes).fixtureId).toBe(
      withoutOptionalNotes.fixtureId,
    );

    const withoutRuns = makeFixture();
    // `runs` is a recorded observation fact, not something to assume (5.4).
    const doc: unknown = {
      ...withoutRuns,
      observation: { ...withoutRuns.observation, runs: undefined },
    };
    expect(issuePaths(doc)).toContain('observation.runs');
  });

  it('rejects an unknown field instead of silently dropping it', () => {
    const fixture = { ...makeFixture(), surprise: true };
    const result = ReferenceFixtureSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describeFixtureIssues(result.error).join(' ')).toContain('surprise');
    }
  });

  it('rejects an unknown format version explicitly', () => {
    expect(issuePaths({ ...makeFixture(), fixtureVersion: '2' })).toContain('fixtureVersion');
  });

  it('requires a UTC ISO 8601 capture timestamp', () => {
    expect(issuePaths({ ...makeFixture(), capturedAt: '2025-11-09 12:00' })).toContain('capturedAt');
    expect(issuePaths({ ...makeFixture(), capturedAt: '2025-13-40T12:00:00.000Z' })).toContain(
      'capturedAt',
    );
  });

  it('rejects an unknown capture method', () => {
    const doc: unknown = { ...makeFixture(), capturedBy: { operator: 'x', method: 'telepathy' } };
    expect(issuePaths(doc)).toContain('capturedBy.method');
  });

  it('renders issues as path-prefixed lines', () => {
    const result = ReferenceFixtureSchema.safeParse({ ...makeFixture(), fixtureVersion: '9' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const lines = describeFixtureIssues(result.error);
      expect(lines).toHaveLength(result.error.issues.length);
      expect(lines[0]).toMatch(/^fixtureVersion: /);
    }
    expect(describeFixtureIssues(new Error('boom'))).toEqual(['Error: boom']);
  });
});

describe('ReferenceFixtureSchema — observation window consistency (5.4)', () => {
  it('requires the first sample to be the initial state at tick 0 and time 0', () => {
    const fixture = makeFixture();
    fixture.ticks = [{ ...makeSample(3, 3, 249.4) }];
    fixture.observation = makeObservation({ tickCount: 3 });
    expect(issuePaths(fixture)).toContain('ticks.0.tick');
  });

  it('requires recorded times to start at 0 s', () => {
    const fixture = makeFixture();
    fixture.ticks = [makeSample(0, 2, 249.4)];
    fixture.observation = makeObservation({ tickCount: 0 });
    expect(issuePaths(fixture)).toContain('ticks.0.timeS');
  });

  it('requires tickCount to equal the last recorded sample', () => {
    const fixture = makeFixture();
    fixture.observation = makeObservation({ tickCount: 1 });
    expect(issuePaths(fixture)).toContain('ticks.0.tick');
  });

  it('requires strictly increasing ticks', () => {
    const fixture = makeFixture();
    fixture.ticks = [makeSample(0, 0, 249.4), makeSample(1, 1, 250), makeSample(1, 2, 251)];
    fixture.observation = makeObservation({ tickCount: 1 });
    expect(issuePaths(fixture)).toContain('ticks.2.tick');
  });

  it('requires the last sample time to follow from the tick model', () => {
    const fixture = makeFixture();
    fixture.ticks = [makeSample(0, 0, 249.4), makeSample(2, 3, 250)];
    fixture.observation = makeObservation({ tickCount: 2 });
    expect(issuePaths(fixture)).toContain('ticks.1.timeS');
  });

  it('rejects a sample whose quantity keys collide', () => {
    const fixture = makeFixture();
    fixture.scenario.networks = [
      { ref: 'net', medium: 'gas-pipe', devices: [] },
      { ref: 'net.moles', medium: 'gas-pipe', devices: [] },
    ];
    fixture.ticks = [
      {
        tick: 0,
        timeS: 0,
        networks: {
          net: {
            moles: [{ speciesId: 'moles.Oxygen', phase: 'gas', moles: 1 }],
            thermal: { kind: 'temperature', value: 300, unit: 'K' },
          },
          'net.moles': {
            moles: [{ speciesId: 'Oxygen', phase: 'gas', moles: 1 }],
            thermal: { kind: 'temperature', value: 300, unit: 'K' },
          },
        },
      },
    ];
    fixture.expected = [{ tick: 0, quantities: { 'net.moles.moles.Oxygen.gas': 1 } }];
    fixture.tolerances = {
      quantities: { 'net.moles.moles.Oxygen.gas': { abs: 0, basis: 'same quantity' } },
    };
    expect(issuePaths(fixture)).toContain('ticks.0.networks.net.moles');
  });
});

describe('ReferenceFixtureSchema — initial state agreement (4.5, 8)', () => {
  it('rejects a scenario inventory that disagrees with the tick-0 sample', () => {
    const fixture = makeFixture();
    fixture.scenario.inventories['net-a'] = {
      species: [{ speciesId: 'Oxygen', phase: 'gas', moles: 101 }],
      thermal: { kind: 'temperature', value: 300, unit: 'K' },
    };
    expect(issuePaths(fixture)).toContain('ticks.0.networks.net-a');
  });

  it('rejects a sampled network with no recorded initial inventory', () => {
    const fixture = makeFixture();
    const sample = fixture.ticks[0];
    if (sample === undefined) throw new Error('fixture has no sample');
    sample.networks['net-b'] = {
      moles: [{ speciesId: 'Nitrogen', phase: 'gas', moles: 5 }],
      thermal: { kind: 'temperature', value: 300, unit: 'K' },
    };
    expect(issuePaths(fixture)).toContain('ticks.0.networks.net-b');
  });

  it('requires the topology summary to cover a seeded network', () => {
    const fixture = makeFixture();
    fixture.scenario.networks = [];
    expect(issuePaths(fixture)).toContain('scenario.inventories.net-a');
  });

  it('rejects a network described twice in the topology summary', () => {
    const fixture = makeFixture();
    fixture.scenario.networks = [
      { ref: 'net-a', medium: 'gas-pipe', devices: [] },
      { ref: 'net-a', medium: 'gas-pipe', devices: [] },
    ];
    expect(issuePaths(fixture)).toContain('scenario.networks.1.ref');
  });

  it('rejects an initial inventory the tick-0 sample omits', () => {
    const fixture = makeFixture();
    fixture.scenario.inventories['net-b'] = {
      species: [{ speciesId: 'Nitrogen', phase: 'gas', moles: 5 }],
      thermal: { kind: 'temperature', value: 300, unit: 'K' },
    };
    expect(issuePaths(fixture)).toContain('scenario.inventories.net-b');
  });
});

describe('ReferenceFixtureSchema — assertions are curated copies, not new numbers (10.3)', () => {
  it('rejects an asserted value that contradicts the recorded sample', () => {
    const fixture = makeFixture();
    fixture.expected = [{ tick: 0, quantities: { 'net-a.outputs.pressureKpa': 260 } }];
    expect(issuePaths(fixture)).toContain('expected.0.quantities.net-a.outputs.pressureKpa');
  });

  it('accepts a value that differs only by float formatting', () => {
    const fixture = makeFixture();
    fixture.expected = [{ tick: 0, quantities: { 'net-a.outputs.pressureKpa': 249.4000000000001 } }];
    expect(parseReferenceFixture(fixture).expected[0]?.quantities['net-a.outputs.pressureKpa']).toBe(
      249.4000000000001,
    );
  });

  it('rejects an assertion at a tick that was not sampled', () => {
    const fixture = makeFixture();
    fixture.expected = [{ tick: 4, quantities: { 'net-a.outputs.pressureKpa': 249.4 } }];
    expect(issuePaths(fixture)).toContain('expected.0.tick');
  });

  it('rejects an assertion for a quantity the sample does not record', () => {
    const fixture = makeFixture();
    fixture.expected = [{ tick: 0, quantities: { 'net-a.outputs.ghost': 1 } }];
    fixture.tolerances = { quantities: { 'net-a.outputs.ghost': { abs: 0, basis: 'x' } } };
    expect(issuePaths(fixture)).toContain('expected.0.quantities.net-a.outputs.ghost');
  });

  it('rejects an expectation that asserts nothing', () => {
    const fixture = makeFixture();
    fixture.expected = [{ tick: 0, quantities: {} }];
    fixture.tolerances = { quantities: {} };
    expect(issuePaths(fixture)).toContain('expected.0.quantities');
  });
});

describe('ReferenceFixtureSchema — tolerances and envelope (5.2.1, 5.4)', () => {
  it('rejects an asserted quantity with no tolerance', () => {
    const fixture = makeFixture();
    fixture.tolerances = { quantities: {} };
    expect(issuePaths(fixture)).toContain('tolerances.quantities.net-a.outputs.pressureKpa');
  });

  it('rejects a tolerance that no assertion uses', () => {
    const fixture = makeFixture();
    fixture.tolerances.quantities['net-a.thermal.temperature'] = { abs: 1, basis: 'extra' };
    expect(issuePaths(fixture)).toContain('tolerances.quantities.net-a.thermal.temperature');
  });

  it('requires a stated basis for every tolerance', () => {
    const doc: unknown = {
      ...makeFixture(),
      tolerances: { quantities: { 'net-a.outputs.pressureKpa': { abs: 1 } } },
    };
    expect(issuePaths(doc)).toContain('tolerances.quantities.net-a.outputs.pressureKpa.basis');
  });

  it('requires at least one covered input range', () => {
    const fixture = makeFixture();
    fixture.envelope = { inputs: {} };
    expect(issuePaths(fixture)).toContain('envelope.inputs');
  });

  it('rejects an inverted range', () => {
    const fixture = makeFixture();
    fixture.envelope.inputs['temperatureK'] = { min: 400, max: 300 };
    expect(issuePaths(fixture)).toContain('envelope.inputs.temperatureK');
  });

  it('rejects an envelope input the capture did not record', () => {
    const fixture = makeFixture();
    fixture.envelope.inputs['pressureKpa'] = { min: 1, max: 2 };
    expect(issuePaths(fixture)).toContain('envelope.inputs.pressureKpa');
  });

  it('never accepts a Verified status written by the parser', () => {
    // The parser accepts a stored claim (a human may promote a fixture) but it
    // cannot invent one: the status is whatever the document says.
    const captured = makeFixture();
    expect(parseReferenceFixture(captured).verificationStatus).toBe('captured');
    expect(issuePaths({ ...captured, verificationStatus: 'trusted' })).toContain(
      'verificationStatus',
    );
  });
});
