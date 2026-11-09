/**
 * Reference-fixture document format (SIM-01; spec 10.3, 5.2, 5.2.1, 5.4, and
 * 6.1 Adapter D).
 *
 * A reference fixture is the record of one controlled in-game experiment: the
 * scenario the operator set up, how it was observed, the samples taken, the
 * outputs a behavior model must reproduce, the tolerance justified for each of
 * those outputs, and the input ranges the capture therefore covers. The capture
 * procedure itself is `CAPTURE-WORKFLOW.md` next to this file.
 *
 * Shape decisions that matter for review:
 *
 * - **No field has a default.** Every recorded value is written down; a missing
 *   one is a parse error, never a silently assumed one (4.7, 7.6).
 * - **`verificationStatus` starts at `'captured'`.** Nothing in this module can
 *   promote a fixture. `promoteFixture` (`replay.ts`) is the only path to
 *   `'verified'`, and it refuses unless a replay verdict allows the claim (5.2).
 * - **`ticks` is the verbatim observation record; `expected` is the curated
 *   comparison contract derived from it.** The cross-checks below refuse an
 *   assertion that contradicts the recorded sample at the same tick, so a
 *   transcription slip can neither fail a correct model nor pass a wrong one.
 * - **Cross-checks are structural, not statistical**: tick ordering, the
 *   initial state, the assertion-vs-sample agreement, and tolerance coverage.
 *   Numeric agreement between two records of the same number allows 1e-9
 *   relative slack (float formatting only); everything else is exact.
 */
import * as z from 'zod';
import {
  ConnectionMediumSchema,
  DefinitionIdSchema,
  EntityIdSchema,
  InventoryStateSchema,
  MAX_SETTING_KEYS,
  MAX_SPECIES_PER_INVENTORY,
  SettingValueSchema,
  SpeciesAmountSchema,
  ValidityEnvelopeSchema,
} from '@stationeers/domain';
import type { ValidityEnvelope } from '@stationeers/domain';
import { compareStrings } from '../models/order';
import {
  MAX_ARTIFACTS,
  MAX_BUILD_LENGTH,
  MAX_CADENCE_DOMAINS,
  MAX_CONDITIONS_PER_SCENARIO,
  MAX_DEVICES_PER_NETWORK,
  MAX_DEVICES_PER_SCENARIO,
  MAX_EXPECTATIONS,
  MAX_FIXTURE_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NETWORKS_PER_SAMPLE,
  MAX_NETWORKS_PER_SCENARIO,
  MAX_NOTES_LENGTH,
  MAX_QUANTITIES_PER_RECORD,
  MAX_TEXT_LENGTH,
  MAX_TICKS,
  MAX_TICK_SAMPLES,
  MAX_TOLERANCES,
  MAX_UNIT_LENGTH,
} from './limits';
import { inventoryQuantityEntries, networkQuantityEntries, tickQuantities } from './quantities';
import { boundedRecord } from './records';

/**
 * Version of the fixture document format. A reader that does not know this
 * version fails the parse explicitly instead of guessing (9.2).
 */
export const FIXTURE_FORMAT_VERSION = '1';

/**
 * Relative slack allowed when the schema cross-checks two records of the same
 * number (an asserted value against its recorded sample, the last sample time
 * against `tickCount × tickLengthS`). It absorbs decimal formatting only: any
 * drift a human could introduce by mistyping is far larger.
 */
const CROSS_CHECK_RELATIVE_TOLERANCE = 1e-9;

const name = () => z.string().min(1).max(MAX_NAME_LENGTH);
const text = (max: number) => z.string().max(max);

/** UTC-only ISO 8601 instant: a capture timestamp must not depend on a local zone (5.5). */
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CapturedAtSchema = z
  .string()
  .regex(ISO_UTC_INSTANT, 'must be an ISO 8601 UTC timestamp, e.g. 2025-11-09T14:05:00.000Z')
  .refine((value) => Number.isFinite(Date.parse(value)), 'must be a real calendar instant');

