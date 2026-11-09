/**
 * Import/export of project bundles as JSON (spec 7.1, 9.1, 9.4).
 *
 * Imported bundles are untrusted (9.4): file-size and decompressed-size caps,
 * schema validation before migration, bounded entity counts, sanitized display
 * strings, SHA-256 content hashes, and explicit rejection of unknown/future
 * schema versions. The envelope is the transfer format; the bundle itself is
 * the portable document (9.1).
 */
import type { Project, ProjectBundle } from '@stationeers/domain';
import { bundleToProject, ProjectBundleErrorCode, ProjectBundleError, serializeProject } from '@stationeers/domain';
import { migrateProjectBundle } from './migrate';
import { MAX_IMPORT_DECOMPRESSED_SIZE, MAX_IMPORT_FILE_SIZE, MAX_EXPORT_FILE_SIZE } from './limits';

/** Envelope wrapping the bundle and its content hash for corruption detection. */
export interface ProjectTransferEnvelope {
  kind: 'stationeers-project';
  /** Transfer envelope version, independent of the bundle schema version. */
  envelopeVersion: 1;
  /** SHA-256 of the serialized bundle JSON, hex-encoded (9.4: corruption detection). */
  contentHash: string;
  bundle: ProjectBundle;
}

const ENVELOPE_KIND = 'stationeers-project';
const ENVELOPE_VERSION = 1;

/** Stable codes for transfer failures (spec 8). */
export const TransferErrorCode = {
  TooLarge: 'IMPORT-FILE-TOO-LARGE',
  DecompressedTooLarge: 'IMPORT-DECOMPRESSED-TOO-LARGE',
  NotJson: 'IMPORT-NOT-JSON',
  NotEnvelope: 'IMPORT-NOT-ENVELOPE',
  HashMismatch: 'IMPORT-HASH-MISMATCH',
  ExportTooLarge: 'EXPORT-TOO-LARGE',
} as const;

export type TransferErrorCode = (typeof TransferErrorCode)[keyof typeof TransferErrorCode];

export class TransferError extends Error {
  readonly code: TransferErrorCode;

  constructor(code: TransferErrorCode, message: string) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

/** SHA-256 of a byte sequence, hex-encoded (9.4: content-hash corruption detection). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Read a stream with a hard cap (9.4: bound decompressed size). Aborts the
 * stream as soon as the cap is exceeded, so decompression bombs do not
 * allocate past the cap.
 */
async function readBounded(
  stream: ReadableStream<Uint8Array>,
  cap: number,
  code: TransferErrorCode,
  message: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length === 0) continue;
      total += value.length;
      if (total > cap) {
        await reader.cancel();
        throw new TransferError(code, message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Decode a byte sequence, decompressing gzip first when the payload is gzip. */
async function decodeBytes(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_IMPORT_FILE_SIZE) {
    throw new TransferError(
      TransferErrorCode.TooLarge,
      `Import file exceeds ${MAX_IMPORT_FILE_SIZE} bytes.`,
    );
  }
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) {
    return new TextDecoder().decode(bytes);
  }
  const body = new Response(bytes as unknown as BodyInit).body;
  if (!body) {
    throw new TransferError(TransferErrorCode.NotJson, 'Import payload has no readable body.');
  }
  const decompressed = await readBounded(
    body.pipeThrough(new DecompressionStream('gzip')),
    MAX_IMPORT_DECOMPRESSED_SIZE,
    TransferErrorCode.DecompressedTooLarge,
    `Decompressed import exceeds ${MAX_IMPORT_DECOMPRESSED_SIZE} bytes.`,
  );
  return new TextDecoder().decode(decompressed);
}

/**
 * Validate the transfer envelope shell (9.4) and return the candidate.
 *
 * Deliberately does NOT validate the bundle schema: the envelope is a
 * checksum wrapper. The bundle is validated against its source schema version
 * by `migrateProjectBundle` inside `importProject` (9.2: schema validation
 * before migration), so the bundle cast here is safe — the bundle is not
 * used before that validation.
 */
function validateEnvelope(parsed: unknown): ProjectTransferEnvelope {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TransferError(TransferErrorCode.NotEnvelope, 'Import payload is not a project envelope.');
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.kind !== ENVELOPE_KIND || candidate.envelopeVersion !== ENVELOPE_VERSION) {
    throw new TransferError(
      TransferErrorCode.NotEnvelope,
      `Unsupported envelope: kind=${String(candidate.kind)}, envelopeVersion=${String(candidate.envelopeVersion)}.`,
    );
  }
  if (typeof candidate.contentHash !== 'string') {
    throw new TransferError(TransferErrorCode.NotEnvelope, 'Envelope has no contentHash.');
  }
  if (typeof candidate.bundle !== 'object' || candidate.bundle === null) {
    throw new TransferError(TransferErrorCode.NotEnvelope, 'Envelope has no bundle.');
  }
  return {
    kind: ENVELOPE_KIND,
    envelopeVersion: ENVELOPE_VERSION,
    contentHash: candidate.contentHash,
    bundle: candidate.bundle as ProjectBundle,
  };
}

