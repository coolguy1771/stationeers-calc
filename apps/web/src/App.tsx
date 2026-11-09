import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { ProjectLayout } from './routes/ProjectLayout';
import { ProjectsPage } from './routes/ProjectsPage';
import { DesignPage } from './routes/DesignPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { AnalysisPage } from './routes/tabs/AnalysisPage';
import { CatalogPage } from './routes/tabs/CatalogPage';
import { PhysicalPage } from './routes/tabs/PhysicalPage';
import { SchematicPage } from './routes/tabs/SchematicPage';

/**
 * Route tree (UI-01). Exported separately from the default App so tests can
 * mount it inside a MemoryRouter without the toast host. TooltipProvider
 * belongs to the route tree: pages use tooltips directly.
 */
export function AppRoutes() {
  return (
    <TooltipProvider>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/project/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="schematic" replace />} />
          <Route path="schematic" element={<SchematicPage />} />
          <Route path="physical" element={<PhysicalPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
        </Route>
        <Route path="/design" element={<DesignPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </TooltipProvider>
  );
}

/** Root app shell: route tree + toast host. */
export default function App() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppRoutes />
      <Toaster />
    </div>
  );
}

