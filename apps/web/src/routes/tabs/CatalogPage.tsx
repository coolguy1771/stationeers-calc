import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DataQuality, DeviceDefinition, DeviceInstance } from '@stationeers/domain';
import { DeviceInstanceChip } from '../../components/DeviceInstanceChip';
import { DataQualityBadge } from '../../components/status/DataQualityBadge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { stubbedAction } from '../../lib/stubs';
import { mockCatalog, type PropertyRow } from '../../mocks';
import { useProject } from '../../state/projectStore';

const MEDIUM_LABEL: Record<string, string> = {
  'gas-pipe': 'gas',
  'liquid-pipe': 'liquid',
  electrical: 'power',
  data: 'data',
  chute: 'chute',
  room: 'room',
  thermal: 'thermal',
};

/**
 * Component catalog (spec 7.2): search/filter layout over device definitions.
 * Every displayed property row carries its 6.5 data-quality badge (13 #3:
 * provenance and quality on every displayed property). Definitions stay mock
 * until packs (EXT-03) are loaded at runtime (6.7); the instances listed per
 * definition are the canonical project's, and selecting one sets the shared
 * selection (SYNC-004).
 */
export function CatalogPage() {
  const project = useProject();
  const [query, setQuery] = useState('');
  const categories = useMemo(
    () => [...new Set(mockCatalog.map((entry) => entry.definition.category))].sort(),
    [],
  );
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const visible = mockCatalog.filter(({ definition }) => {
    if (activeCategory && definition.category !== activeCategory) return false;
    const q = query.trim().toLowerCase();
    if (q.length === 0) return true;
    return (
      definition.displayName.toLowerCase().includes(q) ||
      definition.id.toLowerCase().includes(q) ||
      definition.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search aria-hidden className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, identifier, function…"
            className="pl-7"
            aria-label="Search catalog"
          />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Filter by category">
          <Button
            size="sm"
            variant={activeCategory === null ? 'secondary' : 'ghost'}
            onClick={() => setActiveCategory(null)}
          >
            All
          </Button>
          {categories.map((category) => (
            <Button
              key={category}
              size="sm"
              variant={activeCategory === category ? 'secondary' : 'ghost'}
              className={cn(activeCategory !== category && 'text-muted-foreground')}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {visible.length} of {mockCatalog.length} definitions · per-property data quality shown (spec 13 #3)
        </p>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pb-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ definition, propertyRows }) => (
          <DefinitionCard
            key={definition.id}
            definition={definition}
            propertyRows={propertyRows}
            instances={project.devices.filter(
              (instance) => instance.definitionId === definition.id,
            )}
          />
        ))}
        {visible.length === 0 ? (
          <p className="col-span-full rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No definitions match. Missing data is reported as missing — never fabricated (spec 4.7).
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DefinitionCard({
  definition,
  propertyRows,
  instances,
}: {
  definition: DeviceDefinition;
  propertyRows: PropertyRow[];
  instances: readonly DeviceInstance[];
}) {
  return (
    <Card>
      <CardHeader className="gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{definition.displayName}</h3>
          <DataQualityBadge quality={definition.sourceQuality} />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {definition.id} · {definition.category} · {definition.grid} grid
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1">
          {propertyRows.map((row) => (
            <PropertyRowView key={row.label} row={row} />
          ))}
        </dl>

        <div>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase">Ports</h4>
          <ul className="mt-1 flex flex-col gap-1">
            {definition.ports.map((portDef) => (
              <li key={portDef.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono">
                  {portDef.id.replace('mock.port.', '')}{' '}
                  <span className="text-muted-foreground">
                    ({MEDIUM_LABEL[portDef.medium] ?? portDef.medium}
                    {portDef.mediation === 'passive' ? ', passive' : ''})
                  </span>
                </span>
                <DataQualityBadge quality={portDef.sourceQuality} />
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="mt-auto items-center justify-between gap-2">
        {instances.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">none in project</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-muted-foreground">in project:</span>
            {instances.map((instance) => (
              <DeviceInstanceChip
                key={instance.id}
                instanceId={instance.id}
                // The card is already titled with the definition name; the chip
                // names the instance so duplicates stay distinguishable.
                label={instance.id.replace('mock.inst.', '')}
              />
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => stubbedAction(`Add “${definition.displayName}” instance to project (SYNC-001)`, 'FND-04')}
        >
          <Plus aria-hidden />
          Add to project
        </Button>
      </CardFooter>
    </Card>
  );
}

function PropertyRowView({ row }: { row: { label: string; value: string; quality: DataQuality; note?: string } }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-1 last:border-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
        <dd className="font-mono text-xs">{row.value}</dd>
        {row.note ? <p className="mt-0.5 text-[10px] text-muted-foreground/70">{row.note}</p> : null}
      </div>
      <DataQualityBadge quality={row.quality} className="mt-0.5" />
    </div>
  );
}
