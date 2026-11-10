import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DeviceInstance, Project, SettingValue } from '@stationeers/domain';
import { mediumLabel } from '../../lib/mediums';
import { cn } from '../../lib/utils';
import { definitionById, instanceLabel, portDefinition, portShortLabel } from '../../state/deviceCatalog';
import { runProjectCommand } from '../../state/projectStore';
import { useSelection } from '../../state/selection';
import { DataQualityBadge } from '../status/DataQualityBadge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * Selected-node inspector (spec 3.1 "device settings", 7.3).
 *
 * Reads the one shared selection (SYNC-004), so the panel follows clicks in the
 * canvas. Settings edits are commands; the value is committed on blur/Enter so
 * typing is one undo step, not one per keystroke.
 */
export function InstanceSettingsPanel({
  project,
  onRequestDelete,
}: {
  project: Project;
  onRequestDelete: (deviceId: string) => void;
}) {
  const selection = useSelection();
  const instance =
    selection?.kind === 'device-instance'
      ? project.devices.find((candidate) => candidate.id === selection.id)
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs tracking-wider text-muted-foreground uppercase">
          Selected instance
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {instance === undefined ? (
          <p className="text-[11px] text-muted-foreground">
            Select a device node or an instance chip to inspect its definition, ports, and settings.
            Selection is shared with the physical layout and catalog (SYNC-004).
          </p>
        ) : (
          <InstanceDetails project={project} instance={instance} onRequestDelete={onRequestDelete} />
        )}
      </CardContent>
    </Card>
  );
}

function InstanceDetails({
  project,
  instance,
  onRequestDelete,
}: {
  project: Project;
  instance: DeviceInstance;
  onRequestDelete: (deviceId: string) => void;
}) {
  const definition = definitionById(instance.definitionId);
  const placement = project.placements.find((candidate) => candidate.id === instance.placementId);
  const settingKeys = Object.keys(instance.settings);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{instanceLabel(instance)}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{instance.id}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1 py-0.5 font-mono text-[9px] uppercase',
            instance.placementId === undefined
              ? 'border-dashed border-amber-600/60 text-amber-700 dark:text-amber-300'
              : 'border-border text-muted-foreground',
          )}
        >
          {instance.placementId === undefined ? 'unplaced' : 'placed'}
        </span>
      </div>

      <dl className="flex flex-col gap-1">
        <InspectorRow label="Definition" value={definition?.displayName ?? `${instance.definitionId} (missing)`} mono={definition === undefined} />
        <InspectorRow label="Definition id" value={instance.definitionId} mono />
        <InspectorRow
          label="Orientation"
          value={
            placement === undefined
              ? `not placed — editable with UI-03 · definition allows ${orientationSummary(definition?.allowedOrientations)}`
              : `${placement.orientation.surface} · yaw ${placement.orientation.yaw}`
          }
        />
      </dl>

      <section aria-label="Ports" className="flex flex-col gap-1">
        <h4 className="text-[10px] tracking-wider text-muted-foreground uppercase">Ports</h4>
        {instance.ports.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">This instance declares no ports.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {instance.ports.map((port) => {
              const definitionPort = portDefinition(project, { instanceId: instance.id, portId: port.id });
              const label = portShortLabel(port.definitionId, port.id);
              return (
                <li key={port.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate font-mono" title={port.id}>
                    {label}
                    <span className="text-muted-foreground">
                      {' '}
                      · {definitionPort === undefined ? 'missing pack port' : mediumLabel(definitionPort.medium)}
                    </span>
                  </span>
                  {definitionPort === undefined ? null : (
                    <DataQualityBadge quality={definitionPort.sourceQuality} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Device settings" className="flex flex-col gap-1">
        <h4 className="text-[10px] tracking-wider text-muted-foreground uppercase">Settings</h4>
        {settingKeys.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No stored settings. Definition-declared setting schemas arrive with packs (EXT-03); until then
            only keys the instance already carries are editable.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {settingKeys.map((key) => (
              <SettingRow
                key={`${instance.id}:${key}`}
                deviceId={instance.id}
                settingKey={key}
                value={instance.settings[key]!}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <p className="text-[10px] text-muted-foreground/70">
          Delete removes the instance and its placement everywhere (SYNC-012).
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Delete instance ${instanceLabel(instance)}`}
          className="text-muted-foreground hover:border-destructive/50 hover:text-destructive"
          onClick={() => onRequestDelete(instance.id)}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
      </div>
    </div>
  );
}

function InspectorRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-1 last:border-0 last:pb-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn('max-w-[70%] text-right text-[11px]', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function orientationSummary(orientations: { surface: string }[] | undefined): string {
  if (orientations === undefined || orientations.length === 0) return 'no orientations declared';
  const counts = new Map<string, number>();
  for (const orientation of orientations) {
    counts.set(orientation.surface, (counts.get(orientation.surface) ?? 0) + 1);
  }
  return [...counts].map(([surface, count]) => `${surface} ×${count}`).join(', ');
}

type ParsedSetting =
  | { readonly ok: true; readonly value: SettingValue }
  | { readonly ok: false; readonly reason: string };

function parseSettingDraft(draft: string, current: SettingValue): ParsedSetting {
  if (typeof current === 'number') {
    const parsed = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      return { ok: false, reason: 'Expected a finite number.' };
    }
    return { ok: true, value: parsed };
  }
  return { ok: true, value: draft };
}

/**
 * One editable setting. Committed on blur/Enter through `setDeviceSetting`; a
 * rejected draft keeps the stored value visible and reports the reason instead
 * of pretending it saved (SYNC-009).
 */
function SettingRow({
  deviceId,
  settingKey,
  value,
}: {
  deviceId: string;
  settingKey: string;
  value: SettingValue;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);

  function commit(): void {
    if (draft === String(value)) return;
    const parsed = parseSettingDraft(draft, value);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    const result = runProjectCommand({
      type: 'setDeviceSetting',
      deviceId,
      key: settingKey,
      value: parsed.value,
    });
    if (!result.ok) {
      setError(result.error.message);
      setDraft(String(value));
      return;
    }
    setError(null);
  }

  function remove(): void {
    const result = runProjectCommand({ type: 'removeDeviceSetting', deviceId, key: settingKey });
    if (!result.ok) setError(result.error.message);
  }

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={settingKey}>
          {settingKey}
        </span>
        {typeof value === 'boolean' ? (
          <input
            type="checkbox"
            checked={value}
            aria-label={`Setting ${settingKey}`}
            onChange={(event) =>
              runProjectCommand({
                type: 'setDeviceSetting',
                deviceId,
                key: settingKey,
                value: event.target.checked,
              })
            }
          />
        ) : (
          <Input
            value={draft}
            aria-label={`Setting ${settingKey}`}
            className="h-6 w-24 font-mono text-[11px]"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(String(value));
                setError(null);
              }
            }}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-destructive"
          aria-label={`Remove setting ${settingKey}`}
          onClick={remove}
        >
          <Trash2 aria-hidden className="size-3" />
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-[10px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}
