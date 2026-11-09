import type { CalculationResult, ModelStatus, TopologyStatus } from '@stationeers/domain';
import { cn } from '../../lib/utils';
import { ModelStatusBadge } from './ModelStatusBadge';
import { TopologyStatusBadge } from './TopologyStatusBadge';
import { resultVerdict, VERDICT_TONE_CLASS } from './statusConfig';

/**
 * The two independent statuses of a result, side by side, plus the single
 * honest verdict line derived from them (spec 3.5: exact only when Verified
 * AND Buildable; Verified + Conceptual reads "correct mechanics, assumed
 * topology"). This is THE component analysis results (SIM-03) must reuse.
 */
export function ResultStatusSummary({
  modelStatus,
  topologyStatus,
  className,
}: {
  modelStatus: ModelStatus;
  topologyStatus: TopologyStatus;
  className?: string;
}) {
  const verdict = resultVerdict(modelStatus, topologyStatus);
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-exact={verdict.exact}>
      <ModelStatusBadge status={modelStatus} />
      <TopologyStatusBadge status={topologyStatus} />
      <span
        title={verdict.title}
        className={cn(
          'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase',
          VERDICT_TONE_CLASS[verdict.tone],
        )}
      >
        {verdict.label}
      </span>
    </div>
  );
}

/** Full status header for a CalculationResult, including contributing models (5.2.2). */
export function CalculationResultStatus({ result, className }: { result: CalculationResult; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ResultStatusSummary modelStatus={result.modelStatus} topologyStatus={result.topologyStatus} />
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {result.contributingModels.map((model) => (
          <li key={model.modelId} className="flex items-center gap-2">
            <span className="font-mono">{model.modelId}</span>
            <ModelStatusBadge status={model.status} />
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">Weakest contributing status wins (spec 5.2.2).</p>
    </div>
  );
}
