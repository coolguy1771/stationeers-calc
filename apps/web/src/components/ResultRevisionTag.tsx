import { TriangleAlert } from 'lucide-react';
import type { TaggedResult } from '../state/analysis';

/**
 * Revision tag of a displayed result (spec 5.6, 2.2.1). While the project is on
 * the revision the result describes it reads as a quiet tag; once the store
 * moves past it, it becomes an explicit stale notice — the numbers below are
 * from an older state and must never read as current.
 */
export function ResultRevisionTag({ tagged }: { tagged: TaggedResult }) {
  if (!tagged.stale) {
    return (
      <span
        className="font-mono text-[10px] text-muted-foreground"
        data-result-revision={tagged.computedAtRevisionId}
        title="Canonical revision this result was computed on (spec 5.6)"
      >
        computed at rev {tagged.computedAtRevisionId}
      </span>
    );
  }
  return (
    <div
      role="status"
      data-stale-result="true"
      data-result-revision={tagged.computedAtRevisionId}
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <p className="font-medium">Stale — project changed since this result</p>
        <p className="mt-0.5 text-amber-700/80 dark:text-amber-300/80">
          Computed at revision {tagged.computedAtRevisionId}; the project is now at revision{' '}
          {tagged.currentRevisionId}. These values describe the earlier state — re-run analysis
          (SIM-02) to refresh them (spec 5.6).
        </p>
      </div>
    </div>
  );
}