/** Distribution branch the capture was taken on (6.4). */
export const FixtureBranchSchema = z.enum(['public', 'beta']);

/** How the operator read the values out of the game (6.1 Adapter D). */
export const CaptureMethodSchema = z.enum([
  'manual-read',
  'screenshot',
  'log-file',
  'save-file',
  'other',
]);

/**
 * Who captured the fixture and how. Recorded separately from the procedure so
 * a re-capture after a game update can ask the same operator the same way.
 */
export const CaptureDetailsSchema = z
  .object({
    /** Human operator (or 'synthetic example', for invented values). */
    operator: text(MAX_TEXT_LENGTH).min(1),
    method: CaptureMethodSchema,
    notes: text(MAX_NOTES_LENGTH).optional(),
  })
  .strict();
export type CaptureDetails = z.infer<typeof CaptureDetailsSchema>;

/**
 * A network's presence in the scenario: which medium it carries, which devices
 * sit on it, and its volume when the operator measured or verified one (4.4,
 * 4.7). Absent volume means "not measured", never a default.
 */
export const FixtureNetworkSchema = z
  .object({
    ref: EntityIdSchema,
    medium: ConnectionMediumSchema,
    /** Internal volume in m³, only when measured/verified (4.7). */
    volumeM3: z.number().finite().positive().optional(),
    devices: z.array(EntityIdSchema).max(MAX_DEVICES_PER_NETWORK),
    notes: text(MAX_NOTES_LENGTH).optional(),
  })
  .strict();
export type FixtureNetwork = z.infer<typeof FixtureNetworkSchema>;

/** A device placed in the scenario and its configuration (3.3, 10.3). */
export const FixtureDeviceSchema = z
  .object({
    ref: EntityIdSchema,
    /** Game-native prefab identifier from the pack (6.3). */
    definitionId: DefinitionIdSchema,
    settings: boundedRecord(name(), SettingValueSchema, MAX_SETTING_KEYS),
  })
  .strict();
export type FixtureDevice = z.infer<typeof FixtureDeviceSchema>;

/**
 * The scenario initial state (10.3): inventories by network, the topology
 * summary, device configuration, and the numeric conditions the behavior
 * model's validity envelope names (5.2.1).
 *
 * This object is the model's input — a replay model never sees `expected`.
 */
export const FixtureScenarioSchema = z
  .object({
    /** Initial inventory by stable network reference (4.5). */
    inventories: boundedRecord(EntityIdSchema, InventoryStateSchema, MAX_NETWORKS_PER_SCENARIO),
    /** Topology summary: which networks exist, what they carry, which devices sit on them. */
    networks: z.array(FixtureNetworkSchema).max(MAX_NETWORKS_PER_SCENARIO),
    /** Device configuration at tick 0 (10.3). */
    devices: z.array(FixtureDeviceSchema).max(MAX_DEVICES_PER_SCENARIO),
    /**
     * Numeric conditions of the capture, keyed exactly as the behavior model's
     * envelope names them (`temperatureK`, `networkVolumeM3`, …). A condition
     * the model declares but the fixture omits is reported by the replay's
     * envelope check, not defaulted (5.2.1).
     */
    conditions: boundedRecord(name(), z.number().finite(), MAX_CONDITIONS_PER_SCENARIO),
  })
  .strict();
export type FixtureScenario = z.infer<typeof FixtureScenarioSchema>;

/** The canonical thermal variable of an inventory or observation (4.5). */
export const FixtureThermalStateSchema = z
  .object({
    kind: z.enum(['temperature', 'internal-energy']),
    value: z.number().finite(),
    unit: z.string().min(1).max(MAX_UNIT_LENGTH),
  })
  .strict();
export type FixtureThermalState = z.infer<typeof FixtureThermalStateSchema>;

