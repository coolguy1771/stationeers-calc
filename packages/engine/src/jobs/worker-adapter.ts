/**
 * Worker adapter (FND-05b; spec 5.6).
 *
 * A thin message-protocol layer around the shared orchestration core
 * (`startJob`), so jobs can run on a real browser `Worker` — or on any object
 * with the same three-method shape — while revision tagging, staleness,
 * cancellation and progress keep their inline-runner semantics.
 *
 * Functions cannot cross `postMessage`, so worker jobs are addressed by name:
 * the worker side registers implementations with {@link serveWorkerJobs} and
 * the main side runs them by spec (`{ name, payload }`). Payloads and results
 * must be structured-cloneable.
 *
 * Protocol (jobId-correlated):
 *   main → worker: `{ kind: 'run', jobId, name, payload? }`,
 *                  `{ kind: 'cancel', jobId }`
 *   worker → main: `{ kind: 'progress', jobId, progress, message? }`,
 *                  `{ kind: 'resolve', jobId, value }`,
 *                  `{ kind: 'reject', jobId, error }`,
 *                  `{ kind: 'cancelled', jobId }`
 */

import { startJob } from './core';
import { JobCancelledError } from './types';
import type {
  JobContext,
  JobHandle,
  JobSignal,
  RevisionId,
  StalePolicy,
  SubmitOptions,
} from './types';
// zod v4 ships its namespace flattened on the module object in this
// environment (no separate named `z` export), so import the namespace.
import * as z from 'zod';

/** The slice of the DOM `Worker` interface the adapter needs; a test double
 * with the same three methods is fully interchangeable. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  terminate(): void;
}

/** The slice of the worker-side global (`self`) that {@link serveWorkerJobs} needs. */
export interface WorkerSideLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** A worker job request: `name` must be registered on the worker side. */
export interface WorkerJobSpec {
  readonly name: string;
  readonly payload?: unknown;
}

/** A job implementation registered on the worker side. */
export type WorkerJobFunction = (ctx: JobContext, payload: unknown) => Promise<unknown> | unknown;

export interface WorkerAdapterOptions {
  /** Source of truth for the current revision (spec 5.6). */
  readonly getCurrentRevision: () => RevisionId;
  /** Stale-result policy; `'flag'` (default) or `'discard'`. */
  readonly onStale?: StalePolicy;
}

export interface WorkerAdapter {
  /**
   * Runs the named job on the worker. Same handle/outcome contract as
   * `JobRunner.submit`; the result value is whatever the worker resolved
   * with (trusted to be `T` — the protocol cannot carry the type).
   */
  run<T>(spec: WorkerJobSpec, options: SubmitOptions): JobHandle<T>;
  /** Cancels every active job. */
  cancelAll(): void;
  /** Number of jobs started but not yet settled. */
  readonly activeCount: number;
  /** Terminates the worker; every pending job settles as cancelled. */
  dispose(): void;
}

/**
 * Message schemas for the job protocol. This is a runtime validation
 * boundary (structured-clone data crossing a thread), so it validates with
 * Zod per the monorepo convention (Zod v4: `error.issues`, not `error.errors`).
 */
const mainToWorkerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('run'),
    jobId: z.number().int(),
    name: z.string(),
    payload: z.unknown().optional(),
  }),
  z.object({ kind: z.literal('cancel'), jobId: z.number().int() }),
]);

const workerToMainSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('progress'),
    jobId: z.number().int(),
    progress: z.number(),
    message: z.string().optional(),
  }),
  z.object({ kind: z.literal('resolve'), jobId: z.number().int(), value: z.unknown() }),
  z.object({ kind: z.literal('reject'), jobId: z.number().int(), error: z.unknown() }),
  z.object({ kind: z.literal('cancelled'), jobId: z.number().int() }),
]);

/** Type of a validated main→worker message. */
type MainToWorker = z.infer<typeof mainToWorkerSchema>;

function parseMessage<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new TypeError(`malformed worker message (${detail})`);
  }
  return result.data;
}

