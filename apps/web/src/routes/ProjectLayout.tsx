import { ArrowLeft, Fingerprint } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ExportBundleButton } from '../components/ExportBundleButton';
import { ExportPromptBanner } from '../components/ExportPromptBanner';
import { ImportProjectButton } from '../components/projects/ImportProjectButton';
import { SaveStatusIndicator } from '../components/SaveStatusIndicator';
import { ThemeToggle } from '../components/ThemeToggle';
import { UndoRedoControls } from '../components/UndoRedoControls';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn, shortHash } from '../lib/utils';
import { startPersistence } from '../state/persistence';
import {
  ensureProjectLibrary,
  hasStoredProject,
  loadProjectIntoStore,
} from '../state/projectLibrary';
import { projectStore, useProjectSnapshot } from '../state/projectStore';
import { useUndoRedoShortcuts } from '../state/undoRedo';
import { useUiStore } from '../state/uiStore';
import { WORKSPACE_TABS } from './workspaceTabs';

/**
 * Project workspace shell (spec 3): top bar with project identity, pinned pack +
 * hash, canonical store revision, save status, export; tab navigation over the
 * four workspaces.
 *
 * The shell holds no project data itself: identity comes from the canonical
 * store's `meta` (spec 2.2.1) and the route is mirrored into the transient UI
 * store. The route decides which stored project is open (7.1): when it names a
 * project the store does not hold, the project is loaded from IndexedDB through
 * `loadProjectIntoStore` — which flushes the outgoing project's pending save
 * first, so switching never drops an edit.
 */
export function ProjectLayout() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const setActiveProject = useUiStore((state) => state.setActiveProject);
  const setActiveTab = useUiStore((state) => state.setActiveTab);

  const activeTab = WORKSPACE_TABS.find((tab) => location.pathname.endsWith(`/${tab.id}`))?.id ?? null;

  useEffect(() => {
    setActiveProject(projectId ?? null);
    return () => setActiveProject(null);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    // Autosave begins with the workspace: it adopts the open project (which the
    // project library persists before opening) and then writes each committed
    // revision (2.2.1, 7.1).
    startPersistence();
  }, []);

  useEffect(() => {
    setActiveTab(activeTab);
    return () => setActiveTab(null);
  }, [activeTab, setActiveTab]);

  const { project: snapshotProject, revision } = useProjectSnapshot();
  const project = snapshotProject.meta.id === projectId ? snapshotProject.meta : undefined;

  const [phase, setPhase] = useState<'loading' | 'unknown' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureProjectLibrary();
        if (cancelled) return;
        const open = projectStore.state.meta.id === projectId;
        // The database is the authority on which projects exist: a stale
        // in-memory document (the project was deleted) is not openable.
        if (!hasStoredProject(projectId)) {
          setPhase('unknown');
          return;
        }
        if (!open) await loadProjectIntoStore(projectId);
        if (!cancelled) setPhase('loading');
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useUndoRedoShortcuts();

  if (!project || phase === 'unknown' || phase === 'error') {
    return <ProjectUnavailable projectId={projectId} phase={phase} error={loadError} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to projects">
          <Link to="/">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">{project.name}</h1>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Fingerprint aria-hidden className="size-3" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default font-mono">
                  {project.packId} #{shortHash(project.packHash)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Pinned pack hash (spec 7.1): <span className="font-mono">{project.packHash}</span>
                <br />
                Game build {project.gameBuild} · channel {project.channel}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Separator orientation="vertical" className="ms-auto h-6" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="cursor-default font-mono text-[11px] text-muted-foreground"
              data-store-revision={revision}
            >
              rev {revision}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Canonical store revision (spec 2.2.1): every committed command, undo and redo
            increments it.
          </TooltipContent>
        </Tooltip>
        <SaveStatusIndicator />
        <UndoRedoControls />
        <Separator orientation="vertical" className="h-6" />
        <ExportBundleButton />
        <ImportProjectButton
          size="sm"
          variant="ghost"
          onImported={(imported) => navigate(`/project/${imported.id}`)}
        />
        <ThemeToggle />
      </header>

      <ExportPromptBanner />

      <nav aria-label="Workspace sections" className="flex items-center gap-1 border-b border-border px-3">
        {WORKSPACE_TABS.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.id}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            <tab.icon aria-hidden className="size-3.5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Route states that are not a workspace: still loading a stored project, a
 * project id the database does not hold, or a failed load. Each state says what
 * happened instead of rendering someone else's project.
 */
function ProjectUnavailable({
  projectId,
  phase,
  error,
}: {
  projectId: string | undefined;
  phase: 'loading' | 'unknown' | 'error';
  error: string | null;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
      {phase === 'loading' ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            Opening project…
          </p>
          <p className="font-mono text-xs text-muted-foreground/70">{projectId}</p>
        </>
      ) : null}
      {phase === 'unknown' ? (
        <>
          <p className="font-mono text-sm">unknown project id</p>
          <p className="text-sm text-muted-foreground">
            No stored project has id <span className="font-mono">{projectId}</span>. Projects live
            in this browser's database (spec 7.1); open one from the projects list or import a
            bundle.
          </p>
        </>
      ) : null}
      {phase === 'error' ? (
        <>
          <p className="font-mono text-sm">could not open project</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </>
      ) : null}
      <Button asChild variant="outline">
        <Link to="/">
          <ArrowLeft aria-hidden />
          Back to projects
        </Link>
      </Button>
    </div>
  );
}
