import { RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import {
  applyServiceWorkerUpdate,
  useServiceWorkerUpdate,
} from '../pwa/serviceWorkerClient';
import { Button } from './ui/button';

/**
 * Update prompt (spec 11 offline behaviour; backlog QA-02).
 *
 * A new build never swaps itself in: the worker installs and waits, this banner
 * says so, and the reload happens when the user asks for it — an engineer
 * mid-edit must not lose the canvas to a background deployment. Dismissing the
 * banner hides it for this session only: the waiting build stays installed, and
 * the next page load offers the reload again.
 */
export function ServiceWorkerUpdatePrompt() {
  const { state } = useServiceWorkerUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (state !== 'update-available' || dismissed) return null;

  return (
    <div
      role="status"
      data-service-worker-update="available"
      className="flex flex-wrap items-center gap-2 border-b border-primary/40 bg-primary/10 px-3 py-1.5 text-xs"
    >
      <p className="min-w-0 flex-1">
        A new version of Stationeers Engineer is available. Reload to use it —
        saved projects stay in this browser.
      </p>
      <Button size="sm" onClick={() => applyServiceWorkerUpdate()}>
        <RefreshCw aria-hidden />
        Reload
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Dismiss update notice"
        onClick={() => setDismissed(true)}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
