import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { shortHash } from '../lib/utils';
import { exportCurrentProject } from '../state/exportProject';

/**
 * Exports the canonical project as a portable bundle (spec 7.1, 9.1). The
 * envelope carries a SHA-256 content hash, so the file is verifiable when it is
 * imported again (9.4).
 */
export function ExportBundleButton() {
  const [exporting, setExporting] = useState(false);

  async function run(): Promise<void> {
    setExporting(true);
    try {
      const file = await exportCurrentProject();
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
    <Button variant="outline" size="sm" onClick={() => void run()} disabled={exporting}>
      <Download aria-hidden />
      {exporting ? 'Exporting…' : 'Export'}
    </Button>
  );
}
