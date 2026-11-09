import { Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import type { SaveStatus } from '../state/uiStore';
import { useUiStore } from '../state/uiStore';

const SAVE_STATUS_META: Record<SaveStatus, { label: string; icon: typeof Check | null; className: string }> = {
  saved: { label: 'Saved', icon: Check, className: 'text-muted-foreground' },
  dirty: { label: 'Unsaved changes', icon: null, className: 'text-amber-600 dark:text-amber-300' },
  saving: { label: 'Saving…', icon: LoaderCircle, className: 'text-muted-foreground' },
  error: { label: 'Save failed', icon: TriangleAlert, className: 'text-destructive' },
};

/**
 * Save-state readout for the workspace top bar (7.1 "show unsaved/error states").
 * Consumes the placeholder state machine in the UI store until real persistence
 * (FND-03/FND-04) drives it. `status` override exists for the /design showcase.
 */
export function SaveStatusIndicator({ status, className }: { status?: SaveStatus; className?: string }) {
  const storeStatus = useUiStore((state) => state.saveStatus);
  const effective = status ?? storeStatus;
  const meta = SAVE_STATUS_META[effective];
  const Icon = meta.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', meta.className, className)}
      data-save-status={effective}
      title="Local autosave status (placeholder machine until FND-03 persistence wires it)"
    >
      {Icon ? (
        <Icon aria-hidden className={cn('size-3.5', effective === 'saving' && 'animate-spin')} />
      ) : (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      <span>{meta.label}</span>
    </span>
  );
}
