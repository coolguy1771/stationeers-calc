import { Redo2, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useUndoRedo } from '../state/undoRedo';

/**
 * Undo/redo controls for the canonical command log (spec 2.2.1, SYNC-010):
 * disabled states come from the store's history cursor, and the same actions
 * back the Ctrl/Cmd+Z shortcuts.
 */
export function UndoRedoControls() {
  const { canUndo, canRedo, undo, redo } = useUndoRedo();
  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 aria-hidden className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl/Cmd+Z) — replays the inverse patch</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 aria-hidden className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Shift+Ctrl/Cmd+Z)</TooltipContent>
      </Tooltip>
    </div>
  );
}
