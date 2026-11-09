/**
 * CalculationResult skeleton assembly (spec 3.5, 5.2.2): fills identity, the
 * model-status aggregate (via `propagateStatus`), the canonical
 * contributing-model breakdown, and the `computedWith` provenance metadata.
 * Outputs and the human-readable explanation are left empty for the caller
 * (SIM-02) to fill.
 *
 * Topology seam (DOM-02): `topologyStatus` is an explicit input. When no
 * topology resolution is available it defaults to the conservative
 * 'conceptual' — "exact" requires Verified AND Buildable (3.5), so the
 * default can never overstate a result. DOM-02's resolver passes the resolved
 * value once it exists; no model-status logic reads or alters it.
 *
 * The assembled object satisfies `CalculationResultSchema` whenever the
 * caller-supplied fields do; validation happens at serialization boundaries
 * (9.4), and the result tests pin the agreement between the two layers.
 */
import type { CalculationResult, EntityId, TopologyStatus } from '@stationeers/domain';
import { propagateStatus } from './status';
import type { ModelContribution } from './status';

/**
 * Version stamp of the behavior-engine semantics (5.5: identical inputs, pack,
 * and engine versions yield identical outputs). Bump on any change that can
 * alter computed results — model semantics, numerics discipline, or the
 * assembly contract itself. It lands in every `CalculationResult.computedWith`.
 */
export const BEHAVIOR_ENGINE_VERSION = '0.1.0';

/** Provenance metadata for one result; `behaviorEngineVersion` is defaulted. */
export interface ComputedWith {
  packHash: string;
  scenarioDigest: string;
  /** Defaults to `BEHAVIOR_ENGINE_VERSION`. */
  behaviorEngineVersion?: string;
}

export interface AssembleResultInput {
  id: EntityId;
  capabilityId: string;
  /** Network or subgraph reference the result describes (3.5). */
  networkRef: EntityId;
  /** Models contributing to this result; statuses propagate weakest-wins. */
  contributingModels: readonly ModelContribution[];
  /** Runtime inputs the result was computed from; echoed verbatim. */
  inputs: Record<string, unknown>;
  computedWith: ComputedWith;
  /** From DOM-02 topology resolution; defaults to the conservative 'conceptual'. */
  topologyStatus?: TopologyStatus;
}

export function assembleCalculationResult(input: AssembleResultInput): CalculationResult {
  const propagation = propagateStatus(input.contributingModels);
  return {
    id: input.id,
    capabilityId: input.capabilityId,
    networkRef: input.networkRef,
    modelStatus: propagation.modelStatus,
    topologyStatus: input.topologyStatus ?? 'conceptual',
    contributingModels: propagation.contributions,
    // Copies: later caller mutations of their own records must not corrupt
    // an already-assembled result.
    inputs: { ...input.inputs },
    outputs: {},
    explanation: [],
    computedWith: {
      packHash: input.computedWith.packHash,
      behaviorEngineVersion: input.computedWith.behaviorEngineVersion ?? BEHAVIOR_ENGINE_VERSION,
      scenarioDigest: input.computedWith.scenarioDigest,
    },
  };
}
