import { ArrowLeft, Download, Fingerprint } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { SaveStatusIndicator } from '../components/SaveStatusIndicator';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn, shortHash } from '../lib/utils';
import { stubbedAction } from '../lib/stubs';
import { useProjectSnapshot } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { WORKSPACE_TABS } from './workspaceTabs';

/**
 * Project workspace shell (spec 3): top bar with project identity, pinned pack +
 * hash, canonical store revision, save status, export; tab navigation over the
 * four workspaces.
 *
 * The shell holds no project data itself: identity comes from the canonical
 * store's `meta` (spec 2.2.1) and the route is mirrored into the transient UI
 * store. One project is seeded per session; listing and switching persisted
 * projects belongs to project management (7.1).
 */
export function ProjectLayout() {
  const { projectId } = useParams();
  const location = useLocation();
  const setActiveProject = useUiStore((state) => state.setActiveProject);
  const setActiveTab = useUiStore((state) => state.setActiveTab);

  const activeTab = WORKSPACE_TABS.find((tab) => location.pathname.endsWith(`/${tab.id}`))?.id ?? null;

  useEffect(() => {
    setActiveProject(projectId ?? null);
    return () => setActiveProject(null);
  }, [projectId, setActiveProject]);

  useEffect(() => {
    setActiveTab(activeTab);
    return () => setActiveTab(null);
  }, [activeTab, setActiveTab]);

  const { project: snapshotProject, revision } = useProjectSnapshot();
  const project = snapshotProject.meta.id === projectId ? snapshotProject.meta : undefined;

  if (!project) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <p className="font-mono text-sm">unknown project id</p>
        <p className="text-sm text-muted-foreground">
          No project with id <span className="font-mono">{projectId}</span> is loaded in the
          canonical store. One demo project is seeded per session; persisted projects arrive with
          project management (spec 7.1).
        </p>
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeft aria-hidden />
            Back to projects
          </Link>
        </Button>
      </div>
    );
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
        <Separator orientation="vertical" className="h-6" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => stubbedAction('Export versioned project bundle (spec 7.1, 9.1)', 'FND-03')}
        >
          <Download aria-hidden />
          Export
        </Button>
        <ThemeToggle />
      </header>

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
