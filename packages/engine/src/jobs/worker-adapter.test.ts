import { describe, expect, it } from 'vitest';
import type {
  WorkerJobFunction,
  WorkerLike,
  WorkerSideLike,
} from './worker-adapter';
import { createWorkerAdapter, serveWorkerJobs } from './worker-adapter';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settled<T>(handle: { result: Promise<T> }): Promise<T> {
  // Result promises never reject by contract.
  return handle.result;
}

/**
 * In-memory stand-in for a real Worker pair: `mainSide` is the WorkerLike
 * handed to `createWorkerAdapter`, and every postMessage is delivered to the
 * opposite side's listeners on a microtask (mirroring real async messaging).
 * Values pass by reference here; a real worker structured-clones them.
 */
function createWorkerPair(jobs: Record<string, WorkerJobFunction>): WorkerLike {
  const mainListeners: Array<(event: { data: unknown }) => void> = [];
  const workerListeners: Array<(event: { data: unknown }) => void> = [];
  let terminated = false;

  const mainSide: WorkerLike = {
    postMessage(message) {
      if (terminated) return; // a terminated worker swallows messages
      queueMicrotask(() => {
        for (const listener of [...workerListeners]) listener({ data: message });
      });
    },
    addEventListener(_type, listener) {
      mainListeners.push(listener);
    },
    terminate() {
      terminated = true;
    },
  };

  const workerSide: WorkerSideLike = {
    postMessage(message) {
      queueMicrotask(() => {
        for (const listener of [...mainListeners]) listener({ data: message });
      });
    },
    addEventListener(_type, listener) {
      workerListeners.push(listener);
    },
  };

  serveWorkerJobs(jobs, workerSide);
  return mainSide;
}

function makeAdapter(
  jobs: Record<string, WorkerJobFunction>,
  options: { getCurrentRevision: () => string; onStale?: 'flag' | 'discard' },
) {
  return createWorkerAdapter(() => createWorkerPair(jobs), options);
}

describe('worker adapter — run/resolve', () => {
  it('runs a named job on the worker side and delivers the tagged result', async () => {
    const adapter = makeAdapter(
      { 'network-volume': (_ctx, payload) => ({ volume: payload }) },
      { getCurrentRevision: () => 'r1' },
    );
    const handle = adapter.run<{ volume: number }>(
      { name: 'network-volume', payload: 42 },
      { revisionId: 'r1', label: 'volume' },
    );
    expect(handle.revisionId).toBe('r1');
    expect(await settled(handle)).toEqual({
      status: 'completed',
      value: { volume: 42 },
      revisionId: 'r1',
      isStale: false,
    });
  });

  it('forwards progress from the worker body to onProgress', async () => {
    const adapter = makeAdapter(
      {
        slow: async (ctx) => {
          ctx.reportProgress(0.5, 'halfway');
          await tick();
          ctx.reportProgress(1);
          return 'ok';
        },
      },
      { getCurrentRevision: () => 'r1' },
    );
    const seen: Array<[number, string?]> = [];
    const handle = adapter.run({ name: 'slow' }, {
      revisionId: 'r1',
      onProgress: (p, m) => seen.push([p, m]),
    });
    await settled(handle);
    expect(seen).toEqual([
      [0.5, 'halfway'],
      [1, undefined],
    ]);
  });

  it('flags stale results when the revision moves during the run (spec 5.6)', async () => {
    let current = 'r1';
    const adapter = makeAdapter(
      { work: async () => {
        await tick();
        return 'late';
      } },
      { getCurrentRevision: () => current },
    );
    const handle = adapter.run<string>({ name: 'work' }, { revisionId: 'r1' });
    current = 'r2';
    const outcome = await settled(handle);
    expect(outcome.status === 'completed' && outcome.isStale).toBe(true);
  });
});

describe('worker adapter — cancellation', () => {
  it('cancel reaches the worker body through the protocol; body exits cleanly', async () => {
    const adapter = makeAdapter(
      {
        loop: async (ctx) => {
          while (!ctx.signal.aborted) await tick();
          ctx.signal.throwIfAborted();
          return 'unreachable';
        },
      },
      { getCurrentRevision: () => 'r1' },
    );
    const handle = adapter.run({ name: 'loop' }, { revisionId: 'r1' });
    await tick();
    handle.cancel();
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });

  it('dispose() settles pending jobs as cancelled and stops dispatch', async () => {
    const adapter = makeAdapter(
      { never: () => new Promise(() => undefined) },
      { getCurrentRevision: () => 'r1' },
    );
    const handle = adapter.run({ name: 'never' }, { revisionId: 'r1' });
    adapter.dispose();
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
    expect(adapter.activeCount).toBe(0);
    expect(() => adapter.run({ name: 'never' }, { revisionId: 'r1' })).toThrow(/disposed/);
  });

  it('cancelAll cancels every pending run', async () => {
    const adapter = makeAdapter(
      { never: () => new Promise(() => undefined) },
      { getCurrentRevision: () => 'r1' },
    );
    const h1 = adapter.run({ name: 'never' }, { revisionId: 'r1' });
    const h2 = adapter.run({ name: 'never' }, { revisionId: 'r1' });
    adapter.cancelAll();
    expect(await settled(h1)).toEqual({ status: 'cancelled', revisionId: 'r1' });
    expect(await settled(h2)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });
});

describe('worker adapter — failure and validation', () => {
  it('surfaces worker errors as failed outcomes', async () => {
    const adapter = makeAdapter(
      {
        bad: async () => {
          throw new Error('pack property missing');
        },
      },
      { getCurrentRevision: () => 'r1' },
    );
    const outcome = await settled(adapter.run({ name: 'bad' }, { revisionId: 'r1' }));
    expect(outcome).toEqual({
      status: 'failed',
      error: new Error('pack property missing'),
      revisionId: 'r1',
    });
  });

  it('rejects unknown job names with a descriptive error', async () => {
    const adapter = makeAdapter({}, { getCurrentRevision: () => 'r1' });
    const outcome = await settled(adapter.run({ name: 'nope' }, { revisionId: 'r1' }));
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && String(outcome.error)).toMatch(/nope/);
  });

  it('invalid progress reported by the worker body fails the job', async () => {
    const adapter = makeAdapter(
      {
        liar: (ctx) => {
          ctx.reportProgress(7);
          return 'unreachable';
        },
      },
      { getCurrentRevision: () => 'r1' },
    );
    const outcome = await settled(adapter.run({ name: 'liar' }, { revisionId: 'r1' }));
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error instanceof RangeError).toBe(true);
  });

  it('malformed messages off the wire throw a TypeError (Zod-validated boundary)', async () => {
    // A listener that receives garbage (not produced by serveWorkerJobs)
    // must fail loudly instead of mis-routing by jobId.
    let listener: ((event: { data: unknown }) => void) | undefined;
    const adapter = createWorkerAdapter(
      () => ({
        postMessage: () => undefined,
        addEventListener: (_type, l) => {
          listener = l;
        },
        terminate: () => undefined,
      }),
      { getCurrentRevision: () => 'r1' },
    );
    expect(() => listener?.({ data: { kind: 'resolve', jobId: 1.5, value: 1 } })).toThrow(TypeError);
    expect(() => listener?.({ data: { kind: 'explode', jobId: 1 } })).toThrow(TypeError);
    expect(() => listener?.({ data: null })).toThrow(TypeError);
  });
});
