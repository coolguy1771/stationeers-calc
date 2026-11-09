import { BrickWall, Cable, Eraser, MousePointer2, Plus, RotateCw, Spline } from 'lucide-react';
import { DeviceInstanceList } from '../../components/DeviceInstanceList';
import { Placeholder } from '../../components/Placeholder';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import { stubbedAction } from '../../lib/stubs';
import { placedInstanceCount } from '../../mocks';
import { useProject } from '../../state/projectStore';

const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2, owner: 'UI-03' },
  { id: 'place', label: 'Place device', icon: Plus, owner: 'UI-03' },
  { id: 'pipe', label: 'Route pipe', icon: Spline, owner: 'UI-04' },
  { id: 'cable', label: 'Route cable', icon: Cable, owner: 'UI-04' },
  { id: 'seal', label: 'Wall / floor', icon: BrickWall, owner: 'UI-04' },
  { id: 'rotate', label: 'Rotate', icon: RotateCw, owner: 'UI-03' },
  { id: 'delete', label: 'Unplace / delete', icon: Eraser, owner: 'UI-05' },
] as const;

/**
 * Physical layout tab (spec 3.2). PixiJS canvas is a mount point only; the
 * tool palette and level selector are skeletons. Physical layout is
 * authoritative for buildable connectivity (3.5) — routing updates resolved
 * networks and intent status (SYNC-005/006). Instances and placements come
 * from the canonical store (spec 2.2.1).
 */
export function PhysicalPage() {
  const project = useProject();
  const placed = placedInstanceCount(project.devices);
  const unplaced = project.devices.length - placed;

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="flex w-52 shrink-0 flex-col gap-3">
        <section aria-label="Tool palette" className="flex flex-col gap-1 rounded-md border border-border bg-card p-2">
          <h3 className="px-1 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Tools
          </h3>
          {TOOLS.map((tool) => (
            <Button
              key={tool.id}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => stubbedAction(`tool “${tool.label}”`, tool.owner)}
            >
              <tool.icon aria-hidden />
              {tool.label}
            </Button>
          ))}
          <p className="px-1 pt-1 text-[10px] text-muted-foreground/70">
            Tool mode is transient UI state (spec 2.1); actual placement lands with UI-03/UI-04.
          </p>
        </section>

        <section aria-label="Placement summary" className="rounded-md border border-border bg-card p-2.5">
          <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Placement</h3>
          <p className="mt-1.5 font-mono text-xs tabular">
            {placed} placed · {unplaced} unplaced
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Unplaced instances stay in the schematic (SYNC-001); placing does not duplicate (SYNC-002).
          </p>
        </section>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Level</h3>
          <div className="flex items-center gap-1" role="group" aria-label="Building level">
            {[0, 1, 2].map((level) => (
              <Button
                key={level}
                variant={level === 0 ? 'secondary' : 'ghost'}
                size="sm"
                className={cn('font-mono', level !== 0 && 'text-muted-foreground')}
                onClick={() => stubbedAction(`switch to level ${level}`, 'UI-03')}
              >
                {level}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => stubbedAction('add building level', 'UI-03')}
            >
              + add
            </Button>
          </div>
          <Separator orientation="vertical" className="h-5" />
          <p className="text-[11px] text-muted-foreground">
            Grid sizes come from the pinned pack, never hard-coded (spec 4.2).
          </p>
        </div>

        <Placeholder
          className="min-h-64"
          title="Construction grid — PixiJS 2D top-down mounts here"
          seam="UI-03 · multi-level 2D dual-grid placement and orientation (spec 3.2); routing and collision checks follow in UI-04. Physical layout is authoritative for buildable connectivity (spec 3.5)."
          plannedFeatures={[
            'Dual-grid coordinates (large / small), extracted per build',
            'X, Y, Z positioning on the game grid',
            'Floor/level selection and navigation',
            'Equipment footprints and clearance/occupancy',
            'Rotation and mounting orientation',
            'Pipe and cable routing with junctions and bends',
            'Sealing structures (walls, floors, frames) → rooms derived (4.6)',
            'Multi-floor connections',
            'Layer visibility and filtering',
            'Collision and connector-alignment validation',
          ]}
        />
      </div>

      <aside className="hidden w-72 shrink-0 flex-col gap-3 xl:flex">
        <section aria-label="Devices on this level" className="rounded-md border border-border bg-card p-2.5">
          <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Devices</h3>
          <div className="mt-1.5">
            <DeviceInstanceList instances={project.devices} />
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            {project.intents.length} intent awaiting a route (SYNC-007) · the same selection as the
            schematic (SYNC-004).
          </p>
        </section>
      </aside>
    </div>
  );
}
