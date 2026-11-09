import { describe, expect, it } from 'vitest';
import { createJobRunner } from './job-runner';
import { JobCancelledError } from './types';
import type { JobOutcome } from './types';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Settles the handle's result promise and returns the outcome. */
async function settled<T>(handle: { result: Promise<JobOutcome<T>> }): Promise<JobOutcome<T>> {
  // The result promise never rejects by contract; await it directly.
  return handle.result;
}

describe('job runner — revision tagging', () => {
  it('tags outcomes with the revision the job was submitted on', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => 42, {
      revisionId: 'r1',
      label: 'pressure',
    });
    expect(handle.revisionId).toBe('r1');
    expect(handle.label).toBe('pressure');
    expect(await handle.result).toEqual({
      status: 'completed',
      value: 42,
      revisionId: 'r1',
      isStale: false,
    });
  });

  it('defaults the revision to getCurrentRevision() at submit time', async () => {
    let current = 'r1';
    const runner = createJobRunner({ getCurrentRevision: () => current });
    const handle = runner.submit(async () => 1, {});
    expect(handle.revisionId).toBe('r1');
    current = 'r2'; // revision moved during the run
    const outcome = await settled(handle);
    expect(outcome.status === 'completed' && outcome.revisionId === 'r1' && outcome.isStale).toBe(
      true,
    );
  });

  it('flags stale results instead of presenting them as current (spec 5.6)', async () => {
    let current = 'r1';
    const runner = createJobRunner({ getCurrentRevision: () => current });
    // The body parks at its first await; flipping the revision synchronously
    // here guarantees it settles into a changed-revision world.
    const handle = runner.submit(async () => {
      await tick();
      return 'stale-value';
    }, { revisionId: 'r1' });
    current = 'r2';
    const outcome = await settled(handle);
    expect(outcome).toEqual({
      status: 'completed',
      value: 'stale-value',
      revisionId: 'r1',
      isStale: true,
    });
  });

  it('discard policy withholds stale values entirely', async () => {
    let current = 'r1';
    const runner = createJobRunner({ getCurrentRevision: () => current, onStale: 'discard' });
    const handle = runner.submit(async () => {
      await tick();
      return 'never-delivered';
    }, { revisionId: 'r1' });
    current = 'r2';
    expect(await settled(handle)).toEqual({ status: 'discarded', revisionId: 'r1' });
  });

  it('a throwing getCurrentRevision surfaces as a failed outcome, not a rejection', async () => {
    let current = 'r1';
    const runner = createJobRunner({
      getCurrentRevision: () => {
        if (current === 'broken') throw new Error('revision source exploded');
        return current;
      },
    });
    const handle = runner.submit(async () => {
      await tick();
      return 7;
    }, { revisionId: 'r1' });
    current = 'broken';
    const outcome = await settled(handle);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && (outcome.error as Error).message).toBe(
      'revision source exploded',
    );
  });
});

describe('job runner — cooperative cancellation', () => {
  it('cancels before settle: even a body that finishes later has its value dropped', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => {
      await tick();
      return 42;
    }, { revisionId: 'r1' });
    handle.cancel();
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });

  it('bodies polling signal.aborted observe the cancellation', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async (ctx) => {
      while (!ctx.signal.aborted) await tick();
      ctx.signal.throwIfAborted();
      return 'unreachable';
    }, { revisionId: 'r1' });
    await tick();
    expect(handle.cancel()).toBeUndefined(); // void, idempotent
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });

  it('onAbort listeners fire on cancel (and immediately when already aborted)', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const aborted = deferred<void>();
    const handle = runner.submit(async (ctx) => {
      ctx.signal.onAbort(() => aborted.resolve());
      await aborted.promise;
      return 'unreachable';
    }, { revisionId: 'r1' });
    await tick();
    handle.cancel();
    await aborted.promise;
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });

  it('cancel() after settle is a no-op', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => 5, { revisionId: 'r1' });
    expect(await settled(handle)).toMatchObject({ status: 'completed', value: 5 });
    expect(() => handle.cancel()).not.toThrow();
  });

  it('cancelAll() cancels every active job', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const h1 = runner.submit(() => new Promise(() => undefined), { revisionId: 'r1' });
    const h2 = runner.submit(() => new Promise(() => undefined), { revisionId: 'r1' });
    expect(runner.activeCount).toBe(2);
    runner.cancelAll();
    expect(await settled(h1)).toEqual({ status: 'cancelled', revisionId: 'r1' });
    expect(await settled(h2)).toEqual({ status: 'cancelled', revisionId: 'r1' });
    expect(runner.activeCount).toBe(0);
  });

  it('tracks activeCount across the job lifecycle', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => {
      await tick();
      return 1;
    }, { revisionId: 'r1' });
    expect(runner.activeCount).toBe(1);
    await settled(handle);
    expect(runner.activeCount).toBe(0);
  });
});

describe('job runner — progress', () => {
  it('forwards reportProgress calls to the submit options callback', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const seen: Array<[number, string?]> = [];
    const handle = runner.submit(async (ctx) => {
      ctx.reportProgress(0.25, 'resolving networks');
      await tick();
      ctx.reportProgress(0.5);
      return 'done';
    }, {
      revisionId: 'r1',
      onProgress: (progress, message) => seen.push([progress, message]),
    });
    await settled(handle);
    expect(seen).toEqual([
      [0.25, 'resolving networks'],
      [0.5, undefined],
    ]);
  });

  it('rejects malformed progress values with a RangeError (job fails honestly)', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async (ctx) => {
      ctx.reportProgress(1.5);
      return 'unreachable';
    }, { revisionId: 'r1' });
    const outcome = await settled(handle);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error instanceof RangeError).toBe(true);
  });
});

describe('job runner — failure isolation', () => {
  it('body errors resolve to a failed outcome; the result promise never rejects', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => {
      throw new Error('model envelope violated');
    }, { revisionId: 'r1', label: 'boom' });
    const outcome = await settled(handle);
    expect(outcome).toEqual({
      status: 'failed',
      error: new Error('model envelope violated'),
      revisionId: 'r1',
    });
  });

  it('a synchronous throw from the body also becomes a failed outcome', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(() => {
      throw new RangeError('not async, just broken');
    }, { revisionId: 'r1' });
    const outcome = await settled(handle);
    expect(outcome.status).toBe('failed');
  });

  it('a stray JobCancelledError classifies as cancelled even without cancel()', async () => {
    // Documented: JobCancelledError from a body always means cancellation
    // (worker-side bodies rely on this when unwinding), never 'failed'.
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async () => {
      throw new JobCancelledError('unwinding without a cancel request');
    }, { revisionId: 'r1' });
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });

  it('JobCancelledError from throwIfAborted classifies as cancelled, not failed', async () => {
    const runner = createJobRunner({ getCurrentRevision: () => 'r1' });
    const handle = runner.submit(async (ctx) => {
      await tick();
      ctx.signal.throwIfAborted();
      return 'unreachable';
    }, { revisionId: 'r1' });
    handle.cancel();
    expect(await settled(handle)).toEqual({ status: 'cancelled', revisionId: 'r1' });
  });
});
