import { Download, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { shortHash } from '../../lib/utils';
import { APP_VERSION, isStandaloneDisplay } from '../../pwa/appInfo';
import { markProjectExported } from '../../state/exportPrompt';
import { exportCurrentProject } from '../../state/exportProject';
import {
  defaultStorageManager,
  formatBytes,
  readStorageDurability,
  requestStorageDurability,
  STORAGE_CRITICAL_RATIO,
  STORAGE_HIGH_RATIO,
  type StorageDurabilitySnapshot,
  type StorageManagerLike,
} from '../../state/storageDurability';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';

/**
 * Storage durability panel (spec 2.1 "show storage usage and quota in
 * settings", 11 "storage durability", 13 user help; backlog QA-02).
 *
 * It reports four facts and offers the two actions that actually protect the
 * data: request persistent storage, and export a portable bundle. Where the
 * Storage API is missing (older Safari, jsdom, some private modes) every row
 * says so explicitly instead of showing a comforting zero — an unavailable
 * API is not the same as zero bytes used.
 */

const PERSISTENCE_LABEL: Record<
  StorageDurabilitySnapshot['persistence'],
  { label: string; tone: string }
> = {
  granted: { label: 'Granted', tone: 'border-emerald-600/50 text-emerald-300' },
  denied: {
    label: 'Not granted — may be evicted',
    tone: 'border-amber-500/50 text-amber-300',
  },
  unsupported: { label: 'Not requested yet', tone: 'text-muted-foreground' },
  unknown: { label: 'Unknown', tone: 'text-muted-foreground' },
};

export interface StoragePanelProps {
  /** Injected storage API; defaults to `navigator.storage` (tests pass a fake). */
  readonly api?: StorageManagerLike | undefined;
  /** Injected install state; defaults to the display-mode probe. */
  readonly installed?: boolean;
  /** True when running under the Vite dev server (no offline worker). */
  readonly devServer?: boolean;
}

const initialSnapshot: StorageDurabilitySnapshot = {
  persistence: 'unknown',
  usage: null,
  quota: null,
  level: 'unknown',
  supported: false,
  error: null,
};

export function StoragePanel({ api, installed, devServer }: StoragePanelProps) {
  const storage = api ?? defaultStorageManager();
  const isInstalled = installed ?? isStandaloneDisplay();
  const [snapshot, setSnapshot] =
    useState<StorageDurabilitySnapshot>(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    setSnapshot(await readStorageDurability(storage));
  }, [storage]);

  useEffect(() => {
    let cancelled = false;
    void readStorageDurability(storage).then((next) => {
      if (!cancelled) setSnapshot(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  async function requestPersistence(): Promise<void> {
    setBusy(true);
    try {
      const next = await requestStorageDurability(storage);
      setSnapshot(next);
      if (next.persistence === 'granted') {
        toast.success('Persistent storage granted');
      } else if (next.persistence === 'unsupported') {
        toast.info('This browser has no persistent-storage API', {
          description: 'Install the app and export bundles as your backup.',
        });
      } else {
        toast.warning('Persistent storage not granted', {
          description:
            'The browser may evict local projects. Install the app and export a bundle.',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle(): Promise<void> {
    setExporting(true);
    try {
      const file = await exportCurrentProject();
      markProjectExported(file.projectId);
      toast.success('Project bundle exported', {
        description: `${file.filename} · sha256 ${shortHash(file.contentHash, 12)}…`,
      });
    } catch (error) {
      toast.error('Export failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  const persistence = PERSISTENCE_LABEL[snapshot.persistence];
  const ratio =
    snapshot.usage !== null && snapshot.quota !== null && snapshot.quota > 0
      ? Math.min(1, snapshot.usage / snapshot.quota)
      : null;
  const percentage =
    ratio === null ? null : `${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 1)}%`;

  return (
    <Card
      data-testid="storage-panel"
      data-storage-persistence={snapshot.persistence}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive aria-hidden className="size-4 text-muted-foreground" />
          Local storage
        </CardTitle>
        <CardDescription>
          Projects live in this browser&apos;s IndexedDB and nowhere else — there
          is no account and no server copy (spec 2.1).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Persistent storage</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={persistence.tone}>
              {persistence.label}
            </Badge>
            {!snapshot.supported ? (
              <span className="text-muted-foreground">
                This browser exposes no Storage API.
              </span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || snapshot.persistence === 'granted'}
              onClick={() => void requestPersistence()}
            >
              <ShieldCheck aria-hidden />
              {busy ? 'Requesting…' : 'Request persistence'}
            </Button>
          </dd>

          <dt className="text-muted-foreground">Usage</dt>
          <dd className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono" data-testid="storage-usage">
                {formatBytes(snapshot.usage)} of {formatBytes(snapshot.quota)}
              </span>
              {percentage === null ? null : (
                <span className="text-muted-foreground">{percentage} used</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden />
                Re-measure
              </Button>
            </div>
            {ratio === null ? null : (
              <div
                role="progressbar"
                aria-label="Storage used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
                className="h-1.5 w-full overflow-hidden rounded-sm bg-secondary"
              >
                <div
                  className={
                    snapshot.level === 'critical'
                      ? 'h-full bg-destructive'
                      : snapshot.level === 'high'
                        ? 'h-full bg-amber-500'
                        : 'h-full bg-primary'
                  }
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            )}
            {snapshot.level === 'high' || snapshot.level === 'critical' ? (
              <p role="alert" className="text-amber-300">
                {Math.round((ratio ?? 0) * 100)}% of the quota is in use
                {snapshot.level === 'critical'
                  ? ' — the browser may start refusing writes. Export a bundle now.'
                  : ` — export a bundle before usage crosses ${Math.round(
                      STORAGE_CRITICAL_RATIO * 100,
                    )}%.`}
              </p>
            ) : null}
            {snapshot.error === null ? null : (
              <p className="text-muted-foreground">
                Measurement failed: {snapshot.error}
              </p>
            )}
          </dd>

          <dt className="text-muted-foreground">App</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="font-mono">v{APP_VERSION}</span>
            <Badge variant="outline">
              {isInstalled ? 'Installed (standalone)' : 'Browser tab'}
            </Badge>
            {devServer === true ? (
              <span className="text-muted-foreground">
                Dev server: the offline worker is not registered.
              </span>
            ) : null}
          </dd>
        </dl>

        <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-relaxed">
          <p>
            <span className="font-medium">Safari may evict this data.</span> A
            site that has not been visited for a while can lose its
            script-written storage unless the app is installed or persistent
            storage is granted. Chrome and Firefox can also evict an origin when
            the disk fills. Installed copies are exempt from Safari&apos;s
            seven-day eviction, so install the app and keep a recent export for
            anything you would hate to lose.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void exportBundle()}
            disabled={exporting}
          >
            <Download aria-hidden />
            {exporting ? 'Exporting…' : 'Export open project'}
          </Button>
          <span className="text-muted-foreground">
            Shareable backup with a SHA-256 content hash (spec 9.4). Export the
            project you are working on from its workspace toolbar.
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Warning thresholds: {Math.round(STORAGE_HIGH_RATIO * 100)}% warns,{' '}
          {Math.round(STORAGE_CRITICAL_RATIO * 100)}% asks for an export.
        </p>
      </CardContent>
    </Card>
  );
}
