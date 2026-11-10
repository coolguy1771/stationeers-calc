import { LocateFixed, Trash2 } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import type { ConnectionIntent, EntityId, PortRef, Project } from '@stationeers/domain';
import { toast } from 'sonner';
import { mediumLabel } from '../../lib/mediums';
import { cn } from '../../lib/utils';
import { instanceById, instanceLabel, portShortLabel } from '../../state/deviceCatalog';
import {
  summarizeIntentStatuses,
  type IntentStatusEntry,
} from '../../state/intentTopology';
import { useSelect, useSelection } from '../../state/selection';
import { IntentStatusChip } from '../status/IntentStatusChip';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

/**
 * Every connection intent with its DERIVED topology status (3.5, 9.1). The
 * status chip is the vocabulary component; the derivation lives in
 * `state/intentTopology.ts`. Jumping fits the canvas on the intent's endpoints.
 */
export function IntentsPanel({
  project,
  statuses,
  onDelete,
}: {
  project: Project;
  statuses: ReadonlyMap<EntityId, IntentStatusEntry>;
  onDelete: (intentId: EntityId) => void;
}) {
  const selection = useSelection();
  const select = useSelect();
  const { fitView } = useReactFlow();
  const summary = summarizeIntentStatuses(statuses);

  function jumpTo(intent: ConnectionIntent): void {
    const nodeIds = [intent.from.instanceId, intent.to.instanceId].filter((instanceId) =>
      project.devices.some((device) => device.id === instanceId),
    );
    if (nodeIds.length === 0) {
      toast.error('Intent endpoints missing', {
        description: 'Neither endpoint device exists any more; the intent is retained (SYNC-008).',
      });
      return;
    }
    void fitView({ nodes: nodeIds.map((id) => ({ id })), duration: 300, padding: 1.5, maxZoom: 1.2 });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">
          Connection intents
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {project.intents.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No connection intents in the project. Intents are optional (SYNC-014).
          </p>
        ) : null}
        {project.intents.map((intent) => {
          const entry = statuses.get(intent.id);
          const status = entry?.status ?? 'unrouted';
          const name = intent.label ?? intent.id;
          const selected = selection?.kind === 'intent' && selection.id === intent.id;
          return (
            <div
              key={intent.id}
              className={cn(
                'rounded-md border p-2.5',
                selected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-pressed={selected}
                  title={`Select intent ${intent.id}`}
                  className="min-w-0 truncate text-left text-xs font-medium hover:underline"
                  onClick={() => select({ kind: 'intent', id: intent.id })}
                >
                  {name}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <IntentStatusChip status={status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground"
                    aria-label={`Jump to intent ${name}`}
                    onClick={() => jumpTo(intent)}
                  >
                    <LocateFixed aria-hidden className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete intent ${name}`}
                    onClick={() => onDelete(intent.id)}
                  >
                    <Trash2 aria-hidden className="size-3" />
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                {endpointLabel(project, intent.from)}
                <br />→ {endpointLabel(project, intent.to)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">{entry?.detail}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                medium <span className="font-mono uppercase">{mediumLabel(intent.medium)}</span> · status is
                derived, never stored (spec 9.1)
              </p>
            </div>
          );
        })}
        {project.intents.length === 0 ? null : (
          <p className="text-[11px] text-muted-foreground">
            {summary.total} intent(s) · {summary.counts.unrouted} unrouted · {summary.counts.routed} routed ·{' '}
            {summary.counts.conflicting} conflicting
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function endpointLabel(project: Project, ref: PortRef): string {
  const instance = instanceById(project, ref.instanceId);
  if (instance === undefined) return `${ref.instanceId} (missing)`;
  const port = instance.ports.find((candidate) => candidate.id === ref.portId);
  if (port === undefined) return `${instanceLabel(instance)} · ${ref.portId} (missing)`;
  return `${instanceLabel(instance)} · ${portShortLabel(port.definitionId, ref.portId)}`;
}
