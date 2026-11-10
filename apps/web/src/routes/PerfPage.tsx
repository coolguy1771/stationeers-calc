import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SchematicCanvas } from '../components/schematic/SchematicCanvas';
import { Button } from '../components/ui/button';
import {
  DRAG_COMMIT_ITERATIONS,
  environmentInfo,
  nextPaint,
  round,
  summarize,
  type PerfReport,
} from '../perf/harness';
import { buildPerfProject, PERF_INSTANCE_COUNT } from '../perf/seededProject';
import { deriveIntentTopology, type IntentStatusEntry } from '../state/intentTopology';
import { flushAutosave, resumeAutosave, suspendAutosave } from '../state/persistence';
import {
  dispatchProjectCommand,
  projectStore,
  swapProjectInStore,
  useProject,
} from '../state/projectStore';
import type { EntityId, Project } from '@stationeers/domain';

/**
 * Performance harness page (spec 11; backlog QA-02), reachable at `/perf`.
 *
 * Deliberately NOT linked from the UI and NOT dev-only: the numbers that matter
 * are production-build numbers, so `scripts/perf-baseline.ts` drives this page
 * from a built `dist/` in Chromium. Visiting it swaps the canonical store to a
 * synthetic project with autosave suspended, measures, and restores the
 * previously open project on the way out — a project in IndexedDB is never
 * touched.
 *
 * Print the report in the page and in the console; `window.__PERF_REPORT__`
 * carries it for the scripted baseline.
 */

type Phase = 'idle' | 'seeding' | 'measuring' | 'done' | 'error';

function requestedCount(search: string): number {
  const raw = new URLSearchParams(search).get('count');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return PERF_INSTANCE_COUNT;
  return Math.min(2000, parsed);
}

export function PerfPage() {
  const liveProject = useProject();
  const [seeded, setSeeded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<PerfReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Project that was open before the harness swapped the store. */
  const previousProject = useRef<Project | null>(null);
  const running = useRef(false);

  // Autosave must not write the synthetic project: the harness owns the store
  // for its lifetime and restores the previous document afterwards.
  useEffect(() => {
    return () => {
      if (previousProject.current !== null) {
        swapProjectInStore(previousProject.current);
        previousProject.current = null;
      }
      resumeAutosave();
    };
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setReport(null);
    setSeeded(false);
    setPhase('seeding');

    try {
      const count = requestedCount(window.location.search);
      previousProject.current = projectStore.state;
      await flushAutosave();
      suspendAutosave();

      const project = buildPerfProject({ count });
      const seedStart = performance.now();
      swapProjectInStore(project);
      const seedMs = performance.now() - seedStart;

      // Render the canvas for the seeded project, then take the first frame
      // that contains it.
      const renderStart = performance.now();
      setSeeded(true);
      setPhase('measuring');
      await nextPaint();
      const firstRenderMs = performance.now() - renderStart;

      // Intent topology is derived on every render (9.1); report it separately
      // so a slow canvas is not blamed on the derivation.
      const topologyStart = performance.now();
      deriveIntentTopology(projectStore.state);
      const intentTopologyMs = performance.now() - topologyStart;

      // One drag = move the node locally, then commit the layout at drag stop.
      const samples: number[] = [];
      const dragged = project.devices
        .slice(0, DRAG_COMMIT_ITERATIONS)
        .map((device) => device.id);
      for (let index = 0; index < dragged.length; index += 1) {
        const entityId = dragged[index];
        if (entityId === undefined) break;
        const started = performance.now();
        dispatchProjectCommand({
          type: 'setNodePosition',
          entityId,
          position: { x: 24 + index * 6, y: 16 + index * 4 },
        });
        await nextPaint();
        samples.push(performance.now() - started);
      }

      const drag = summarize(samples);
      const next: PerfReport = {
        instances: projectStore.state.devices.length,
        intents: projectStore.state.intents.length,
        placements: projectStore.state.placements.length,
        seedMs: round(seedMs),
        firstRenderMs: round(firstRenderMs),
        dragCommit: {
          minMs: round(drag.minMs),
          medianMs: round(drag.medianMs),
          p95Ms: round(drag.p95Ms),
          maxMs: round(drag.maxMs),
          iterations: samples.length,
        },
        intentTopologyMs: round(intentTopologyMs),
        environment: environmentInfo(),
        at: new Date().toISOString(),
      };
      window.__PERF_REPORT__ = next;
      setReport(next);
      setPhase('done');
      console.info('[perf] harness report', next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setPhase('error');
    } finally {
      running.current = false;
    }
  }, []);

  // The page exists to measure: run once on arrival.
  useEffect(() => {
    void run();
  }, [run]);

  const project = seeded ? liveProject : null;
  const statuses = useMemo<ReadonlyMap<EntityId, IntentStatusEntry>>(
    () => (project === null ? new Map() : deriveIntentTopology(project)),
    [project],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-sm font-semibold">Performance harness</h1>
        <p className="text-xs text-muted-foreground">
          {phase === 'done' || phase === 'error'
            ? `Seeded project with ${requestedCount(window.location.search)} instances (spec 11 reference desktop).`
            : 'Seeding the canonical store and drawing the canvas…'}
        </p>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void run()}>
          Run again
        </Button>
      </header>

      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          Harness failed: {error}
        </p>
      )}

      {report === null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {phase === 'measuring' ? 'Measuring canvas render…' : 'Starting…'}
        </p>
      ) : (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"
          data-testid="perf-report"
        >
          <dt className="text-muted-foreground">Instances / intents / placements</dt>
          <dd className="font-mono">
            {report.instances} / {report.intents} / {report.placements}
          </dd>
          <dt className="text-muted-foreground">Seed (store swap)</dt>
          <dd className="font-mono">{report.seedMs} ms</dd>
          <dt className="text-muted-foreground">First canvas render</dt>
          <dd className="font-mono">{report.firstRenderMs} ms</dd>
          <dt className="text-muted-foreground">
            Drag commit (median / p95 / max, {report.dragCommit.iterations}×)
          </dt>
          <dd className="font-mono">
            {report.dragCommit.medianMs} / {report.dragCommit.p95Ms} /{' '}
            {report.dragCommit.maxMs} ms
          </dd>
          <dt className="text-muted-foreground">Intent topology derivation</dt>
          <dd className="font-mono">{report.intentTopologyMs} ms</dd>
        </dl>
      )}

      <div className="min-h-0 flex-1">
        {project === null ? (
          <div className="h-full rounded-md border border-dashed border-border" />
        ) : (
          <ReactFlowProvider>
            <SchematicCanvas
              project={project}
              statuses={statuses}
              selection={null}
              onSelect={() => undefined}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