/**
 * One network's observed state at a sample: moles by species and phase, the
 * canonical thermal variable, and any measured device readouts (10.3).
 */
export const ObservedNetworkStateSchema = z
  .object({
    moles: z.array(SpeciesAmountSchema).max(MAX_SPECIES_PER_INVENTORY),
    thermal: FixtureThermalStateSchema,
    outputs: boundedRecord(name(), z.number().finite(), MAX_QUANTITIES_PER_RECORD).optional(),
  })
  .strict();
export type ObservedNetworkState = z.infer<typeof ObservedNetworkStateSchema>;

/** One recorded sample of the observation window, ordered by `tick` (10.3). */
export const TickSampleSchema = z
  .object({
    /** Tick index since the initial state; the comparison index (5.4). */
    tick: z.number().int().nonnegative().max(MAX_TICKS),
    /** Simulated seconds elapsed at the sample. */
    timeS: z.number().finite().nonnegative(),
    networks: boundedRecord(EntityIdSchema, ObservedNetworkStateSchema, MAX_NETWORKS_PER_SAMPLE),
    notes: text(MAX_NOTES_LENGTH).optional(),
  })
  .strict();
export type TickSample = z.infer<typeof TickSampleSchema>;

/**
 * The observation protocol (10.3, 5.4): the tick model the run was read
 * against, how long it ran, how often it was sampled, and how many independent
 * runs back the numbers.
 */
export const ObservationProtocolSchema = z
  .object({
    /**
     * Game tick length in seconds for the domain under test (5.4). Extracted
     * per build, never assumed — hence `tickLengthSource` below.
     */
    tickLengthS: z.number().finite().positive(),
    /** Where that value came from: the pinned pack, or the operator's own measurement. */
    tickLengthSource: z.enum(['pack', 'measured']),
    /** Ticks from the initial state through the last recorded sample. */
    tickCount: z.number().int().nonnegative().max(MAX_TICKS),
    /** Simulated seconds between reads, as the operator actually sampled. */
    sampleIntervalS: z.number().finite().positive(),
    /** How the samples were taken, in the operator's words (screenshots, log lines, reads). */
    sampling: text(MAX_TEXT_LENGTH).min(1),
    /** Independent runs captured; >1 documents the run-to-run spread the tolerances cover (5.4). */
    runs: z.number().int().positive(),
    /** Per-domain update cadence when it differs from the base tick, in ticks (5.4). */
    cadenceTicks: boundedRecord(name(), z.number().int().positive(), MAX_CADENCE_DOMAINS).optional(),
  })
  .strict();
export type ObservationProtocol = z.infer<typeof ObservationProtocolSchema>;

/**
 * One asserted quantity of the recorded game output (10.3). `expected` values
 * must agree with the recorded sample at the same tick — the schema refuses
 * any other value, so the assertion set can only ever be a curated subset of
 * what was captured.
 */
export const ExpectedSampleSchema = z
  .object({
    /** Tick index of the recorded sample this assertion is anchored to. */
    tick: z.number().int().nonnegative().max(MAX_TICKS),
    /** Quantity key → recorded game value (see `quantities.ts` for the grammar). */
    quantities: boundedRecord(name(), z.number().finite(), MAX_QUANTITIES_PER_RECORD),
  })
  .strict()
  .superRefine((expected, ctx) => {
    if (Object.keys(expected.quantities).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantities'],
        message: 'an expectation must assert at least one quantity',
      });
    }
  });
export type ExpectedSample = z.infer<typeof ExpectedSampleSchema>;

/**
 * Comparison tolerance for one quantity (5.4). The allowed deviation is
 * `abs + rel × |expected|`, so `abs` is a floor in the quantity's own unit and
 * `rel` scales with magnitude; both absent means the quantity must match
 * exactly. `basis` is mandatory: a tolerance without a stated justification is
 * a guess, and the observed run-to-run spread is the justification (5.4).
 */
