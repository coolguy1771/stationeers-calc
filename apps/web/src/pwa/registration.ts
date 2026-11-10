import { SKIP_WAITING_MESSAGE } from './swPolicy';

/**
 * Service-worker registration and update prompt (spec 11; backlog QA-02).
 *
 * The build ships a generated `sw.js` (see `src/sw.ts`); this module owns the
 * page side of it: when to register, when to say "a new version is available —
 * reload", and what "reload" actually does. It is written against a minimal
 * `SwContainerLike` interface so the whole state machine is unit-tested with a
 * fake container instead of a real browser.
 *
 * States:
 *   unsupported → no service worker API (or no secure context): the app works,
 *                 just without offline install.
 *   idle        → nothing registered yet.
 *   registering → `register()` is in flight.
 *   ready       → a worker controls (or will control) this page.
 *   update-available → a NEW worker is installed and waiting; the shell offers
 *                 the reload prompt and never swaps builds behind the user.
 *   error       → registration failed; the app still works online.
 */

export type ServiceWorkerUpdateState =
  | 'unsupported'
  | 'idle'
  | 'registering'
  | 'ready'
  | 'update-available'
  | 'error';

/** Minimal shape of a `ServiceWorker` used here. */
export interface SwWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener?(type: 'statechange', listener: () => void): void;
}

/** Minimal shape of a `ServiceWorkerRegistration` used here. */
export interface SwRegistrationLike {
  readonly waiting: SwWorkerLike | null;
  readonly installing: SwWorkerLike | null;
  readonly active: SwWorkerLike | null;
  update?(): Promise<unknown>;
  addEventListener?(type: 'updatefound', listener: () => void): void;
}

/** Minimal shape of `navigator.serviceWorker` used here. */
export interface SwContainerLike {
  readonly controller: unknown;
  register(
    scriptUrl: string,
    options?: { scope?: string },
  ): Promise<SwRegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener?(type: 'controllerchange', listener: () => void): void;
}

export interface ServiceWorkerSnapshot {
  readonly state: ServiceWorkerUpdateState;
  /** Failure detail for `state: 'error'`; never a raw object. */
  readonly error: string | null;
}

export interface ServiceWorkerUpdaterOptions {
  /** `navigator.serviceWorker`, or `undefined` where the API is absent. */
  readonly container: SwContainerLike | undefined;
  readonly scriptUrl?: string;
  readonly scope?: string;
  /** Injected so tests do not navigate; defaults to a real reload. */
  readonly reload?: () => void;
}

export interface ServiceWorkerUpdater {
  getSnapshot(): ServiceWorkerSnapshot;
  subscribe(listener: () => void): () => void;
  /** Registers the worker once; idempotent. */
  register(): Promise<void>;
  /** Asks the browser to look for a new build (settings page, focus). */
  checkForUpdate(): Promise<void>;
  /** Activates the waiting worker and reloads into it (update prompt). */
  applyUpdate(): void;
  /** Releases listeners (tests, teardown). */
  dispose(): void;
}

const UPDATED_MESSAGE = SKIP_WAITING_MESSAGE;

/** The updater over `navigator.serviceWorker`, or an inert "unsupported" one. */
export function createServiceWorkerUpdater(
  options: ServiceWorkerUpdaterOptions,
): ServiceWorkerUpdater {
  const { container } = options;
  const scriptUrl = options.scriptUrl ?? '/sw.js';
  const scope = options.scope ?? '/';
  const reload = options.reload ?? (() => window.location.reload());

  let snapshot: ServiceWorkerSnapshot = {
    state: container === undefined ? 'unsupported' : 'idle',
    error: null,
  };
  const listeners = new Set<() => void>();
  let registration: SwRegistrationLike | undefined;
  let registrationStarted = false;
  /** Workers already watched, so `updatefound` cannot double-attach listeners. */
  const watched = new WeakSet<SwWorkerLike>();
  /** Set between "reload" and the browser's `controllerchange`. */
  let reloadPending = false;
  let disposed = false;

  function setSnapshot(
    state: ServiceWorkerUpdateState,
    error: string | null = null,
  ): void {
    if (snapshot.state === state && snapshot.error === error) return;
    snapshot = { state, error };
    for (const listener of listeners) listener();
  }

  /** A worker that finished installing is either the first one or an update. */
  function watchInstalling(worker: SwWorkerLike | null): void {
    if (worker === null || worker.addEventListener === undefined) return;
    if (watched.has(worker)) return;
    watched.add(worker);
    worker.addEventListener('statechange', () => {
      if (disposed) return;
      if (worker.state === 'installed') {
        // A controller means the page is already running an older build.
        setSnapshot(container?.controller ? 'update-available' : 'ready');
      } else if (worker.state === 'redundant') {
        setSnapshot('error', 'The browser discarded the new service worker.');
      }
    });
  }

  function onControllerChange(): void {
    if (!reloadPending || disposed) return;
    reloadPending = false;
    reload();
  }

  /**
   * Watches the registration itself, not just the worker that exists right now:
   * the browser's automatic update check can start installing a new worker
   * *after* `register()` resolved, and only `updatefound` announces it.
   */
  function attachUpdateWatch(target: SwRegistrationLike): void {
    target.addEventListener?.('updatefound', () => {
      if (disposed) return;
      watchInstalling(target.installing);
    });
    // `updatefound` may have fired before the listener was attached.
    watchInstalling(target.installing);
  }

  container?.addEventListener('controllerchange', onControllerChange);

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async register(): Promise<void> {
      if (container === undefined || registrationStarted) return;
      registrationStarted = true;
      setSnapshot('registering');
      try {
        registration = await container.register(scriptUrl, { scope });
        if (disposed) return;
        if (registration.waiting !== null && container.controller) {
          // A previous visit left a new build waiting.
          setSnapshot('update-available');
          return;
        }
        attachUpdateWatch(registration);
        setSnapshot('ready');
      } catch (error) {
        setSnapshot(
          'error',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    async checkForUpdate(): Promise<void> {
      const current = registration;
      if (current?.update === undefined) return;
      try {
        await current.update();
        if (disposed) return;
        if (current.waiting !== null && container?.controller) {
          setSnapshot('update-available');
          return;
        }
        attachUpdateWatch(current);
      } catch (error) {
        setSnapshot(
          'error',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    applyUpdate(): void {
      const waiting = registration?.waiting ?? null;
      if (waiting === null || container === undefined) return;
      reloadPending = true;
      waiting.postMessage(UPDATED_MESSAGE);
      // `controllerchange` follows once the new worker claims this page.
      // Without that event (a browser that never hands over control) the
      // prompt stays visible: reloading is the user's decision, never a guess.
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
      container?.removeEventListener?.('controllerchange', onControllerChange);
    },
  };
}

/** `navigator.serviceWorker` where the API exists (not in jsdom, not on http). */
export function defaultServiceWorkerContainer(): SwContainerLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const container = (navigator as Navigator & { serviceWorker?: SwContainerLike })
    .serviceWorker;
  return container;
}
