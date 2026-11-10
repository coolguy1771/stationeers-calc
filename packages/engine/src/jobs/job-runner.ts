/**
 * Inline job runner (FND-05b; spec 5.6).
 *
 * `createJobRunner` executes job bodies directly on the calling thread —
 * right for inexpensive static calculations, and the fully testable core.
 * For graph-intensive or time-stepped work, wrap the same semantics around a
 * browser `Worker` with `createWorkerAdapter` (see `./worker-adapter.ts`).
 *
 * Example:
 * ```ts
 * const runner = createJobRunner({ getCurrentRevision: () => store.revisionId });
 * const handle = runner.submit(computePressure, {
 *   label: 'network pressure',
 *   onProgress: (p) => ui.showProgress(p),
 * });
 * const outcome = await handle.result;
 * if (outcome.status === 'completed' && !outcome.isStale) apply(outcome.value);
 * ```
 */

import { startJob } from './core';
import type {
  JobBody,
  JobHandle,
  RevisionId,
  StalePolicy,
  SubmitOptions,
} from './types';

export interface JobRunnerOptions {
  /** Source of truth for the current revision (spec 5.6). */
  readonly getCurrentRevision: () => RevisionId;
  /** Stale-result policy; `'flag'` (default) or `'discard'`. */
  readonly onStale?: StalePolicy;
}

export interface JobRunner {
  /**
   * Submits a job. The returned handle's `result` promise resolves with a
   * {@link JobOutcome} tagged with the revision the job started on; it never
   * rejects. Progress from the body goes to `options.onProgress`.
   */
  submit<T>(body: JobBody<T>, options: SubmitOptions): JobHandle<T>;
  /** Cancels every active job — the thing to do when the revision changes. */
  cancelAll(): void;
  /** Number of jobs started but not yet settled. */
  readonly activeCount: number;
}

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const onStale: StalePolicy = options.onStale ?? 'flag';
  let nextId = 1;
  const active = new Map<number, () => void>();

  return {
    submit<T>(body: JobBody<T>, submitOptions: SubmitOptions): JobHandle<T> {
      const id = nextId++;
      const revisionId = submitOptions.revisionId ?? options.getCurrentRevision();
      const job = startJob({
        revisionId,
        label: submitOptions.label,
        onProgress: submitOptions.onProgress,
        onStale,
        getCurrentRevision: options.getCurrentRevision,
        execute: (ctx) => body(ctx),
        onSettled: () => {
          active.delete(id);
        },
      });
      active.set(id, job.cancel);
      return {
        id,
        revisionId,
        label: submitOptions.label,
        cancel: job.cancel,
        result: job.result,
      };
    },

    cancelAll(): void {
      // Snapshot: cancel() deletes from `active`, so iterating the live map
      // would risk skipping entries.
      for (const cancel of Array.from(active.values())) cancel();
    },

    get activeCount(): number {
      return active.size;
    },
  };
}
