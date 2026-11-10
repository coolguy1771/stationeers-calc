import { ArrowLeft, RefreshCw, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ServiceWorkerUpdatePrompt } from '../components/ServiceWorkerUpdatePrompt';
import { StoragePanel } from '../components/settings/StoragePanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  checkForServiceWorkerUpdate,
  useServiceWorkerUpdate,
} from '../pwa/serviceWorkerClient';
import type { ServiceWorkerUpdateState } from '../pwa/registration';

/**
 * Settings (spec 2.1 "show storage usage and quota in settings", 11 storage
 * durability + offline access; backlog QA-02).
 *
 * Two panels and nothing else: what the browser is keeping for us, and whether
 * the offline shell is installed and current. The page is deliberately plain —
 * it must render from the cached app shell when the network is gone.
 */

const STATE_COPY: Record<
  ServiceWorkerUpdateState,
  { label: string; detail: string }
> = {
  unsupported: {
    label: 'Not active',
    detail:
      'No service worker on this page (dev server, unsupported browser, or a non-secure origin). The app still saves projects locally.',
  },
  idle: { label: 'Not registered', detail: 'The offline worker has not started yet.' },
  registering: { label: 'Registering', detail: 'Installing the offline app shell…' },
  ready: {
    label: 'Installed',
    detail:
      'The app shell is cached: this page opens offline, including the project workspace.',
  },
  'update-available': {
    label: 'Update waiting',
    detail: 'A newer build is installed and waits for a reload.',
  },
  error: {
    label: 'Registration failed',
    detail: 'The offline shell could not be installed. The app still works while online.',
  },
};

export function SettingsPage() {
  const serviceWorker = useServiceWorkerUpdate();
  const copy = STATE_COPY[serviceWorker.state];

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to projects">
          <Link to="/">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Storage durability, install state, and the offline app shell.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <ServiceWorkerUpdatePrompt />

      <StoragePanel devServer={import.meta.env.DEV} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <WifiOff aria-hidden className="size-4 text-muted-foreground" />
            Offline app shell
          </CardTitle>
          <CardDescription>
            The service worker caches the build — HTML, JS, CSS, fonts, icons —
            so the app opens with no network and keeps your local projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">State</span>
            <Badge variant="outline">{copy.label}</Badge>
            <span className="text-muted-foreground" data-testid="sw-detail">
              {copy.detail}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => checkForServiceWorkerUpdate()}
            >
              <RefreshCw aria-hidden />
              Check for updates
            </Button>
          </div>
          {serviceWorker.error === null ? null : (
            <p role="alert" className="text-destructive">
              {serviceWorker.error}
            </p>
          )}
          <p className="text-muted-foreground">
            A new build never reloads the app on its own: a banner offers the
            reload so an edit in progress is not lost.
          </p>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Project data (IndexedDB) and the app shell (Cache Storage) are separate:
        updating the app does not touch your projects, and clearing site data
        removes both.
      </p>
    </div>
  );
}
