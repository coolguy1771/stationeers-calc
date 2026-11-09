import { ListChecks } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Structured mount-point placeholder for a future editor canvas (UI-02/UI-03).
 * States the seam and the owning backlog item, then lists the planned features
 * from the spec section it implements — never a blank area.
 */
export function Placeholder({
  title,
  seam,
  plannedFeatures,
  footer,
  className,
}: {
  title: string;
  /** What mounts here later, and which backlog item mounts it. */
  seam: string;
  plannedFeatures: readonly string[];
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-background/40 p-8 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="max-w-xl font-mono text-xs text-muted-foreground/80">{seam}</p>
      <ul className="mt-2 grid max-w-xl list-none gap-1 text-left text-xs text-muted-foreground/80 sm:grid-cols-2">
        {plannedFeatures.map((feature) => (
          <li key={feature} className="flex items-start gap-1.5">
            <ListChecks aria-hidden className="mt-0.5 size-3 shrink-0 text-primary/70" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
