import { Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import type { SaveStatus } from '../state/persistence';
import { usePersistence } from '../state/persistence';

const SAVE_STATUS_META: Record<SaveStatus, { label: string; icon: typeof Check | null; className: string }> = {
  saved: { label: 'Saved', icon: Check, className: 'text-muted-foreground' },
  dirty: { label: 'Unsaved changes', icon: null, className: 'text-amber-600 dark:text-amber-300' },
  saving: { label: 'Saving…', icon: LoaderCircle, className: 'text-muted-foreground' },
  error: { label: 'Save failed', icon: TriangleAlert, className: 'text-destructive' },
};

const STORAGE_LABEL = {
  unknown: 'persistent storage not requested yet',
  granted: 'persistent storage granted (spec 2.1)',
  denied: 'persistent storage denied — export bundles as backup (spec 2.1)',
} as const;

/**
 * Save-state readout for the workspace top bar (7.1 "show unsaved/error states").
 * Every state is a real persistence outcome from `state/persistence.ts`, which
 * writes the canonical store's debounced snapshots to IndexedDB. The `status`
 * override exists for the /design showcase.
 */
export function SaveStatusIndicator({ status, className }: { status?: SaveStatus; className?: string }) {
  const persistence = usePersistence();
  const effective = status ?? persistence.status;
  const meta = SAVE_STATUS_META[effective];
  const Icon = meta.icon;
  // The indicator belongs to the OPEN project (7.1) and names its last write;
  // before autosave has tracked anything there is no time to show.
  const lastSaved =
    effective === 'saved' && persistence.lastSavedAt !== null
      ? ` · last save ${new Date(persistence.lastSavedAt).toLocaleString()}`
      : '';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', meta.className, className)}
      data-save-status={effective}
      data-persistent-storage={persistence.persistentStorage}
      data-save-project={persistence.projectId ?? ''}
      title={`Local autosave status for this project (spec 7.1)${lastSaved} · ${STORAGE_LABEL[persistence.persistentStorage]}`}
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
