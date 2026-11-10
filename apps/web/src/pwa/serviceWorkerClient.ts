import { useSyncExternalStore } from 'react';
import {
  createServiceWorkerUpdater,
  defaultServiceWorkerContainer,
  type ServiceWorkerSnapshot,
  type ServiceWorkerUpdater,
} from './registration';

/**
 * App-wide service-worker client (spec 11; backlog QA-02).
 *
 * One updater for the page: the shell shows the update prompt from it, the
 * settings panel reads the same state and can ask for an update check. The
 * dev server registers nothing — a worker cached from an earlier production
 * build would serve stale code against Vite's module graph — so `vite dev`
 * reports the honest `unsupported` state.
 */
const updater: ServiceWorkerUpdater = import.meta.env.DEV
  ? createServiceWorkerUpdater({ container: undefined })
  : createServiceWorkerUpdater({ container: defaultServiceWorkerContainer() });

const subscribeToUpdater = (listener: () => void): (() => void) =>
  updater.subscribe(listener);

const getUpdaterSnapshot = (): ServiceWorkerSnapshot => updater.getSnapshot();

/** Registers the offline worker; called once by `main.tsx` before first render. */
export function startServiceWorker(): void {
  // Runs before render so every consumer subscribes to the real updater.
  void updater.register();
}

/** Current update state for the prompt and the settings panel. */
export function useServiceWorkerUpdate(): ServiceWorkerSnapshot {
  return useSyncExternalStore(subscribeToUpdater, getUpdaterSnapshot);
}

/** Ask the browser to look for a new build (settings page). */
export function checkForServiceWorkerUpdate(): void {
  void updater.checkForUpdate();
}

/** Activate the waiting build and reload into it ("a new version is available"). */
export function applyServiceWorkerUpdate(): void {
  updater.applyUpdate();
}
