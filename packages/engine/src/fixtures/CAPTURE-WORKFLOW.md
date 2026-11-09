# Capturing a reference fixture (SIM-01)

How a human operator records one controlled in-game experiment so a behavior model
can be Verified against it (spec 5.2, 10.3, 6.1 Adapter D). This is the only way
the engine earns the word "exact": it compares against what the game actually
did, not against equations that look right.

The format itself is `schema.ts`; the shape of a real document is
`examples/atmo-pressure-steady.example.json` (invented values, clearly labelled).
Read this page once before your first capture; after that the checklist at the
end is enough.

Agents cannot do this. It needs the game, a clean vanilla install, and patience.

---

## 0. Hard prerequisites

1. **Clean vanilla install of the pinned build.** No mods, no Workshop content,
   no config edits that change behaviour (spec 6.3). If you cannot vouch for the
   install, do not capture — a contaminated capture poisons every model that
   uses it.
2. **Record the build verbatim.** Copy the full build number and the branch
   (`public` or `beta`) from the game itself. Not a marketing version, not the
   Steam page (6.4). Put it in `gameBuild` / `branch`.
3. **One mechanic per fixture.** A fixture verifies one behavior model: one
   medium, one network, one setting you vary. If you want to vary two things,
   capture two fixtures.
4. **Know the model's inputs and outputs first.** Write down, before you touch
   the game, the numeric conditions the model will declare in its envelope
   (`temperatureK`, `networkVolumeM3`, …) and the quantities it must reproduce.
   If you cannot name them, the capture cannot be aimed.

## 1. Write down what you are testing

Draft the model's account before capturing:

- **inputs** (`BehaviorModel.envelope.inputs`): the scenarios you intend the
  model to be valid over. Every one of these names must appear in
  `scenario.conditions`, because a fixture only covers what it captured (5.2.1).
- **outputs** (the quantity keys you will assert): use the canonical grammar from
  `quantities.ts` — `<networkRef>.moles.<speciesId>.<phase>`,
  `<networkRef>.thermal.<kind>`, `<networkRef>.outputs.<name>`.
- **what the model consumes from the pack** (`BehaviorModel.consumes`). If you
  do not need a pack property, do not list it — 6.6 invalidates listed models on
  every pack change.

## 2. Set up the scenario

1. Use a world you can control and reload: record its name in `sourceReference`.
2. Build the smallest topology that isolates the mechanic. One network, the
   minimum devices needed to read or drive it, nothing else touching it.
3. Record the network reference you use in the fixture (`net-a`, …). It is your
   own stable id, and every quantity key is built from it.
4. Record the network's medium, its measured internal volume when you have one,
   and which devices sit on it (`scenario.networks`). If the volume is not
   measured, leave `volumeM3` out — absence is reported, never defaulted (4.7).
5. Fill the inventory you are starting from: moles by species and phase, plus the
   canonical thermal variable (`scenario.inventories`).
6. If the mechanic depends on a configurable device, record its settings as you
   set them (`scenario.devices[].settings`) — not as you remember them.

## 3. Fix the reference state (tick 0)

Tick 0 is the state the model starts from. It must be the same numbers as
`scenario.inventories`; the schema rejects a fixture where the two disagree, so
copy the values rather than retyping them from memory.

Take the tick-0 readings *before* the mechanic does anything (before you open the
valve, before the device is switched on, before the heater starts). Record them
as the first sample in `ticks` with `tick: 0`, `timeS: 0`.

## 4. Record the tick model (5.4)

- `observation.tickLengthS` is the update interval of the domain under test for
  this build. Take it from the pack when the pack has it for this build
  (`tickLengthSource: "pack"`).
- If the pack does not have it yet, **measure it**: watch a repeating observable
  update over at least 30 s, divide the elapsed simulated time by the number of
  updates you counted, and record `tickLengthSource: "measured"` plus the
  window and the method in `sourceReference.procedure`. Never guess a value and
  never copy one from another build.
