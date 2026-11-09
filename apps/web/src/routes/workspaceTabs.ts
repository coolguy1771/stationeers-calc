import { Boxes, Calculator, Map, Workflow } from 'lucide-react';
import type { WorkspaceTab } from '../state/uiStore';

/** Tab navigation for the project workspace (spec 3: dual editor + catalog + analysis). */
export const WORKSPACE_TABS: { id: WorkspaceTab; label: string; icon: typeof Workflow }[] = [
  { id: 'schematic', label: 'Schematic', icon: Workflow },
  { id: 'physical', label: 'Physical Layout', icon: Map },
  { id: 'catalog', label: 'Catalog', icon: Boxes },
  { id: 'analysis', label: 'Analysis', icon: Calculator },
];
