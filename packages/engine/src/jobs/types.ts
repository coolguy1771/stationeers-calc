/**
 * Revision-aware job infrastructure (FND-05b; spec 5.6).
 *
 * Spec contract implemented here:
 * - Graph-intensive or time-stepped calculations run in workers with
 *   cancellation and progress reporting; cheap static calculations may run
 *   inline (the default executor of {@link createJobRunner}).
 * - Every job carries the revision ID it started on. A result older than the
 *   current revision is flagged stale or discarded (runner option) and never
 *   overwrites newer state.
 * - The core (revision tagging, staleness, cooperative cancellation,
 *   progress, outcome classification) is transport-free and fully testable;
 *   `createWorkerAdapter`/`serveWorkerJobs` add a message protocol around it
 *   for a real browser `Worker` (or any object with the same three-method
 *   shape).
 */

export type RevisionId = string;

/** Delivered on the submit options; receives (fraction, optional message). */
export type ProgressListener = (progress: number, message?: string) => void;

/**
 * Cooperative cancellation handle the job body polls (spec 5.6). Abort is
 * only ever requested by the submitter (`cancel()`), never by the runner.
 */
export interface JobSignal {
  /** True once cancellation was requested. Poll this in compute loops. */
  readonly aborted: boolean;
  /** Throws {@link JobCancelledError} if aborted; otherwise a no-op. */
  throwIfAborted(): void;
  /**
   * Registers a listener fired when abort is requested (immediately if
   * already aborted). Returns an unsubscribe function.
   */
  onAbort(listener: () => void): () => void;
}

/** Context handed to every job body. */
export interface JobContext {
  readonly signal: JobSignal;
  /**
   * Reports job progress in [0, 1] with an optional message. Throws a
   * `RangeError` for non-finite or out-of-range values (a job that reports
   * garbage fails rather than lying to the UI).
   */
  reportProgress(progress: number, message?: string): void;
}

/** A unit of work: called with the job context, may be sync or async. */
export type JobBody<T> = (ctx: JobContext) => Promise<T> | T;

/**
 * What happens to a completed result whose revision is no longer current
 * (spec 5.6): `'flag'` resolves it with `isStale: true` for the caller to
 * handle; `'discard'` withholds the value entirely.
 */
export type StalePolicy = 'flag' | 'discard';

export interface SubmitOptions {
  /**
   * The revision the job starts on. Defaults to `getCurrentRevision()` read
   * at submit time — pass it explicitly when the caller's view of the
   * revision must be pinned (e.g. the revision of the exact input snapshot
   * being computed).
   */
  readonly revisionId?: RevisionId;
  /** Human-readable label for diagnostics and stale-result reporting. */
  readonly label?: string;
  /** Receives `reportProgress` calls from the job body. */
  readonly onProgress?: ProgressListener;
}

/**
 * Terminal state of a job. `result` promises resolve (never reject) with one
 * of these, so callers can `await` without unhandled-rejection plumbing.
 */
export type JobOutcome<T> =
  | {
      readonly status: 'completed';
      readonly value: T;
      readonly revisionId: RevisionId;
      /** True when the current revision moved past this job's revision. */
      readonly isStale: boolean;
    }
  | { readonly status: 'cancelled'; readonly revisionId: RevisionId }
  | { readonly status: 'failed'; readonly error: unknown; readonly revisionId: RevisionId }
  | { readonly status: 'discarded'; readonly revisionId: RevisionId };

/** Handle returned by `submit`/`run`; the `result` promise is tagged with the revision. */
export interface JobHandle<T> {
  readonly id: number;
  readonly revisionId: RevisionId;
  readonly label: string | undefined;
  /**
   * Requests cooperative cancellation. Idempotent; a no-op once the job has
   * settled. After `cancel()` the outcome is always `'cancelled'` — a body
   * that finishes anyway has its value dropped.
   */
  cancel(): void;
  readonly result: Promise<JobOutcome<T>>;
}

/** Thrown by `signal.throwIfAborted()`; classified as cancellation, not failure. */
export class JobCancelledError extends Error {
  constructor(message = 'job cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}
