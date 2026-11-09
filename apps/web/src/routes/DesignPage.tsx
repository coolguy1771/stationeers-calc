import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type * as React from 'react';
import type { DataQuality, ModelStatus, Severity, TopologyStatus } from '@stationeers/domain';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import {
  type IntentTopologyStatus,
} from '../components/status/statusConfig';
import { DataQualityBadge } from '../components/status/DataQualityBadge';
import { IntentStatusChip } from '../components/status/IntentStatusChip';
import { ModelStatusBadge } from '../components/status/ModelStatusBadge';
import { ResultStatusSummary } from '../components/status/ResultStatusSummary';
import { SeverityBadge } from '../components/status/SeverityBadge';
import { TopologyStatusBadge } from '../components/status/TopologyStatusBadge';
import { SaveStatusIndicator } from '../components/SaveStatusIndicator';
import { ThemeToggle } from '../components/ThemeToggle';

const MODEL_STATUSES: ModelStatus[] = ['verified', 'unverified', 'unsupported', 'incompatible'];
const TOPOLOGY_STATUSES: TopologyStatus[] = ['buildable', 'conceptual'];
const DATA_QUALITIES: DataQuality[] = [
  'extracted-and-validated',
  'extracted-unverified',
  'inferred',
  'missing',
  'conflicting',
];
const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const INTENT_STATUSES: IntentTopologyStatus[] = [
  'unrouted',
  'routed',
  'routed-with-warnings',
  'conflicting',
  'not-buildable',
];

/**
 * Design-system showcase (dev route, UI-01): every state of every status
 * component, the independent-status pairing rules, and the primitives.
 * Doubles as living documentation of the status semantics (spec 3.5/5.2/6.5/8).
 */
export function DesignPage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Design system — UI-01</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Instrument-panel aesthetic: graphite surfaces, one cyan accent, IBM Plex Sans/Mono with tabular
            numerics. Status vocabulary is spec-critical: filled chips = model status (5.2), dashed fill =
            experimental, outline chips = topology (3.5). Only Verified AND Buildable may read as exact.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline">
            <Link to="/">
              <ArrowLeft aria-hidden />
              Projects
            </Link>
          </Button>
        </div>
      </header>

      <ShowcaseCard
        title="Model status (5.2)"
        note="Filled chips. Unverified is experimental output — dashed amber, never a success style. Unsupported is neutral; an unsupported result is not a pass."
      >
        {MODEL_STATUSES.map((status) => (
          <ModelStatusBadge key={status} status={status} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard
        title="Topology status (3.5)"
        note="Outline chips — deliberately a different visual language from model status, because the two statuses are independent."
      >
        {TOPOLOGY_STATUSES.map((status) => (
          <TopologyStatusBadge key={status} status={status} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard
        title="Independent statuses — honest pairing (3.5)"
        note="Every model × topology combination the UI may ever show. Exact only for Verified + Buildable; Verified + Conceptual reads “correct mechanics, assumed topology”."
      >
        {MODEL_STATUSES.map((model) =>
          TOPOLOGY_STATUSES.map((topology) => (
            <ResultStatusSummary key={`${model}-${topology}`} modelStatus={model} topologyStatus={topology} />
          )),
        )}
      </ShowcaseCard>

      <ShowcaseCard
        title="Intent topology status (3.5, derived — never stored, 9.1)"
        note="Display vocabulary for ConnectionIntents; kept separate from result topology status."
      >
        {INTENT_STATUSES.map((status) => (
          <IntentStatusChip key={status} status={status} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard
        title="Data quality (6.5) — provenance on every displayed property (13 #3)"
        note="Compact dot + label for per-property rows. Missing is hollow (absence, not a value); Inferred must identify its calculation and dependencies."
      >
        {DATA_QUALITIES.map((quality) => (
          <DataQualityBadge key={quality} quality={quality} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard title="Diagnostic severity (8)">
        {SEVERITIES.map((severity) => (
          <SeverityBadge key={severity} severity={severity} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard title="Save status (7.1 placeholder machine — FND-03 wires it)">
        {(['saved', 'dirty', 'saving', 'error'] as const).map((status) => (
          <SaveStatusIndicator key={status} status={status} />
        ))}
      </ShowcaseCard>

      <ShowcaseCard title="Primitives" note="IBM Plex Sans for UI, IBM Plex Mono for values/IDs/hashes, tabular figures so numeric columns align.">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Input placeholder="Input" className="w-40" />
        <span className="font-mono text-sm tabular">1 015.31 kPa</span>
        <span className="font-mono text-xs text-muted-foreground">x:-3 y:2 z:0 · sha256:9f2a11c4…</span>
      </ShowcaseCard>

      <section>
        <Separator className="mb-4" />
        <div className="flex flex-wrap gap-3">
          {(
            [
              ['background', 'bg-background'],
              ['card', 'bg-card'],
              ['popover', 'bg-popover'],
              ['primary', 'bg-primary'],
              ['secondary', 'bg-secondary'],
              ['muted', 'bg-muted'],
              ['accent', 'bg-accent'],
              ['destructive', 'bg-destructive'],
              ['border', 'bg-border'],
            ] as const
          ).map(([token, className]) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <span className={`size-10 rounded-sm border border-border ${className}`} title={`--color-${token}`} />
              <span className="font-mono text-[10px] text-muted-foreground">{token}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ShowcaseCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-medium">{title}</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">{children}</CardContent>
    </Card>
  );
}