/**
 * Serialize a project to a transfer envelope (9.1). Validates against the
 * current bundle schema, so what is exported is always contract-valid.
 */
export async function exportProject(project: Project): Promise<ProjectTransferEnvelope> {
  const bundle = serializeProject(project);
  const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
  if (bundleBytes.length > MAX_EXPORT_FILE_SIZE) {
    throw new TransferError(
      TransferErrorCode.ExportTooLarge,
      `Exported bundle exceeds ${MAX_EXPORT_FILE_SIZE} bytes.`,
    );
  }
  return {
    kind: ENVELOPE_KIND,
    envelopeVersion: ENVELOPE_VERSION,
    contentHash: await sha256Hex(bundleBytes),
    bundle,
  };
}

/**
 * Export a project as a JSON string (9.1). The envelope is the transfer
 * format; the bundle itself is the portable document (9.1).
 */
export async function exportProjectJson(project: Project): Promise<string> {
  return JSON.stringify(await exportProject(project));
}

/**
 * Export a project as optionally gzip-compressed bytes (9.4).
 * The content hash is over the uncompressed bundle JSON, so corruption is
 * detected even when the gzip wrapper is re-compressed.
 */
export async function exportProjectBytes(project: Project, compress: boolean): Promise<Uint8Array> {
  const json = await exportProjectJson(project);
  const bytes = new TextEncoder().encode(json);
  if (!compress) return bytes;
  const body = new Response(bytes as unknown as BodyInit).body;
  if (!body) {
    throw new TransferError(TransferErrorCode.ExportTooLarge, 'Export payload has no readable body.');
  }
  const compressed = await new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return new Uint8Array(compressed);
}

/**
 * Import a project bundle from a transfer envelope (9.1, 9.2, 9.4).
 * Validates the envelope shell, verifies the content hash over the bundle
 * JSON, migrates the bundle to the current schema version, and returns the
 * canonical project document.
 */
export async function importProject(envelope: unknown): Promise<Project> {
  const validated = validateEnvelope(envelope);
  const bundleBytes = new TextEncoder().encode(JSON.stringify(validated.bundle));
  const actualHash = await sha256Hex(bundleBytes);
  if (actualHash !== validated.contentHash) {
    throw new TransferError(
      TransferErrorCode.HashMismatch,
      `Content hash mismatch: expected ${validated.contentHash}, got ${actualHash}.`,
    );
  }
  // Schema validation before migration (9.2, 9.4). The bundle schema version
  // gates the migration; unknown future versions are rejected explicitly.
  const migrated = migrateProjectBundle(validated.bundle);
  return bundleToProject(migrated.bundle);
}

/**
 * Import a project bundle from a JSON string (9.4). Enforces the raw file-size
 * cap; the bundle schema enforces the entity and graph bounds.
 */
export async function importProjectJson(json: string): Promise<Project> {
  if (json.length > MAX_IMPORT_FILE_SIZE) {
    throw new TransferError(
      TransferErrorCode.TooLarge,
      `Import file exceeds ${MAX_IMPORT_FILE_SIZE} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new TransferError(TransferErrorCode.NotJson, `Import payload is not valid JSON: ${String(error)}`);
  }
  return importProject(parsed);
}

/**
 * Import a project bundle from raw bytes (9.4): raw file-size cap, gzip
 * decompression when the payload is gzip, bounded decompressed size, JSON
 * parse, envelope validation, content-hash verification, migration, and
 * schema validation.
 */
export async function importProjectBytes(bytes: Uint8Array): Promise<Project> {
  const text = await decodeBytes(bytes);
  return importProjectJson(text);
}

export { ProjectBundleError, ProjectBundleErrorCode };
