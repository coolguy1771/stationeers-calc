import { FlaskConical, Play } from 'lucide-react';
import type { CalculationResult } from '@stationeers/domain';
import { CalculationResultStatus } from '../../components/status/ResultStatusSummary';
import { DiagnosticsPanel } from '../../components/DiagnosticsPanel';
import { ResultRevisionTag } from '../../components/ResultRevisionTag';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { shortHash } from '../../lib/utils';
import { stubbedAction } from '../../lib/stubs';
import { mockDiagnostics } from '../../mocks';
import { useTaggedMockResult } from '../../state/analysis';

/**
 * Engineering analysis tab (spec 7.5). Left: scenario form skeleton (real
 * scenario editing + engine runs land with SIM-02 over revision-aware worker
 * jobs). Right: results panel rendering a CalculationResult with BOTH
 * independent statuses side by side (spec 3.5) — the reference display for
 * SIM-03. Provenance (pack hash, engine version, scenario digest) is shown
 * with every result (spec 13 #3, 1.1 #7).
 */
export function AnalysisPage() {
  // The mock result is tagged with the revision it was "computed" on; once the
  // store moves past it the panel reports stale instead of current (5.6).
  const tagged = useTaggedMockResult();
  const { result } = tagged;

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="flex w-84 shrink-0 flex-col gap-3 overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">Scenario</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scenario-network">Network / intent reference</Label>
              <Input id="scenario-network" readOnly value={result.networkRef} className="font-mono text-xs" />
            </div>
            <ScenarioInput id="total-moles" label="Total moles (mol)" value={numberValue(result.inputs.totalMoles)} />
            <ScenarioInput id="temperature-k" label="Temperature (K)" value={numberValue(result.inputs.temperatureK)} />
            <ScenarioInput
              id="assumed-volume"
              label="Assumed volume (m³)"
              value={numberValue(result.inputs.assumedVolumeM3)}
              hint="Explicit user assumption for an unrouted network — forces Conceptual status (spec 4.7)."
            />
            <Button onClick={() => stubbedAction('Run analysis on revision-tagged worker job (spec 5.6)', 'SIM-02')}>
              <Play aria-hidden />
              Run analysis
            </Button>
            <p className="text-[11px] text-muted-foreground/80">
              Unverified (experimental) output requires the project opt-in{' '}
              <span className="font-mono">showExperimental</span> (spec 5.2); it never carries the exact
              designation.
            </p>
          </CardContent>
        </Card>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <Card>
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="font-mono text-sm">{result.capabilityId}</CardTitle>
              <span className="font-mono text-[11px] text-muted-foreground">network {result.networkRef}</span>
            </div>
            <CalculationResultStatus result={result} />
            <ResultRevisionTag tagged={tagged} />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ResultIO result={result} />
            <div>
              <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase">Explanation</h4>
              <ul className="mt-1.5 flex flex-col gap-1">
                {result.explanation.map((line) => (
                  <li key={line} className="flex gap-1.5 text-xs text-foreground/90">
                    <span aria-hidden className="text-primary/70">▸</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Provenance result={result} />
          </CardContent>
        </Card>
        <DiagnosticsPanel diagnostics={mockDiagnostics} />
      </div>
    </div>
  );
}

function ScenarioInput({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        readOnly
        disabled
        className="font-mono text-xs tabular"
        title="Form is a skeleton; scenario editing lands with SIM-02"
      />
      {hint ? <p className="text-[10px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}

function numberValue(value: unknown): string {
  return typeof value === 'number' ? String(value) : '';
}

function ResultIO({ result }: { result: CalculationResult }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase">Inputs</h4>
        <dl className="mt-1.5 flex flex-col gap-1">
          {Object.entries(result.inputs).map(([key, value]) => (
            <IORow key={key} label={key} value={value} />
          ))}
        </dl>
      </div>
      <div>
        <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase">Outputs</h4>
        <dl className="mt-1.5 flex flex-col gap-1">
          {Object.entries(result.outputs).map(([key, value]) => (
            <IORow key={key} label={key} value={value} />
          ))}
        </dl>
      </div>
    </div>
  );
}

function IORow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1">
      <dt className="font-mono text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono text-xs tabular">{formatUnknown(value)}</dd>
    </div>
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function Provenance({ result }: { result: CalculationResult }) {
  return (
    <div>
      <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase">Provenance</h4>
      <dl className="mt-1.5 grid gap-1 text-[11px] sm:grid-cols-3">
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-muted-foreground">Pinned pack hash</dt>
          <dd className="mt-0.5 font-mono">{result.computedWith.packHash}</dd>
        </div>
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-muted-foreground">Behavior engine</dt>
          <dd className="mt-0.5 font-mono">{result.computedWith.behaviorEngineVersion}</dd>
        </div>
        <div className="rounded-md border border-border/60 p-2">
          <dt className="text-muted-foreground">Scenario digest</dt>
          <dd className="mt-0.5 font-mono">{result.computedWith.scenarioDigest}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[10px] text-muted-foreground/70">
        Results computed under one pack are never displayed as valid for another (spec 2.4) —{' '}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default underline decoration-dotted">
              hash #{shortHash(result.computedWith.packHash, 12)}…
            </span>
          </TooltipTrigger>
          <TooltipContent>Full pack hash: {result.computedWith.packHash}</TooltipContent>
        </Tooltip>{' '}
        <FlaskConical aria-hidden className="inline size-3" />
      </p>
    </div>
  );
}