- `observation.tickCount` is the number of ticks between the initial state and
  the last sample. It must equal the last sample's `tick`; the schema enforces
  this, together with `last.timeS = tickCount × tickLengthS`.
- When a domain updates less often than the base tick, record the cadence in
  `observation.cadenceTicks` (`{ "atmospherics": 2 }` = one update every two
  ticks). Leave it out when the domain runs at the base tick.

## 5. Observe and sample

1. Decide the sampling cadence before you start and keep it: `sampleIntervalS`.
   The cadence is the recording interval, in simulated seconds.
2. Record every sample with its tick index and the simulated time you read
   (`ticks[].timeS`). Times must not go backwards and the first one is 0.
3. Put the same simulated time into the tick grid: sample `n` sits at
   `tick: round(timeS / tickLengthS)` unless the domain's cadence says otherwise.
   The comparison itself is always by tick index.
4. Capture the readouts as the game shows them — screenshot each sample and name
   the files in `sourceReference.artifacts` (`shot-001.png` …), or record log
   lines and their range.
5. Do not change device settings, add or remove devices, or open anything
   mid-run. If you must, that is the end of the run and the start of a new
   fixture.
6. For a **static/closed-form** mechanic (§13 #11: shared volume, pressure from
   moles/species/thermal state) capture the *steady state only*: wait until the
   readings stop changing, then take one sample at tick 0 and set
   `observation.tickCount` to 0. Transient fixtures are for time-stepped
   mechanics, and a final-state model cannot answer a transient assertion.
7. Stop when you have what the model must reproduce. Extra samples are cheap
   only if you also record them accurately.

## 6. Fill `ticks`, then curate `expected`

- `ticks` is the **verbatim record**: every sample exactly as read, including
  quantities you will not assert (they are the audit trail).
- `expected` is the **comparison contract**: the subset the model must
  reproduce, with the value copied from the recorded sample at that tick. The
  schema refuses any value that contradicts `ticks`, so a transcription slip can
  never fail a correct model or pass a wrong one.
- Measured device readouts (a pressure gauge, an output-mole counter) go in
  `outputs` with the name you will assert, e.g.
  `"outputs": { "pressureKpa": 1218.6 }` → `net-a.outputs.pressureKpa`.

## 7. Runs and tolerances (5.4)

1. Run the whole scenario **at least twice** (three times if the mechanic
   involves devices that update on their own). Record how many: `runs`.
2. Note the spread of the values you care about across runs: max − min, per
   quantity. Put that number, not a feeling, in the tolerance `basis`.
3. For each asserted quantity declare
   `tolerances.quantities["<key>"] = { abs?, rel?, basis }`. The comparison is
   `|model − recorded| ≤ abs + rel × |recorded|`, so:
   - use `abs` for a quantity with a fixed readout granularity (a gauge that
     shows 0.1 kPa → at least `0.05`),
   - use `rel` for quantities whose error scales with magnitude,
   - `{ "abs": 0 }` means "exactly" and is only honest for values that are
     copied, not measured (moles in a closed network you never touched).
4. `basis` is mandatory and must name the observed evidence: run-to-run spread,
   readout resolution, and any known non-determinism in the game's update order
   (5.4). "Felt small" is not a basis.
5. Set `verificationStatus: "captured"`. You never type `"verified"`: see §9.

## 8. Declare the envelope this fixture covers (5.2.1)

- `envelope.inputs` lists the ranges **this capture** covers, keyed by the same
  names the model uses in `scenario.conditions`. One capture covers the point it
  recorded, so ranges are usually degenerate:
  `"temperatureK": { "min": 293.15, "max": 293.15 }`.
- Do not widen a range because it feels reasonable. A model's envelope is the
  union of its fixtures' envelopes; widening here overstates what is Verified.
- If you want a range, capture that range: several fixtures at different set
  points, not one fixture with a guessed span.

## 9. Validate, replay, promote

