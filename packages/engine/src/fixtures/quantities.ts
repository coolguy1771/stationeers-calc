/**
 * Canonical quantity keys (SIM-01): the one naming scheme shared by a fixture's
 * recorded samples, its `expected` assertions, its `tolerances`, and the model
 * output a replay compares against.
 *
 * Grammar:
 *
 *     <networkRef>.moles.<speciesId>.<phase>   e.g. net-a.moles.Oxygen.gas
 *     <networkRef>.thermal.<kind>              e.g. net-a.thermal.temperature
 *     <networkRef>.outputs.<name>              e.g. net-a.outputs.pressureKpa
 *
 * The phase is in the key because an inventory holds moles by species *and*
 * phase (spec 4.5); dropping it would conflate 1 mol of liquid water with 1 mol
 * of steam. `thermal` uses the thermal variable's kind rather than a free-form
 * name, so `temperatureK` and `internalEnergyJ` can never be compared as if
 * they were the same quantity.
 *
 * `outputs` names are chosen by the operator and are free-form: they carry the
 * measured device readouts a model must reproduce (pressure, output moles, a
 * reservoir's reading), named as they appear in the capture notes.
 *
 * Keys are built here and nowhere else. A sample that would yield the same key
 * twice (two fields whose identifiers contain a dot could collide) is rejected
 * by the fixture schema (`schema.ts`) — an ambiguous comparison is never run.
 */
import type { Phase } from '@stationeers/domain';
import { compareStrings } from '../models/order';

/** One comparable quantity: a canonical key and the value recorded or computed for it. */
export interface QuantityValue {
  key: string;
  value: number;
}

/** The canonical thermal variable of an inventory or observation (4.5). */
export interface QuantityThermalState {
  readonly kind: 'temperature' | 'internal-energy';
  readonly value: number;
  readonly unit: string;
}

/** Moles of one species in one phase (4.5). */
export interface QuantitySpeciesMoles {
  readonly speciesId: string;
  readonly phase: Phase;
  readonly moles: number;
}

/** A scenario inventory as the quantity grammar sees it (`InventoryState`, 4.5). */
export interface QuantityInventoryState {
  readonly species: readonly QuantitySpeciesMoles[];
  readonly thermal: QuantityThermalState;
}

/** One network's observed state as the quantity grammar sees it (`ObservedNetworkState`). */
export interface QuantityObservationState {
  readonly moles: readonly QuantitySpeciesMoles[];
  readonly thermal: QuantityThermalState;
  readonly outputs?: Readonly<Record<string, number>> | undefined;
}

/** One recorded sample as the quantity grammar sees it (`TickSample`). */
export interface QuantitySample {
  readonly networks: Readonly<Record<string, QuantityObservationState>>;
}

/**
 * Quantity entries for a scenario inventory: the initial state a model starts
 * from (4.5). No `outputs`: an initial state has no measured readouts.
 */
export function inventoryQuantityEntries(
  networkRef: string,
  inventory: QuantityInventoryState,
): QuantityValue[] {
  return buildEntries(networkRef, inventory.species, inventory.thermal);
}

/** Quantity entries for one network's observed state at a sample. */
export function networkQuantityEntries(
  networkRef: string,
  state: QuantityObservationState,
): QuantityValue[] {
  return buildEntries(networkRef, state.moles, state.thermal, state.outputs);
}

/**
 * Every quantity a sample records, sorted by key (code-unit order). Network
 * order in the document never affects the result (spec 5.5).
 */
export function tickQuantityEntries(sample: QuantitySample): QuantityValue[] {
  const entries: QuantityValue[] = [];
  for (const networkRef of Object.keys(sample.networks).sort(compareStrings)) {
    const state = sample.networks[networkRef];
    if (state !== undefined) {
      entries.push(...networkQuantityEntries(networkRef, state));
    }
  }
  return entries.sort(compareByKey);
}

/** `tickQuantityEntries` as a lookup record, in the same canonical order. */
export function tickQuantities(sample: QuantitySample): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const entry of tickQuantityEntries(sample)) {
    quantities[entry.key] = entry.value;
  }
  return quantities;
}

function buildEntries(
  networkRef: string,
  amounts: readonly QuantitySpeciesMoles[],
  thermal: QuantityThermalState,
  outputs?: Readonly<Record<string, number>> | undefined,
): QuantityValue[] {
  const entries: QuantityValue[] = [];
  for (const amount of amounts) {
    entries.push({
      key: `${networkRef}.moles.${amount.speciesId}.${amount.phase}`,
      value: amount.moles,
    });
  }
  entries.push({ key: `${networkRef}.thermal.${thermal.kind}`, value: thermal.value });
  if (outputs !== undefined) {
    for (const [name, value] of Object.entries(outputs)) {
      entries.push({ key: `${networkRef}.outputs.${name}`, value });
    }
  }
  return entries.sort(compareByKey);
}

function compareByKey(a: QuantityValue, b: QuantityValue): number {
  return compareStrings(a.key, b.key);
}
