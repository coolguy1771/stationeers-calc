import { useState } from 'react';
import type { CalculationResult, RevisionId } from '@stationeers/domain';
import { mockCalculationResult } from '../mocks';
import { projectStore, useProjectSnapshot } from './projectStore';

/**
 * Revision tagging for displayed results (spec 5.6, 2.2.1).
 *
 * "Every worker job carries the revision ID it started on. A result older than
 * the current revision is discarded or shown as stale; it never overwrites
 * newer state." Until SIM-02 runs real worker jobs, the mocked result plays the
 * job's part: its revision tag is captured where a job would tag itself, and the
 * panel renders the tag so a stale result can never read as current.
 */
export interface TaggedResult {
  readonly result: CalculationResult;
  /** Revision the result describes (`Store.isStale` compares against it). */
  readonly computedAtRevisionId: RevisionId;
  /** True once the canonical store moved past that revision. */
  readonly stale: boolean;
  /** Revision the project is on now. */
  readonly currentRevisionId: RevisionId;
}

/**
 * The mocked calculation result, tagged with the revision it was computed on.
 * The tag is captured when the view mounts — the moment a job would start — so
 * committing anything afterwards makes the displayed result stale.
 */
export function useTaggedMockResult(): TaggedResult {
  const [computedAtRevisionId] = useState<RevisionId>(() => projectStore.revisionId);
  const { revisionId } = useProjectSnapshot();
  return {
    result: mockCalculationResult,
    computedAtRevisionId,
    stale: projectStore.isStale(computedAtRevisionId),
    currentRevisionId: revisionId,
  };
}
