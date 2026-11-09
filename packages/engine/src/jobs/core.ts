/**
 * Shared job orchestration (FND-05b) — the transport-free core both the
 * inline runner and the worker adapter run on, so revision tagging, staleness
 * policy, cooperative cancellation and progress behave identically regardless
 * of where the body executes. Testable without Workers.
 */

import { JobCancelledError } from './types';
import type {
  JobContext,
  JobOutcome,
  JobSignal,
  ProgressListener,
  RevisionId,
  StalePolicy,
} from './types';

/** @internal Arguments of `startJob`; see `createJobRunner`/`createWorkerAdapter`. */
export interface StartJobSpec<T> {
  readonly revisionId: RevisionId;
  readonly label: string | undefined;
  readonly onProgress: ProgressListener | undefined;
  readonly onStale: StalePolicy;
  /** Read when the job settles to decide staleness (spec 5.6). */
  readonly getCurrentRevision: () => RevisionId;
  /** Starts the work immediately (synchronously up to its first await). */
  readonly execute: (ctx: JobContext) => Promise<T> | T;
  /** Fires exactly once, when cancel first transitions the signal to aborted. */
  readonly onCancel?: () => void;
  /** Fires exactly once when the outcome is classified; used for bookkeeping. */
  readonly onSettled?: () => void;
}

/** @internal */
export interface StartedJob<T> {
  /** Resolves (never rejects) with the classified {@link JobOutcome}. */
  readonly result: Promise<JobOutcome<T>>;
  readonly cancel: () => void;
}

/** @internal Runs one job to completion and classifies its outcome. */
export function startJob<T>(spec: StartJobSpec<T>): StartedJob<T> {
  const { revisionId, label, onProgress, onStale, getCurrentRevision, execute, onCancel, onSettled } =
    spec;

  let cancelled = false;
  let settled = false;
  const abortListeners = new Set<() => void>();

  const signal: JobSignal = {
    get aborted() {
      return cancelled;
    },
    throwIfAborted() {
      if (cancelled) {
        throw new JobCancelledError(label === undefined ? 'job cancelled' : `job "${label}" cancelled`);
      }
    },
    onAbort(listener) {
      if (cancelled) listener();
      else abortListeners.add(listener);
      return () => {
        abortListeners.delete(listener);
      };
    },
  };

  const reportProgress: JobContext['reportProgress'] = (progress, message) => {
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new RangeError(`progress must be a finite number in [0, 1], got ${String(progress)}`);
    }
    onProgress?.(progress, message);
  };

  const cancel = (): void => {
    if (settled || cancelled) return;
    cancelled = true;
    const listeners = [...abortListeners];
    abortListeners.clear();
    for (const listener of listeners) listener();
    onCancel?.();
    // Cancellation delivers the outcome immediately: the caller asked for the
    // value to be dropped, and a body that never polls its signal must not
    // hold the result promise pending forever. If the body settles later its
    // outcome is ignored (finish() is one-shot).
    finish({ status: 'cancelled', revisionId });
  };

  // `new Promise` runs the resolver synchronously so the body starts on
  // submit; a synchronous throw from the body becomes a failed outcome.
  const execution = new Promise<T>((resolve, reject) => {
    try {
      resolve(execute({ signal, reportProgress }));
    } catch (error) {
      reject(error);
    }
  });

  let deliver!: (outcome: JobOutcome<T>) => void;
  const result = new Promise<JobOutcome<T>>((resolve) => {
    deliver = resolve;
  });
  const finish = (outcome: JobOutcome<T>): void => {
    if (settled) return;
    settled = true;
    onSettled?.();
    deliver(outcome);
  };

  execution.then(
    (value) => {
      if (cancelled) {
        finish({ status: 'cancelled', revisionId });
        return;
      }
      try {
        if (revisionId !== getCurrentRevision()) {
          // The revision moved on while this job ran (spec 5.6): the result
          // may be shown as stale, but never overwrites newer state.
          if (onStale === 'discard') finish({ status: 'discarded', revisionId });
          else finish({ status: 'completed', value, revisionId, isStale: true });
          return;
        }
      } catch (error) {
        finish({ status: 'failed', error, revisionId });
        return;
      }
      finish({ status: 'completed', value, revisionId, isStale: false });
    },
    (error) => {
      if (cancelled || error instanceof JobCancelledError) {
        finish({ status: 'cancelled', revisionId });
        return;
      }
      finish({ status: 'failed', error, revisionId });
    },
  );

  return { result, cancel };
}