/** Main-thread side: wraps a `Worker` (created by `factory`) as a job host. */
export function createWorkerAdapter(
  factory: () => WorkerLike,
  options: WorkerAdapterOptions,
): WorkerAdapter {
  const onStale: StalePolicy = options.onStale ?? 'flag';
  const worker = factory();
  let nextJobId = 1;
  let disposed = false;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      report(progress: number, message?: string): void;
    }
  >();
  const active = new Map<number, () => void>();

  worker.addEventListener('message', (event) => {
    const message = parseMessage(workerToMainSchema, event.data);
    const entry = pending.get(message.jobId);
    switch (message.kind) {
      case 'progress':
        entry?.report(message.progress, message.message);
        break;
      case 'resolve':
        pending.delete(message.jobId);
        entry?.resolve(message.value);
        break;
      case 'reject':
        pending.delete(message.jobId);
        entry?.reject(message.error);
        break;
      case 'cancelled':
        pending.delete(message.jobId);
        entry?.reject(new JobCancelledError());
        break;
    }
  });

  return {
    run<T>(spec: WorkerJobSpec, submitOptions: SubmitOptions): JobHandle<T> {
      if (disposed) throw new Error('worker adapter has been disposed');
      const jobId = nextJobId++;
      const revisionId = submitOptions.revisionId ?? options.getCurrentRevision();
      const job = startJob<T>({
        revisionId,
        label: submitOptions.label,
        onProgress: submitOptions.onProgress,
        onStale,
        getCurrentRevision: options.getCurrentRevision,
        onCancel: () => {
          worker.postMessage({ kind: 'cancel', jobId } satisfies MainToWorker);
        },
        execute: (ctx) =>
          new Promise<T>((resolve, reject) => {
            pending.set(jobId, { resolve, reject, report: ctx.reportProgress });
            worker.postMessage({
              kind: 'run',
              jobId,
              name: spec.name,
              payload: spec.payload,
            } satisfies MainToWorker);
          }),
        onSettled: () => {
          pending.delete(jobId);
          active.delete(jobId);
        },
      });
      active.set(jobId, job.cancel);
      return {
        id: jobId,
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

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const cancel of Array.from(active.values())) cancel();
      for (const entry of pending.values()) entry.reject(new JobCancelledError('worker disposed'));
      pending.clear();
      worker.terminate();
    },
  };
}

/**
 * Worker-thread side: registers job implementations and serves them off the
 * received messages. Call once at worker startup, e.g.
 * `serveWorkerJobs(jobs, self)` in a dedicated worker module.
 */
export function serveWorkerJobs(jobs: Record<string, WorkerJobFunction>, side: WorkerSideLike): void {
  const running = new Map<number, { abort: () => void }>();

  side.addEventListener('message', (event) => {
    const message = parseMessage(mainToWorkerSchema, event.data);
    if (message.kind === 'cancel') {
      running.get(message.jobId)?.abort();
      running.delete(message.jobId);
      return;
    }

    const fn = jobs[message.name];
    if (typeof fn !== 'function') {
      side.postMessage({
        kind: 'reject',
        jobId: message.jobId,
        error: new Error(`no worker job registered as "${message.name}"`),
      });
      return;
    }

    let cancelled = false;
    const abortListeners = new Set<() => void>();
    const signal: JobSignal = {
      get aborted() {
        return cancelled;
      },
      throwIfAborted() {
        if (cancelled) throw new JobCancelledError();
      },
      onAbort(listener) {
        if (cancelled) listener();
        else abortListeners.add(listener);
        return () => {
          abortListeners.delete(listener);
        };
      },
    };
    const ctx: JobContext = {
      signal,
      reportProgress: (progress, msg) => {
        if (
          typeof progress !== 'number' ||
          !Number.isFinite(progress) ||
          progress < 0 ||
          progress > 1
        ) {
          throw new RangeError(`progress must be a finite number in [0, 1], got ${String(progress)}`);
        }
        side.postMessage({
          kind: 'progress',
          jobId: message.jobId,
          progress,
          ...(msg === undefined ? {} : { message: msg }),
        });
      },
    };

    running.set(message.jobId, {
      abort: () => {
        cancelled = true;
        const listeners = [...abortListeners];
        abortListeners.clear();
        for (const listener of listeners) listener();
      },
    });

    const settle = (post: () => void): void => {
      running.delete(message.jobId);
      post();
    };
    new Promise((resolve, reject) => {
      try {
        resolve(fn(ctx, message.payload));
      } catch (error) {
        reject(error);
      }
    }).then(
      (value) => {
        settle(() => side.postMessage({ kind: 'resolve', jobId: message.jobId, value }));
      },
      (error: unknown) => {
        settle(() => {
          if (error instanceof JobCancelledError) {
            side.postMessage({ kind: 'cancelled', jobId: message.jobId });
          } else {
            side.postMessage({ kind: 'reject', jobId: message.jobId, error });
          }
        });
      },
    );
  });
}
