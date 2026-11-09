import { Archive, MoreHorizontal, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectMeta } from '@stationeers/domain';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { formatRelativeTime, shortHash } from '../lib/utils';
import { stubbedAction } from '../lib/stubs';
import { mockProjects } from '../mocks';

/**
 * Projects list (7.1). Mocked until persistence (FND-03) supplies real
 * projects; create/rename/archive/delete are stubbed affordances with TODO
 * toasts naming the owning backlog item.
 */
export function ProjectsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Stationeers Engineer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Offline engineering calculator and dual-editor workbench.{' '}
            <span className="text-muted-foreground/70">
              Project list is mocked until persistence (FND-03) lands.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            New project
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mockProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onRename={() => setRenameTarget(project)}
            onDelete={() => setDeleteTarget(project)}
            onArchive={() => stubbedAction(`Archive “${project.name}” (spec 7.1)`, 'FND-03')}
          />
        ))}
      </div>

      {/* Create */}
      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New project"
        description="A project pins one game-data pack; the pack hash is recorded with the project (spec 7.1)."
        submitLabel="Create"
        onSubmit={(name) => {
          stubbedAction(`Create project “${name}” (spec 7.1)`, 'FND-03');
          setCreateOpen(false);
        }}
      />

      {/* Rename */}
      <ProjectNameDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        title="Rename project"
        description={renameTarget ? `Renaming “${renameTarget.name}”.` : undefined}
        initialValue={renameTarget?.name}
        submitLabel="Rename"
        onSubmit={(name) => {
          stubbedAction(`Rename project to “${name}” (spec 7.1)`, 'FND-03');
          setRenameTarget(null);
        }}
      />

      {/* Delete */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.name}” permanently? Exports are the only backup — there is no server copy (spec 2.1).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                stubbedAction(`Delete “${deleteTarget?.name}” (spec 7.1)`, 'FND-03');
                setDeleteTarget(null);
              }}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectCard({
  project,
  onRename,
  onArchive,
  onDelete,
}: {
  project: ProjectMeta;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="transition-colors hover:border-ring/60">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>
            <Link to={`/project/${project.id}`} className="hover:text-primary">
              {project.name}
            </Link>
          </CardTitle>
          <CardDescription>Updated {formatRelativeTime(project.updatedAt)}</CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${project.name}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil aria-hidden />
              Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              <Archive aria-hidden />
              Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 aria-hidden />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Pin aria-hidden className="size-3" />
          <span>{project.packId}</span>
          <span aria-hidden>·</span>
          <span className="uppercase">{project.channel}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default font-mono">#{shortHash(project.packHash)}</span>
            </TooltipTrigger>
            <TooltipContent>
              Pinned pack {project.packId} · game build {project.gameBuild}
              <br />
              Full hash: <span className="font-mono">{project.packHash}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue = '',
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialValue);
  // Re-seed the field each time the dialog opens (rename targets change).
  useEffect(() => {
    if (open) setName(initialValue);
  }, [open, initialValue]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName(initialValue);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed.length > 0) onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              placeholder="e.g. Atmospherics — starter base"
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={name.trim().length === 0}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
