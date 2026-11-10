import {
  Archive,
  ArchiveRestore,
  Camera,
  Copy,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ThemeToggle } from '../components/ThemeToggle';
import { SaveStatusIndicator } from '../components/SaveStatusIndicator';
import { ImportProjectButton } from '../components/projects/ImportProjectButton';
import { ProjectNameDialog } from '../components/projects/ProjectNameDialog';
import { SnapshotsDialog } from '../components/projects/SnapshotsDialog';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { formatRelativeTime, shortHash } from '../lib/utils';
import {
  createProject,
  deleteProject,
  duplicateProject,
  ensureProjectLibrary,
  renameProject,
  setProjectArchived,
  setShowArchived,
  UNPINNED_PACK_ID,
  useProjectLibrary,
  type ProjectListItem,
} from '../state/projectLibrary';
import { usePersistence, startPersistence } from '../state/persistence';

/**
 * Projects list (7.1). Rows are the projects in this browser's IndexedDB —
 * created, renamed, duplicated, archived and deleted from here, opened by
 * clicking a card (the workspace loads the project into the canonical store).
 *
 * The page is the honest empty state too: with no stored project it offers
 * create + import instead of pretending a demo project exists.
 */
export function ProjectsPage() {
  const library = useProjectLibrary();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [snapshotsTarget, setSnapshotsTarget] = useState<ProjectListItem | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    // Autosave covers the whole session: the open project keeps saving even while
    // the user is on the projects page (renaming it from a card is an edit of the
    // open project, 2.2.1/7.1).
    startPersistence();
    void ensureProjectLibrary();
  }, []);

  const visible = library.projects.filter((item) => library.showArchived || !item.archived);
  const archivedCount = library.projects.filter((item) => item.archived).length;

  async function report(action: () => Promise<void>, failure: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      toast.error(failure, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Stationeers Engineer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Offline engineering calculator and dual-editor workbench. Projects are saved in this
            browser (IndexedDB) and exportable as versioned bundles (spec 2.1, 7.1).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportProjectButton onImported={(project) => navigate(`/project/${project.id}`)} onError={setImportError} />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            New project
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" aria-label="Settings">
                <Link to="/settings">
                  <Settings aria-hidden />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Storage durability, install state, and the offline shell (spec 2.1, 11)
            </TooltipContent>
          </Tooltip>
          <ThemeToggle />
        </div>
      </header>

      {importError !== null ? (
        <div role="alert" className="rounded-sm border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-medium">Import rejected</p>
          <p className="text-muted-foreground">{importError}</p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1"
            onClick={() => setImportError(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {library.projects.length} project{library.projects.length === 1 ? '' : 's'} stored ·{' '}
          {archivedCount} archived
        </p>
        <Button
          size="sm"
          variant={library.showArchived ? 'secondary' : 'outline'}
          aria-pressed={library.showArchived}
          onClick={() => setShowArchived(!library.showArchived)}
        >
          <Archive aria-hidden />
          {library.showArchived ? 'Hide archived' : 'Show archived'}
        </Button>
      </div>

      {library.status === 'loading' || library.status === 'idle' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      ) : null}

      {library.status === 'error' ? (
        <div role="alert" className="rounded-sm border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-medium">The project database could not be read</p>
          <p className="text-muted-foreground">{library.error}</p>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => void ensureProjectLibrary()}>
            Retry
          </Button>
        </div>
      ) : null}

      {library.status === 'ready' && visible.length === 0 ? (
        <EmptyState
          allArchived={library.projects.length > 0}
          onCreate={() => setCreateOpen(true)}
          onShowArchived={() => setShowArchived(true)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onOpen={() => navigate(`/project/${project.id}`)}
            onRename={() => setRenameTarget(project)}
            onDuplicate={() => void report(async () => {
              const copy = await duplicateProject(project.id);
              toast.success(`Duplicated as “${copy.name}”`);
            }, 'Duplicate failed')}
            onSnapshots={() => setSnapshotsTarget(project)}
            onArchive={() => void report(async () => {
              await setProjectArchived(project.id, !project.archived);
              toast.success(project.archived ? `Unarchived “${project.name}”` : `Archived “${project.name}”`);
            }, 'Archive failed')}
            onDelete={() => setDeleteTarget(project)}
          />
        ))}
      </div>

      {/* Create */}
      <ProjectNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New project"
        description="A new project pins the game-data pack of the open project (spec 7.1) and starts empty."
        submitLabel="Create"
        onSubmit={(name) => {
          void report(async () => {
            const project = await createProject(name);
            toast.success(`Created “${project.name}”`);
            navigate(`/project/${project.id}`);
          }, 'Create failed');
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
          const target = renameTarget;
          if (target === null) return;
          void report(async () => {
            await renameProject(target.id, name);
            toast.success(`Renamed to “${name}”`);
          }, 'Rename failed');
          setRenameTarget(null);
        }}
      />

      <SnapshotsDialog project={snapshotsTarget} onClose={() => setSnapshotsTarget(null)} />

      {/* Delete */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.name}” and its snapshots permanently? Exports are the only
              backup — there is no server copy (spec 2.1).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target === null) return;
                void report(async () => {
                  await deleteProject(target.id);
                  toast.success(`Deleted “${target.name}”`);
                }, 'Delete failed');
              }}
            >
              <Trash2 aria-hidden />
              Delete “{deleteTarget?.name}”
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  allArchived,
  onCreate,
  onShowArchived,
}: {
  allArchived: boolean;
  onCreate: () => void;
  onShowArchived: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <h2 className="text-sm font-semibold">
        {allArchived ? 'Every project is archived' : 'No projects yet'}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {allArchived
          ? 'Archived projects are kept, not deleted. Show them to open or unarchive one.'
          : 'Start an empty project, or import a bundle you exported elsewhere. Nothing is stored on a server (spec 2.1).'}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        {allArchived ? (
          <Button variant="outline" onClick={onShowArchived}>
            Show archived
          </Button>
        ) : (
          <Button onClick={onCreate}>
            <Plus aria-hidden />
            New project
          </Button>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onRename,
  onDuplicate,
  onSnapshots,
  onArchive,
  onDelete,
}: {
  project: ProjectListItem;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onSnapshots: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const persistence = usePersistence();
  // Only the OPEN project has a live save state; every other row shows its last
  // write, which is what the stored record carries (7.1).
  const liveStatus = project.active && persistence.projectId === project.id;

  return (
    <Card
      className="transition-colors hover:border-ring/60"
      data-project-id={project.id}
      data-project-active={project.active}
    >
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>
            <Link to={`/project/${project.id}`} className="hover:text-primary">
              {project.name}
            </Link>
          </CardTitle>
          <CardDescription>Saved {formatRelativeTime(project.updatedAt)}</CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${project.name}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil aria-hidden />
              Rename…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy aria-hidden />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSnapshots}>
              <Camera aria-hidden />
              Snapshots…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              {project.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {project.archived ? 'Unarchive' : 'Archive'}
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
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Pin aria-hidden className="size-3" />
          <span>{project.packId}</span>
          <span aria-hidden>·</span>
          <span className="uppercase">{project.channel}</span>
          {project.packId === UNPINNED_PACK_ID ? (
            <Badge variant="outline" className="text-[10px]">
              unpinned
            </Badge>
          ) : null}
          {project.archived ? (
            <Badge variant="outline" className="text-[10px]">
              archived
            </Badge>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
          {liveStatus ? <SaveStatusIndicator /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