export const ToleranceSchema = z
  .object({
    /** Absolute slack, in the quantity's unit. */
    abs: z.number().finite().nonnegative().optional(),
    /** Relative slack as a fraction of |expected|. */
    rel: z.number().finite().nonnegative().optional(),
    /** Why this tolerance holds — observed run-to-run variation, readout granularity (5.4). */
    basis: z.string().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();
export type Tolerance = z.infer<typeof ToleranceSchema>;

/** Per-quantity tolerances; no defaults, because every comparison needs its own justification. */
export const FixtureTolerancesSchema = z
  .object({
    quantities: boundedRecord(name(), ToleranceSchema, MAX_TOLERANCES),
  })
  .strict();
export type FixtureTolerances = z.infer<typeof FixtureTolerancesSchema>;

/** Where the observation came from: what the operator did in-game, and the artifacts that back it. */
export const SourceReferenceSchema = z
  .object({
    /** What the operator did in-game, step by step (6.1 Adapter D). */
    procedure: z.string().min(1).max(MAX_NOTES_LENGTH),
    /** Supporting evidence: save names, screenshot ids, log line ranges, video timestamps. */
    artifacts: z.array(text(MAX_TEXT_LENGTH).min(1)).max(MAX_ARTIFACTS).optional(),
  })
  .strict();
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

/**
 * Verification status of a fixture (5.2). A fixture is authored as
 * `'captured'`; only `promoteFixture` (`replay.ts`, given a passing replay
 * verdict) or a human editing the file may set `'verified'`.
 */
export const FixtureVerificationStatusSchema = z.enum(['captured', 'verified']);
export type FixtureVerificationStatus = z.infer<typeof FixtureVerificationStatusSchema>;

/**
 * A reference fixture document (10.3) — the format is the contract, so this
 * schema is the single source of truth for it.
 */
export const ReferenceFixtureSchema = z
  .object({
    fixtureVersion: z.literal(FIXTURE_FORMAT_VERSION),
    /** Stable identity of this capture; referenced by `BehaviorModel.fixtureIds`. */
    fixtureId: z.string().min(1).max(MAX_FIXTURE_ID_LENGTH),
    /** Full build number, verbatim from the game (6.4) — not a marketing version. */
    gameBuild: z.string().min(1).max(MAX_BUILD_LENGTH),
    branch: FixtureBranchSchema,
    capturedAt: CapturedAtSchema,
    capturedBy: CaptureDetailsSchema,
    scenario: FixtureScenarioSchema,
    observation: ObservationProtocolSchema,
    /** Verbatim observation record, ordered by tick, starting at the initial state. */
    ticks: z.array(TickSampleSchema).min(1).max(MAX_TICK_SAMPLES),
    /** Recorded game outputs the model must reproduce, curated from `ticks`. */
    expected: z.array(ExpectedSampleSchema).min(1).max(MAX_EXPECTATIONS),
    tolerances: FixtureTolerancesSchema,
    /** The validity envelope this fixture contributes to the behavior model (5.2.1). */
    envelope: ValidityEnvelopeSchema,
    sourceReference: SourceReferenceSchema,
    verificationStatus: FixtureVerificationStatusSchema,
    notes: text(MAX_NOTES_LENGTH).optional(),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    checkTickSequence(fixture.ticks, fixture.observation, ctx);
    checkSampleQuantities(fixture.ticks, ctx);
    checkScenarioTopology(fixture.scenario, ctx);
    checkInitialState(fixture.scenario, fixture.ticks, ctx);
    checkExpectations(fixture.ticks, fixture.expected, ctx);
    checkTolerances(fixture.expected, fixture.tolerances, ctx);
    checkEnvelope(fixture.envelope, fixture.scenario.conditions, ctx);
  });
export type ReferenceFixture = z.infer<typeof ReferenceFixtureSchema>;

/**
 * Parse a fixture document. Throws a `ZodError` whose issues carry the exact
 * document path of every problem; `describeFixtureIssues` renders them for a
 * human.
 */
export function parseReferenceFixture(value: unknown): ReferenceFixture {
  return ReferenceFixtureSchema.parse(value);
}

/** One line per issue of a failed fixture parse, with the document path. */
export function describeFixtureIssues(error: unknown): string[] {
  if (!(error instanceof z.ZodError)) {
    return [String(error)];
  }
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '<document>' : issue.path.map(String).join('.');
    return `${path}: ${issue.message}`;
  });
}

