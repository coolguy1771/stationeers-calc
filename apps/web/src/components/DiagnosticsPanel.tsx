import { cn } from '../lib/utils';
import { SeverityBadge } from './status/SeverityBadge';

/**
 * Diagnostics readout (spec 8): stable code, severity, affected entities, rule,
 * and suggested resolution. Reused by the schematic and analysis tabs until a
 * dedicated diagnostics workspace lands.
 */
export function DiagnosticsPanel({
  diagnostics,
  className,
}: {
  diagnostics: {
    code: string;
    severity: 'error' | 'warning' | 'info';
    entityIds: readonly string[];
    message: string;
    rule: string;
    suggestion?: string;
  }[];
  className?: string;
}) {
  return (
    <section className={cn('flex min-h-0 flex-col gap-2', className)} aria-label="Diagnostics">
      <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Diagnostics</h3>
      {diagnostics.length === 0 ? (
        <p className="text-xs text-muted-foreground">No diagnostics.</p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {diagnostics.map((diagnostic) => (
            <li key={diagnostic.code} className="rounded-md border border-border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={diagnostic.severity} />
                <span className="font-mono text-xs text-foreground/90">{diagnostic.code}</span>
              </div>
              <p className="mt-1.5 text-xs text-foreground/90">{diagnostic.message}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                rule: {diagnostic.rule}
                {diagnostic.entityIds.length > 0 ? ` · entities: ${diagnostic.entityIds.join(', ')}` : ''}
              </p>
              {diagnostic.suggestion ? (
                <p className="mt-1 text-xs text-muted-foreground">Suggestion: {diagnostic.suggestion}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