1. Parse it — the parse names the exact field that is wrong:

   ```ts
   import { readFileSync } from 'node:fs';
   import { describeFixtureIssues, parseReferenceFixture } from '@stationeers/engine';

   try {
     parseReferenceFixture(JSON.parse(readFileSync('my-fixture.json', 'utf8')));
   } catch (error) {
     console.error(describeFixtureIssues(error).join('\n'));
   }
   ```

2. Replay it against the model implementation
   (`replayFixture(fixture, behaviorModel, model)`). Read `outcome`,
   `statusClaim`, `worst`, and every diagnostic. `outcome: 'pass'` with
   `statusClaim: 'unverified'` means the numbers matched but the claim is not
   allowed — typically out of envelope, not declared in `fixtureIds`, or captured
   on another build. Fix that before promoting.
3. Only after a reviewed `statusClaim: 'verified'` do you record the fixture as
   verified, with `promoteFixture(fixture, verdict)`. Commit the promoted file
   together with the model change it justifies.
4. Keep the replay in the test suite: a fixture that stops replaying is a
   regression, and `reportModelFixtureCoverage` reports it as
   `SIM-FIXTURE-REGRESSION`.

## 10. Feed the behavior model

A fixture is evidence, not a link. Wire it into the model explicitly:

```ts
const model: BehaviorModel = {
  id: 'atmo.pressure',
  version: '1',
  domain: 'atmospherics',
  // 6.6: exactly the pack inputs this mechanic reads, nothing speculative.
  consumes: { properties: ['network.volume'], constants: [] },
  // 5.2.1: the union of the envelopes of the fixtures listed below.
  envelope: { inputs: { temperatureK: { min: 293.15, max: 293.15 } } },
  status: 'unverified',
  // Every fixture that backs this model's claim.
  fixtureIds: ['fx-0.2.6428-public-pressure-steady-01'],
};
```

- `fixtureIds` must list every fixture the claim rests on; a replay against an
  undeclared fixture is reported as `SIM-FIXTURE-UNDECLARED` and cannot verify
  the model.
- The model's `envelope` must stay inside what its verified fixtures cover;
  `reportModelFixtureCoverage` reports every declared range that no fixture
  covers (`SIM-ENVELOPE-UNCOVERED`).
- After a game update, re-run the fixtures of the models the pack diff
  invalidated (6.6 step 7) and re-capture what no longer matches. Do not widen a
  tolerance to make a broken model pass: a failing fixture on a Verified
  capability blocks release (§13).

## 11. Operator checklist

Before you commit a fixture:

- [ ] Clean vanilla install, build number and branch copied verbatim.
- [ ] One mechanic, one network, nothing else attached to it.
- [ ] `scenario.inventories` and the tick-0 sample are the same numbers.
- [ ] `scenario.conditions` names every envelope input, and the envelope only
      claims what was captured.
- [ ] Tick length either from the pack for this build or measured and explained.
- [ ] `tickCount` = last sample's tick; `timeS` starts at 0 and ends at
      `tickCount × tickLengthS`.
- [ ] Every asserted quantity appears in `ticks` at that tick with the same value.
- [ ] Every asserted quantity has a tolerance whose `basis` cites the observed
      run-to-run spread or the readout resolution.
- [ ] `runs` records how many independent runs you actually did.
- [ ] `sourceReference` says what you did and names the screenshots/logs/save.
- [ ] `verificationStatus` is `"captured"` until a reviewed replay says
      `statusClaim: 'verified'`, then promoted with `promoteFixture`.
- [ ] `fixtureIds` on the model lists this fixture.

## 12. Never do this

- Never type a number you did not read or measure (4.7, 7.6).
- Never widen a tolerance to hide a mismatch; a mismatch is the finding.
- Never capture on a modded install, or on a build you cannot name exactly.
- Never mark a fixture `verified` by hand. The status records that a replay
  passed against a named model version, and if that stops being true the fixture
  suite must fail.
- Never assert a quantity the capture did not record, or a tick you did not
  sample.
