import type { Project } from '@stationeers/domain';
import { exportProject } from '@stationeers/persistence';
import { shortHash } from '../lib/utils';
import { projectStore } from './projectStore';

/**
 * Portable project export (spec 7.1, 9.1, 9.4).
 *
 * Export is never a bespoke serializer: `@stationeers/persistence` wraps the
 * canonical project in the transfer envelope with a SHA-256 hash over the
 * serialized bundle, and validates it against the bundle schema on the way out —
 * the same contract the import path verifies on the way in. Nothing game-data or
 * presentation related is invented here.
 */
export interface ProjectExportFile {
  /** Id of the exported project (the envelope's `bundle.meta.id`). */
  readonly projectId: string;
  /** Suggested download name: project id + short content hash. */
  readonly filename: string;
  /** Pretty-printed transfer envelope (kind, envelopeVersion, contentHash, bundle). */
  readonly json: string;
  /** Full SHA-256 of the serialized bundle, hex-encoded (9.4). */
  readonly contentHash: string;
}

/** Builds the exportable envelope for `project` without touching the DOM. */
export async function buildProjectExport(project: Project): Promise<ProjectExportFile> {
  const envelope = await exportProject(project);
  return {
    projectId: project.meta.id,
    filename: `${project.meta.id}-${shortHash(envelope.contentHash)}.json`,
    // Indentation is cosmetic: the content hash covers the compact bundle JSON,
    // and the import path re-serializes the parsed bundle before hashing it.
    json: JSON.stringify(envelope, null, 2),
    contentHash: envelope.contentHash,
  };
}

/**
 * Hands the envelope to the browser as a file download (7.1). Returns `false`
 * where no download API exists (tests, workers) — the envelope is still built.
 */
export function downloadProjectExport(file: ProjectExportFile): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([file.json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Exports the current canonical project and downloads it. */
export async function exportCurrentProject(): Promise<ProjectExportFile> {
  const file = await buildProjectExport(projectStore.state);
  downloadProjectExport(file);
  return file;
}
