/**
 * Pack loader (spec 6.7, 9.4): a pack file is untrusted input.
 *
 * Order of checks, each refusing instead of guessing:
 *
 * 1. file-size cap (bytes, before parsing anything);
 * 2. JSON parse;
 * 3. it must look like a pack at all, and its `packSchemaVersion` must be a
 *    version this build knows — a future version is rejected, never coerced
 *    (spec 9.2); an older one without a registered migration too;
 * 4. schema validation (the whole manifest and payload, bounded counts);
 * 5. content-hash verification over the canonical JSON (corruption/tampering);
 * 6. data-quality invariants (a validated value needs approval and a verified
 *    unit, spec 6.5).
 *
 * What comes back is frozen: packs are shared, read-only data.
 */
import { contentHashOf, withoutContentHash } from './canonical';
import { PackError, PackErrorCode } from './errors';
import { deepFreeze } from './immutable';
import { MAX_PACK_FILE_SIZE } from './limits';
import { assertQualityInvariants } from './quality';
import { PACK_SCHEMA_VERSION, PackSchema, type Pack, type ReadonlyPack } from './schema';

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
}

/**
 * Load a pack from an already-parsed JSON value. Validates, verifies the content
 * hash, and returns frozen data.
 */
export async function loadPack(input: unknown): Promise<ReadonlyPack> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PackError(PackErrorCode.LoadNotPack, 'the payload is not a pack object');
  }
  const candidate = input as Record<string, unknown>;
  const version = candidate['packSchemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new PackError(
      PackErrorCode.LoadNotPack,
      'the payload has no integer packSchemaVersion, so it is not a pack',
    );
  }
  if (version > PACK_SCHEMA_VERSION) {
    throw new PackError(
      PackErrorCode.SchemaFuture,
      `unknown pack schema version ${version}; this build supports version ${PACK_SCHEMA_VERSION} and does not coerce newer packs`,
    );
  }
  if (version < PACK_SCHEMA_VERSION) {
    throw new PackError(
      PackErrorCode.SchemaUnsupported,
      `pack schema version ${version} has no registered migration; this build supports version ${PACK_SCHEMA_VERSION}`,
    );
  }

  // Schema validation comes before anything reads a value (spec 9.4).
  const result = PackSchema.safeParse(candidate);
  if (!result.success) {
    throw new PackError(PackErrorCode.SchemaInvalid, 'the pack fails schema validation', issuesOf(result.error));
  }
  const pack = result.data as Pack;

  // Corruption/tampering detection (spec 9.4): the declared hash must match the
  // canonical bytes of everything else in the pack.
  const declared = pack.contentHash;
  const actual = await contentHashOf(withoutContentHash(candidate));
  if (actual !== declared) {
    throw new PackError(
      PackErrorCode.HashMismatch,
      `content hash mismatch: the pack declares ${declared}, its content hashes to ${actual}`,
    );
  }

  assertQualityInvariants(pack);

  return deepFreeze(pack) as ReadonlyPack;
}

/**
 * Load a pack from a JSON string. The size cap is checked on the encoded byte
 * length before the string is parsed.
 */
export async function loadPackJson(json: string): Promise<ReadonlyPack> {
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > MAX_PACK_FILE_SIZE) {
    throw new PackError(
      PackErrorCode.LoadTooLarge,
      `pack is ${byteLength} bytes; the limit is ${MAX_PACK_FILE_SIZE}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new PackError(PackErrorCode.LoadNotJson, `pack is not valid JSON: ${String(error)}`);
  }
  return loadPack(parsed);
}

/** Load a pack from raw bytes (file or fetch body), capped before decoding. */
export async function loadPackBytes(bytes: Uint8Array): Promise<ReadonlyPack> {
  if (bytes.length > MAX_PACK_FILE_SIZE) {
    throw new PackError(
      PackErrorCode.LoadTooLarge,
      `pack is ${bytes.length} bytes; the limit is ${MAX_PACK_FILE_SIZE}`,
    );
  }
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new PackError(PackErrorCode.LoadNotJson, `pack is not valid UTF-8: ${String(error)}`);
  }
  return loadPackJson(json);
}
