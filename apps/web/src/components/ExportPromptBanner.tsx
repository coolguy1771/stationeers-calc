import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { shortHash } from '../lib/utils';
import { dismissExportPrompt, markProjectExported, useExportPrompt } from '../state/exportPrompt';
import { exportCurrentProject } from '../state/exportProject';
import { Button } from './ui/button';

/**
 * Export nudge (spec 2.1 "prompt for export", 7.1 "prompt for export as in
 * 2.1"). Non-blocking: a banner above the workspace that can be dismissed.
 *
 * IndexedDB is the only copy of a project and browsers may evict it, so after
 * `EXPORT_PROMPT_REVISION_THRESHOLD` committed revisions the shell offers the
 * portable backup. "Export" runs the same envelope export as the toolbar
 * button; "Not now" is remembered for this project.
 */
export function ExportPromptBanner() {
  const prompt = useExportPrompt();
  const [exporting, setExporting] = useState(false);

  if (!prompt.visible) return null;

  async function run(): Promise<void> {
    setExporting(true);
    try {
      const file = await exportCurrentProject();
      markProjectExported(file.projectId);
      toast.success('Project bundle exported', {
        description: `${file.filename} · sha256 ${shortHash(file.contentHash, 12)}… (spec 9.1)`,
      });
    } catch (error) {
      toast.error('Export failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      role="status"
      data-export-prompt="visible"
      className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs"
    >
      <p className="min-w-0 flex-1">
        {prompt.revisions} revisions since your last export. Local storage is the only copy of this
        project — export a bundle as your backup (spec 2.1).
      </p>
      <Button size="sm" variant="outline" onClick={() => void run()} disabled={exporting}>
        <Download aria-hidden />
        {exporting ? 'Exporting…' : 'Export now'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => dismissExportPrompt()}>
        <X aria-hidden />
        Not now
      </Button>
    </div>
  );
}
