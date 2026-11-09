/**
 * Model-status propagation (spec 5.2.2): a result's model status is the
 * weakest contributing status, and every result lists its contributing models
 * with their statuses.
 *
 * Topology seam (DOM-02): topology status (buildable/conceptual, spec 3.5) is
 * a separate, independently reported status aggregated over resolved networks
 * ("Conceptual if any contributing network is Conceptual"). It is
 * deliberately not part of this module: DOM-02 owns that aggregation over
 * resolved networks and passes its outcome into `assembleCalculationResult`
 * (see result.ts). The two statuses join only in `CalculationResult`, exactly
 * as the entity contract fixes them (3.5, 5.2.2).
 */
import type { ModelStatus } from '@stationeers/domain';
import { compareStrings } from './order';

/** One contributing model and the status it contributes to a result (5.2.2). */
export interface ModelContribution {
  modelId: string;
  status: ModelStatus;
}

/**
 * Weakest-to-strongest rank of the status vocabulary (5.2.2):
 * Incompatible < Unsupported < Unverified < Verified.
 */
export const MODEL_STATUS_RANK: Readonly<Record<ModelStatus, number>> = {
  incompatible: 0,
  unsupported: 1,
  unverified: 2,
  verified: 3,
};

/** Weakest-wins aggregate plus the per-model breakdown for display (5.2.2). */
export interface StatusPropagation {
  modelStatus: ModelStatus;
  /**
   * Canonical per-model breakdown, sorted by model id then status (code-unit
   * order) — display-stable regardless of the order contributions arrived in.
   */
  contributions: ModelContribution[];
}

/**
 * Weakest-wins aggregation over contributing models (5.2.2).
 *
 * - Empty contributions aggregate to 'unsupported': with no contributing
 *   model there is no usable implementation behind the result, and an
 *   unsupported result is never a pass (spec 8).
 * - Duplicate model ids are kept as given; callers pass one entry per
 *   contributing model. Propagation semantics are unaffected either way.
 */
export function propagateStatus(contributions: readonly ModelContribution[]): StatusPropagation {
  if (contributions.length === 0) {
    return { modelStatus: 'unsupported', contributions: [] };
  }
  // Safe start value: with at least one contribution the weakest status has
  // rank ≤ verified's rank, so 'verified' can never survive the scan.
  let weakest: ModelStatus = 'verified';
  for (const contribution of contributions) {
    if (MODEL_STATUS_RANK[contribution.status] < MODEL_STATUS_RANK[weakest]) {
      weakest = contribution.status;
    }
  }
  return {
    modelStatus: weakest,
    contributions: [...contributions].sort(compareContribution),
  };
}

function compareContribution(a: ModelContribution, b: ModelContribution): number {
  const byId = compareStrings(a.modelId, b.modelId);
  return byId !== 0 ? byId : compareStrings(a.status, b.status);
}
