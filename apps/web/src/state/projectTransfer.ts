import { PROJECT_SCHEMA_VERSION, ProjectBundleError, ProjectBundleErrorCode } from '@stationeers/domain';
import {
  MAX_IMPORT_FILE_SIZE,
  TransferError,
  TransferErrorCode,
  importProjectBytes,
} from '@stationeers/persistence';
import { addImportedProject, type ProjectListItem } from './projectLibrary';

/**
 * Project import (spec 7.1, 9.1, 9.4).
 *
 * The file is untrusted: the raw size is capped before it is read, and
 * `@stationeers/persistence` then does the rest of the 9.4 checklist — bounded
 * decompression, JSON parse, envelope check, SHA-256 content-hash verification,
 * schema validation before migration, and explicit rejection of unknown future
 * schema versions. This module only turns those failures into messages a user
 * can act on, and hands the validated document to the project library.
 */

/** Bytes of the import cap, for user-facing messages. */
const MAX_IMPORT_MIB = Math.round(MAX_IMPORT_FILE_SIZE / (1024 * 1024));

/**
 * Imports a downloaded project bundle and stores it (7.1). Throws a
 * `TransferError` / `ProjectBundleError` on a rejected file; nothing is stored
 * before the whole 9.4 pipeline has passed.
 */
export async function importProjectFile(file: File): Promise<ProjectListItem> {
  // Size cap first: never read (let alone parse) an oversized file (9.4).
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new TransferError(
      TransferErrorCode.TooLarge,
      `This file is ${formatBytes(file.size)}; the import limit is ${MAX_IMPORT_MIB} MiB.`,
    );
  }
  if (file.size === 0) {
    throw new TransferError(TransferErrorCode.NotJson, 'This file is empty, not a project bundle.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const project = await importProjectBytes(bytes);
  return addImportedProject(project);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} bytes`;
}

/**
 * User-facing explanation of a rejected import, keyed by the stable error code
 * (spec 8). Every message says what happened and that nothing was imported.
 */
export function describeImportError(error: unknown): string {
  if (error instanceof TransferError) {
    switch (error.code) {
      case TransferErrorCode.TooLarge:
        return `This bundle is too large to import. ${error.message}`;
      case TransferErrorCode.DecompressedTooLarge:
        return `This bundle expands past the ${MAX_IMPORT_MIB} MiB decompression limit, so it was rejected (spec 9.4). Nothing was imported.`;
      case TransferErrorCode.NotJson:
        return `This file is not a project bundle: ${error.message}`;
      case TransferErrorCode.NotEnvelope:
        return `This JSON file is not a Stationeers Engineer project bundle (${error.message}). Nothing was imported.`;
      case TransferErrorCode.HashMismatch:
        return 'This bundle is corrupt: its content hash does not match its contents. Nothing was imported.';
      default:
        return error.message;
    }
  }
  if (error instanceof ProjectBundleError) {
    switch (error.code) {
      case ProjectBundleErrorCode.Future:
        return `This bundle was saved by a newer version of Stationeers Engineer. ${error.message} Update the app to import it; nothing was imported.`;
      case ProjectBundleErrorCode.Invalid:
        return `This bundle does not match the project schema (v${PROJECT_SCHEMA_VERSION}). ${error.message} Nothing was imported.`;
      case ProjectBundleErrorCode.Malformed:
        return `This file is not a project bundle. ${error.message} Nothing was imported.`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