// ---------------------------------------------------------------------------
// Cross-checks. They only add issues; field-level shape is handled above.
// ---------------------------------------------------------------------------

function addIssue(ctx: z.RefinementCtx, path: PropertyKey[], message: string): void {
  ctx.addIssue({ code: 'custom', path, message });
}

function closeEnough(a: number, b: number): boolean {
  if (a === b) {
    return true;
  }
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= CROSS_CHECK_RELATIVE_TOLERANCE * scale;
}

/** The observation window must be an ordered run that starts at the initial state and ends at `tickCount` (5.4). */
function checkTickSequence(
  ticks: readonly TickSample[],
  observation: ObservationProtocol,
  ctx: z.RefinementCtx,
): void {
  const first = ticks[0];
  if (first === undefined) {
    return;
  }
  if (first.tick !== 0) {
    addIssue(
      ctx,
      ['ticks', 0, 'tick'],
      'the first recorded sample is the scenario initial state and must be tick 0',
    );
  }
  if (first.timeS !== 0) {
    addIssue(ctx, ['ticks', 0, 'timeS'], 'the first sample is the initial state, so its time is 0 s');
  }
  let previous: TickSample | undefined;
  for (const [index, sample] of ticks.entries()) {
    if (sample.tick > observation.tickCount) {
      addIssue(
        ctx,
        ['ticks', index, 'tick'],
        `tick ${sample.tick} lies past the end of the observation window (tickCount ${observation.tickCount})`,
      );
    }
    if (previous !== undefined) {
      if (sample.tick <= previous.tick) {
        addIssue(
          ctx,
          ['ticks', index, 'tick'],
          `ticks must strictly increase: ${sample.tick} follows ${previous.tick}`,
        );
      }
      if (sample.timeS < previous.timeS) {
        addIssue(
          ctx,
          ['ticks', index, 'timeS'],
          `recorded times must not decrease: ${sample.timeS} s follows ${previous.timeS} s`,
        );
      }
    }
    previous = sample;
  }
  const lastIndex = ticks.length - 1;
  const last = ticks[lastIndex];
  if (last === undefined) {
    return;
  }
  if (last.tick !== observation.tickCount) {
    addIssue(
      ctx,
      ['ticks', lastIndex, 'tick'],
      `tickCount must equal the last recorded sample's tick (${observation.tickCount} ≠ ${last.tick}); ` +
        'record the window as the ticks between the initial state and the last sample',
    );
  }
  const windowEndS = observation.tickCount * observation.tickLengthS;
  if (!closeEnough(last.timeS, windowEndS)) {
    addIssue(
      ctx,
      ['ticks', lastIndex, 'timeS'],
      `the last sample records ${last.timeS} s but tickCount × tickLengthS = ${windowEndS} s; ` +
        'record the tick length and the sample time consistently',
    );
  }
}

/** A sample must not produce the same quantity key twice — an ambiguous comparison is never run. */
function checkSampleQuantities(ticks: readonly TickSample[], ctx: z.RefinementCtx): void {
  for (const [index, sample] of ticks.entries()) {
    const seen = new Set<string>();
    for (const networkRef of Object.keys(sample.networks).sort(compareStrings)) {
      const state = sample.networks[networkRef];
      if (state === undefined) {
        continue;
      }
      for (const entry of networkQuantityEntries(networkRef, state)) {
        if (seen.has(entry.key)) {
          addIssue(
            ctx,
            ['ticks', index, 'networks', networkRef],
            `quantity key '${entry.key}' is produced more than once in this sample; ` +
              'rename the identifier that contains a dot so each quantity is unambiguous',
          );
        }
        seen.add(entry.key);
      }
    }
  }
}

