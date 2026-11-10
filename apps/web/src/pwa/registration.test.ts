import { describe, expect, it, vi } from 'vitest';
import {
  createServiceWorkerUpdater,
  type SwContainerLike,
  type SwRegistrationLike,
  type SwWorkerLike,
} from './registration';
import { SKIP_WAITING_MESSAGE } from './swPolicy';

/**
 * Update prompt state machine (spec 11; backlog QA-02).
 *
 * The rule the tests pin down: a new build is DETECTED and OFFERED, never
 * swapped in on its own. `register()` reports `ready`, an installed worker
 * behind a controller reports `update-available`, and only `applyUpdate()` —
 * the user pressing "Reload" — posts SKIP_WAITING and reloads.
 */

class FakeWorker implements SwWorkerLike {
  state = 'installing';
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Drives the worker's lifecycle the way the browser would. */
  transitionTo(state: string): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** Registration double that can announce a browser-initiated update (`updatefound`). */
class FakeRegistration implements SwRegistrationLike {
  waiting: SwWorkerLike | null = null;
  installing: SwWorkerLike | null = null;
  active: SwWorkerLike | null = null;
  private readonly updateFound: (() => void)[] = [];

  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.updateFound.push(listener);
  }

  update(): Promise<unknown> {
    return Promise.resolve();
  }

  /** The browser discovers a new build and starts installing it. */
  startUpdate(worker: SwWorkerLike): void {
    this.installing = worker;
    for (const listener of this.updateFound) listener();
  }
}

class FakeContainer implements SwContainerLike {
  controller: unknown = null;
  registration: SwRegistrationLike | undefined;
  registerError: Error | undefined;
  readonly registered: { url: string; scope: string | undefined }[] = [];
  private controllerChange: (() => void)[] = [];

  constructor(registration?: SwRegistrationLike) {
    this.registration = registration;
  }

  async register(url: string, options?: { scope?: string }) {
    this.registered.push({ url, scope: options?.scope });
    if (this.registerError !== undefined) throw this.registerError;
    if (this.registration === undefined) {
      this.registration = { waiting: null, installing: null, active: null };
    }
    return this.registration;
  }

  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.controllerChange.push(listener);
  }

  removeEventListener(_type: 'controllerchange', listener: () => void): void {
    this.controllerChange = this.controllerChange.filter((l) => l !== listener);
  }

  /** The browser hands control to a newly activated worker. */
  handOverControl(): void {
    this.controller = {};
    for (const listener of this.controllerChange) listener();
  }
}

describe('service worker registration (11)', () => {
  it('is unsupported where the API is absent, and does nothing', async () => {
    const reload = vi.fn();
    const updater = createServiceWorkerUpdater({ container: undefined, reload });
    expect(updater.getSnapshot().state).toBe('unsupported');
    await updater.register();
    updater.applyUpdate();
    expect(updater.getSnapshot().state).toBe('unsupported');
    expect(reload).not.toHaveBeenCalled();
  });

  it('registers at the app root and settles on ready', async () => {
    const container = new FakeContainer();
    const updater = createServiceWorkerUpdater({ container });
    const states: string[] = [];
    updater.subscribe(() => states.push(updater.getSnapshot().state));

    await updater.register();

    expect(container.registered).toEqual([{ url: '/sw.js', scope: '/' }]);
    expect(states[0]).toBe('registering');
    expect(updater.getSnapshot()).toEqual({ state: 'ready', error: null });
  });

  it('reports a waiting worker from a previous visit as an update', async () => {
    const waiting = new FakeWorker();
    const container = new FakeContainer({ waiting, installing: null, active: waiting });
    container.controller = {};
    const updater = createServiceWorkerUpdater({ container });

    await updater.register();

    expect(updater.getSnapshot().state).toBe('update-available');
  });

  it('detects a new build that finishes installing behind a controller', async () => {
    const installed = new FakeWorker();
    const incoming = new FakeWorker();
    const registration: SwRegistrationLike & { installing: SwWorkerLike | null } = {
      waiting: null,
      installing: null,
      active: installed,
      // The browser's update check discovers the new build and starts it.
      update: async () => {
        registration.installing = incoming;
      },
    };
    const container = new FakeContainer(registration);
    container.controller = {};
    const updater = createServiceWorkerUpdater({ container });
    await updater.register();
    expect(updater.getSnapshot().state).toBe('ready');

    await updater.checkForUpdate();
    incoming.transitionTo('installed');

    expect(updater.getSnapshot().state).toBe('update-available');
  });

  it('notices a build that the browser starts installing after registration', async () => {
    const registration = new FakeRegistration();
    const container = new FakeContainer(registration);
    container.controller = {};
    const updater = createServiceWorkerUpdater({ container });
    await updater.register();
    expect(updater.getSnapshot().state).toBe('ready');

    // The update check happens on its own schedule; only `updatefound`
    // announces a worker that did not exist when `register()` resolved.
    const incoming = new FakeWorker();
    registration.startUpdate(incoming);
    incoming.transitionTo('installed');

    expect(updater.getSnapshot().state).toBe('update-available');
  });

  it('treats a first install with no controller as ready, not as an update', async () => {
    const first = new FakeWorker();
    const container = new FakeContainer({ waiting: null, installing: first, active: null });
    const updater = createServiceWorkerUpdater({ container });
    await updater.register();

    first.transitionTo('installed');

    expect(updater.getSnapshot().state).toBe('ready');
  });

  it('discards a redundant worker with an error instead of staying silent', async () => {
    const broken = new FakeWorker();
    const container = new FakeContainer({ waiting: null, installing: broken, active: null });
    const updater = createServiceWorkerUpdater({ container });
    await updater.register();

    broken.transitionTo('redundant');

    expect(updater.getSnapshot().state).toBe('error');
    expect(updater.getSnapshot().error).toContain('discarded');
  });

  it('surfaces a registration failure as an error state', async () => {
    const container = new FakeContainer();
    container.registerError = new Error('insecure context');
    const updater = createServiceWorkerUpdater({ container });

    await updater.register();

    expect(updater.getSnapshot()).toEqual({
      state: 'error',
      error: 'insecure context',
    });
  });

  it('applyUpdate posts SKIP_WAITING, then reloads on controllerchange', async () => {
    const waiting = new FakeWorker();
    const container = new FakeContainer({ waiting, installing: null, active: waiting });
    container.controller = {};
    const reload = vi.fn();
    const updater = createServiceWorkerUpdater({ container, reload });
    await updater.register();

    updater.applyUpdate();
    expect(waiting.messages).toEqual([SKIP_WAITING_MESSAGE]);
    // Nothing happens until the browser finishes the handover.
    expect(reload).not.toHaveBeenCalled();

    container.handOverControl();
    expect(reload).toHaveBeenCalledTimes(1);

    // A second controllerchange must not reload again.
    container.handOverControl();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('cannot apply an update when no worker is waiting', async () => {
    const container = new FakeContainer({ waiting: null, installing: null, active: null });
    const reload = vi.fn();
    const updater = createServiceWorkerUpdater({ container, reload });
    await updater.register();

    updater.applyUpdate();

    expect(reload).not.toHaveBeenCalled();
    expect(updater.getSnapshot().state).toBe('ready');
  });

  it('stops notifying after dispose', async () => {
    const container = new FakeContainer();
    const updater = createServiceWorkerUpdater({ container });
    const listener = vi.fn();
    updater.subscribe(listener);
    await updater.register();
    listener.mockClear();

    updater.dispose();
    container.handOverControl();

    expect(listener).not.toHaveBeenCalled();
  });
});
