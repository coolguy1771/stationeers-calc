import { Camera, History } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectSnapshotRecord } from '@stationeers/persistence';
import { formatRelativeTime } from '../../lib/utils';
import {
  createProjectSnapshot,
  listProjectSnapshots,
  restoreProjectSnapshot,
  type ProjectListItem,
} from '../../state/projectLibrary';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Named snapshots of one project (7.1 "Create project snapshots").
 *
 * A snapshot is a full bundle of the project at a moment in time, taken from
 * the live canonical state for the open project and from the stored bundle
 * otherwise; the persistence layer keeps them per project. Restoring replaces
 * the project's content with the snapshot and saves it — the restore path is
 * described in `restoreProjectSnapshot` (it swaps the canonical store, which is
 * the store's only whole-document replacement).
 */
export interface SnapshotsDialogProps {
  readonly project: ProjectListItem | null;
  readonly onClose: () => void;
}

export function SnapshotsDialog({ project, onClose }: SnapshotsDialogProps) {
  const projectId = project?.id ?? null;
  const [snapshots, setSnapshots] = useState<ProjectSnapshotRecord[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<ProjectSnapshotRecord | null>(null);

  const reload = useCallback(async () => {
    if (projectId === null) return;
    try {
      setSnapshots(await listProjectSnapshots(projectId));
    } catch (error) {
      toast.error('Could not list snapshots', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [projectId]);

  useEffect(() => {
    setSnapshots([]);
    setRestoreTarget(null);
    setName('');
    void reload();
  }, [reload]);

  async function takeSnapshot(): Promise<void> {
    if (projectId === null) return;
    const snapshotName = name.trim();
    if (snapshotName.length === 0) return;
    setBusy(true);
    try {
      await createProjectSnapshot(projectId, snapshotName);
      setName('');
      await reload();
      toast.success('Snapshot created', { description: `“${snapshotName}” of “${project?.name}”.` });
    } catch (error) {
      toast.error('Snapshot failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function restore(snapshot: ProjectSnapshotRecord): Promise<void> {
    if (projectId === null) return;
    setBusy(true);
    try {
      await restoreProjectSnapshot(projectId, snapshot.id);
      setRestoreTarget(null);
      toast.success('Snapshot restored', {
        description: `“${project?.name}” now holds “${snapshot.name}”.`,
      });
    } catch (error) {
      toast.error('Restore failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={project !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Snapshots</DialogTitle>
          <DialogDescription>
            Named copies of {project ? `“${project.name}”` : 'this project'} (spec 7.1). Restoring one
            replaces the project's current content.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void takeSnapshot();
          }}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="snapshot-name">Snapshot name</Label>
            <Input
              id="snapshot-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Before rerouting the pipes"
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy || name.trim().length === 0}>
            <Camera aria-hidden />
            Take snapshot
          </Button>
        </form>

        <div className="max-h-64 overflow-y-auto">
          {snapshots.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No snapshots yet. Take one before a risky change.
            </p>
          ) : (
            <ul aria-label="Project snapshots" className="flex flex-col divide-y divide-border">
              {snapshots.map((snapshot) => (
                <li key={snapshot.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{snapshot.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <History aria-hidden className="size-3" />
                      {formatRelativeTime(snapshot.createdAt)} · schema v{snapshot.schemaVersion}
                    </p>
                    {restoreTarget?.id === snapshot.id ? (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                        Replace the project's current content with this snapshot?
                      </p>
                    ) : null}
                  </div>
                  {restoreTarget?.id === snapshot.id ? (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setRestoreTarget(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void restore(snapshot)}
                      >
                        Restore
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setRestoreTarget(snapshot)}
                    >
                      Restore…
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