/** The topology summary must list every network the scenario seeds, exactly once (10.3). */
function checkScenarioTopology(scenario: FixtureScenario, ctx: z.RefinementCtx): void {
  const listed = new Set<string>();
  for (const [index, network] of scenario.networks.entries()) {
    if (listed.has(network.ref)) {
      addIssue(
        ctx,
        ['scenario', 'networks', index, 'ref'],
        `network '${network.ref}' is described twice; the topology summary must name each network once`,
      );
    }
    listed.add(network.ref);
  }
  for (const networkRef of Object.keys(scenario.inventories).sort(compareStrings)) {
    if (!listed.has(networkRef)) {
      addIssue(
        ctx,
        ['scenario', 'inventories', networkRef],
        `network '${networkRef}' has an initial inventory but is missing from scenario.networks; ` +
          'record its medium and the devices on it (10.3)',
      );
    }
  }
}

/** The tick-0 sample and the scenario inventory are records of the same state and must agree (4.5, 8). */
function checkInitialState(
  scenario: FixtureScenario,
  ticks: readonly TickSample[],
  ctx: z.RefinementCtx,
): void {
  const initial = ticks[0];
  if (initial === undefined) {
    return;
  }
  for (const networkRef of Object.keys(initial.networks).sort(compareStrings)) {
    if (!Object.hasOwn(scenario.inventories, networkRef)) {
      addIssue(
        ctx,
        ['ticks', 0, 'networks', networkRef],
        `the tick-0 sample reports network '${networkRef}' but the scenario records no initial ` +
          'inventory for it (spec 8: insufficient initial conditions)',
      );
    }
  }
  for (const networkRef of Object.keys(scenario.inventories).sort(compareStrings)) {
    const inventory = scenario.inventories[networkRef];
    const observed = initial.networks[networkRef];
    if (inventory === undefined) {
      continue;
    }
    if (observed === undefined) {
      addIssue(
        ctx,
        ['scenario', 'inventories', networkRef],
        `the scenario records an initial inventory for network '${networkRef}' but the tick-0 ` +
          'sample omits that network',
      );
      continue;
    }
    const recorded = new Map(
      inventoryQuantityEntries(networkRef, inventory).map((entry) => [entry.key, entry.value]),
    );
    const sampled = new Map(
      inventoryQuantityEntries(networkRef, {
        species: observed.moles,
        thermal: observed.thermal,
      }).map((entry) => [entry.key, entry.value]),
    );
    for (const key of [...recorded.keys()].sort(compareStrings)) {
      const sampledValue = sampled.get(key);
      const recordedValue = recorded.get(key);
      if (recordedValue === undefined) {
        continue;
      }
      if (sampledValue === undefined) {
        addIssue(
          ctx,
          ['ticks', 0, 'networks', networkRef],
          `'${key}' is recorded in the scenario inventory but missing from the tick-0 sample`,
        );
      } else if (!closeEnough(sampledValue, recordedValue)) {
        addIssue(
          ctx,
          ['ticks', 0, 'networks', networkRef],
          `'${key}' is ${recordedValue} in the scenario inventory but ${sampledValue} in the ` +
            'tick-0 sample; the initial state must be recorded once and agree',
        );
      }
    }
    for (const key of [...sampled.keys()].sort(compareStrings)) {
      if (!recorded.has(key)) {
        addIssue(
          ctx,
          ['ticks', 0, 'networks', networkRef],
          `'${key}' appears in the tick-0 sample but not in the scenario inventory`,
        );
      }
    }
  }
}

