import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { describeImportError, importProjectFile } from '../../state/projectTransfer';
import type { ProjectListItem } from '../../state/projectLibrary';
import { Button } from '../ui/button';

/**
 * Import a project bundle (7.1 import, 9.1, 9.4).
 *
 * The chosen file is size-capped before it is read, then validated by the
 * untrusted-import pipeline (`state/projectTransfer.ts`): envelope, SHA-256
 * content hash, schema validation before migration, and an explicit rejection
 * of future schema versions. A rejected file stores nothing and reports why.
 */
export interface ImportProjectButtonProps {
  readonly onImported?: (project: ProjectListItem) => void;
  /** Receives the user-facing explanation when a file is rejected. */
  readonly onError?: (message: string) => void;
  readonly variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  readonly size?: 'default' | 'sm' | 'lg' | 'icon';
  readonly label?: string;
}

export function ImportProjectButton({
  onImported,
  onError,
  variant = 'outline',
  size = 'default',
  label = 'Import',
}: ImportProjectButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function run(file: File): Promise<void> {
    setBusy(true);
    try {
      const imported = await importProjectFile(file);
      toast.success(`Imported “${imported.name}”`, {
        description: `${file.name} · pinned to ${imported.packId} (spec 7.1).`,
      });
      onImported?.(imported);
    } catch (error) {
      const message = describeImportError(error);
      toast.error(`Import of ${file.name} failed`, { description: message });
      onError?.(message);
    } finally {
      setBusy(false);
      // Allow re-selecting the same file after a failed import.
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload aria-hidden />
        {busy ? 'Importing…' : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        aria-label="Import project bundle"
        accept="application/json,.json,.gz,application/gzip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void run(file);
        }}
      />
    </>
  );
}
