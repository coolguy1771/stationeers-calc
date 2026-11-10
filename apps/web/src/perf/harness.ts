/**
 * Performance harness primitives (spec 11; backlog QA-02).
 *
 * The spec asks for smooth manipulation of ~200 device instances and says to
 * "measure benchmarks before setting hard release thresholds" — so this module
 * measures and reports, and hard-codes no pass/fail line. What it measures is
 * exactly what the editor does:
 *
 * - `firstRenderMs`: seed the canonical store, mount the schematic canvas,
 *   wait for the frame that contains it.
 * - `dragCommitMs`: the cost of ONE drag: React Flow moves the node locally
 *   while the pointer is down, and the editor commits a `setNodePosition`
 *   command when the drag stops (`state/schematicLayout.ts` debounce). That
 *   commit re-renders the projection — the per-frame pointer cost is React
 *   Flow's own transform, not this.
 */

/** Iterations of the drag-commit measurement (median/p95 need a sample set). */
export const DRAG_COMMIT_ITERATIONS = 20;

export interface PerfNumbers {
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface PerfReport {
  readonly instances: number;
  readonly intents: number;
  readonly placements: number;
  /** Store swap with the seeded project (createStore validates the document). */
  readonly seedMs: number;
  /** Seed → the frame that first paints the canvas. */
  readonly firstRenderMs: number;
  /** One drag-stop layout commit, over `DRAG_COMMIT_ITERATIONS` samples. */
  readonly dragCommit: PerfNumbers & { readonly iterations: number };
  readonly intentTopologyMs: number;
  readonly environment: {
    readonly userAgent: string;
    readonly hardwareConcurrency: number | null;
    readonly deviceMemoryGb: number | null;
    readonly viewport: { readonly width: number; readonly height: number };
  };
  readonly at: string;
}

declare global {
  interface Window {
    /** Set by `/perf`; read by `scripts/perf-baseline.ts`. */
    __PERF_REPORT__?: PerfReport;
  }
}

/** Linear-interpolated percentile over an unsorted sample set. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const position = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function summarize(samples: readonly number[]): PerfNumbers {
  return {
    minMs: samples.length === 0 ? 0 : Math.min(...samples),
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples.length === 0 ? 0 : Math.max(...samples),
  };
}

/** Resolves on the frame after the next one: work committed and painted. */
export function nextPaint(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve(performance.now()));
    });
  });
}

/** Rounds a measurement to 0.1 ms so reports stay readable and stable. */
export function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Environment the numbers belong to; a baseline without it is not comparable. */
export function environmentInfo(): PerfReport['environment'] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}