/** An assertion must reproduce what the capture recorded at that tick (10.3). */
function checkExpectations(
  ticks: readonly TickSample[],
  expected: readonly ExpectedSample[],
  ctx: z.RefinementCtx,
): void {
  const recordedByTick = new Map<number, Record<string, number>>();
  for (const sample of ticks) {
    recordedByTick.set(sample.tick, tickQuantities(sample));
  }
  for (const [index, expectation] of expected.entries()) {
    const recorded = recordedByTick.get(expectation.tick);
    if (recorded === undefined) {
      addIssue(
        ctx,
        ['expected', index, 'tick'],
        `expected tick ${expectation.tick} is not a recorded sample tick`,
      );
      continue;
    }
    for (const quantity of Object.keys(expectation.quantities).sort(compareStrings)) {
      const asserted = expectation.quantities[quantity];
      const actual = recorded[quantity];
      if (asserted === undefined) {
        continue;
      }
      if (actual === undefined) {
        addIssue(
          ctx,
          ['expected', index, 'quantities', quantity],
          `the sample at tick ${expectation.tick} records no quantity '${quantity}'; ` +
            'assert only quantities the capture recorded',
        );
      } else if (!closeEnough(asserted, actual)) {
        addIssue(
          ctx,
          ['expected', index, 'quantities', quantity],
          `'${quantity}' is asserted as ${asserted} but the sample at tick ${expectation.tick} ` +
            `recorded ${actual}; an assertion can only be a curated copy of the capture`,
        );
      }
    }
  }
}

/** Every compared quantity has a declared tolerance, and no tolerance is orphaned (5.4). */
function checkTolerances(
  expected: readonly ExpectedSample[],
  tolerances: FixtureTolerances,
  ctx: z.RefinementCtx,
): void {
  const asserted = new Set<string>();
  for (const expectation of expected) {
    for (const quantity of Object.keys(expectation.quantities)) {
      asserted.add(quantity);
    }
  }
  for (const quantity of [...asserted].sort(compareStrings)) {
    if (tolerances.quantities[quantity] === undefined) {
      addIssue(
        ctx,
        ['tolerances', 'quantities', quantity],
        `asserted quantity '${quantity}' has no declared tolerance; every compared quantity needs ` +
          'one, justified by observed run-to-run variation (5.4)',
      );
    }
  }
  for (const quantity of Object.keys(tolerances.quantities).sort(compareStrings)) {
    if (!asserted.has(quantity)) {
      addIssue(
        ctx,
        ['tolerances', 'quantities', quantity],
        `a tolerance is declared for '${quantity}' which no expectation asserts; ` +
          'remove the tolerance or restore the assertion',
      );
    }
  }
}

/** A fixture must state the input ranges it covers, and only ranges it actually captured (5.2.1). */
function checkEnvelope(
  envelope: ValidityEnvelope,
  conditions: Readonly<Record<string, number>>,
  ctx: z.RefinementCtx,
): void {
  const inputs = Object.keys(envelope.inputs).sort(compareStrings);
  if (inputs.length === 0) {
    addIssue(
      ctx,
      ['envelope', 'inputs'],
      'a fixture must declare at least one input range it covers (5.2.1); ' +
        'an envelope-less capture cannot support a Verified claim',
    );
  }
  for (const input of inputs) {
    const bounds = envelope.inputs[input];
    if (bounds === undefined) {
      continue;
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) {
      addIssue(
        ctx,
        ['envelope', 'inputs', input],
        `min ${bounds.min} exceeds max ${bounds.max}`,
      );
    }
    if (!Object.hasOwn(conditions, input)) {
      addIssue(
        ctx,
        ['envelope', 'inputs', input],
        `envelope input '${input}' is not recorded in scenario.conditions; the fixture cannot ` +
          'state a range for an input it did not capture (5.2.1)',
      );
    }
  }
}
