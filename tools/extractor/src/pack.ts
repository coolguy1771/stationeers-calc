/**
 * `stationeers-extract pack` (EXT-03): turn one extraction output directory into
 * a versioned pack, then validate it end to end with the same loader the SPA
 * uses (spec 6.4, 6.5, 6.7).
 *
 * The pack writes byte-identically for the same IR and the same metadata: the
 * CLI serializes with the pack's canonical JSON, and the only input that varies
 * by default is the extraction date (pin it with `--date` for reproducible
 * artifacts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPack, canonicalJson, loadPackJson, type Pack } from '@stationeers/packs';
import { EXTRACTOR_VERSION, NORMALIZATION_VERSION } from './version';

/** Everything the `pack` subcommand needs from the command line. */
export interface PackCommandOptions {
  /** Directory holding `ir.json`, `coverage.json`, `manifest.json`. */
  irDir: string;
  /** Where to write the pack JSON. */
  outPath: string;
  /** Full numeric game build, e.g. `0.2.6428.27798`. */
  gameBuild: string;
  gameBranch: 'stable' | 'beta';
  channel: 'published' | 'user-generated';
  /** ISO-8601 UTC timestamp. */
  extractionDate: string;
  /** Optional explicit promotion input (spec 6.5). */
  validatedPath?: string;
}

function readJson(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${label} at ${path}; run \`xml\` first to produce the extraction outputs`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} at ${path} is not valid JSON: ${String(error)}`);
  }
}

/** Human summary of what the pack holds and what is still unverified. */
export function summarizePack(pack: Pack): string {
  const quality = pack.coverage.counts.byPropertyQuality;
  const joins = pack.coverage.joins.map((join) => `${join.join}=${join.status}`).join(', ');
  return [
    `pack ${pack.packId} — game build ${pack.gameBuild} (${pack.gameBranch}), channel ${pack.channel}`,
    `entities: ${pack.entityCounts.recipes} recipes, ${pack.entityCounts.items} items, ${pack.entityCounts.devices} devices; source world refs ${pack.coverage.counts.sourceWorldRefs}`,
    `properties: ${quality['extracted-and-validated']} validated, ${quality['extracted-unverified']} unverified, ${quality.missing} missing, ${quality.conflicting} conflicting, ${quality.inferred} inferred`,
    `joins: ${joins}`,
    `source files: ${Object.keys(pack.sourceDigests.files).length}; missing fields recorded: ${pack.coverage.missingFields.total}; diagnostics: ${pack.coverage.diagnostics.total}`,
    `contentHash ${pack.contentHash}`,
  ].join('\n');
}

/**
 * Build, write, and re-load a pack. Throws with a readable message on any
 * failure; the caller maps that to a non-zero exit.
 */
export async function runPackCommand(options: PackCommandOptions): Promise<{ pack: Pack; summary: string }> {
  const promotion = options.validatedPath === undefined
    ? undefined
    : readJson(options.validatedPath, 'validation input');

  const pack = await buildPack({
    ir: readJson(join(options.irDir, 'ir.json'), 'IR'),
    coverage: readJson(join(options.irDir, 'coverage.json'), 'coverage report'),
    manifest: readJson(join(options.irDir, 'manifest.json'), 'extractor manifest'),
    metadata: {
      gameBuild: options.gameBuild,
      gameBranch: options.gameBranch,
      channel: options.channel,
      extractionDate: options.extractionDate,
      toolVersions: { extractor: EXTRACTOR_VERSION, ir: 2 },
      normalizationVersion: NORMALIZATION_VERSION,
    },
    ...(promotion === undefined ? {} : { promotions: promotion }),
  });

  const json = `${canonicalJson(pack)}\n`;

  // End-to-end check before anything is written: the artifact must load through
  // the runtime validator (size cap, schema, content hash, quality invariants),
  // so a failed validation never leaves a bad pack on disk.
  await loadPackJson(json);
  writeFileSync(options.outPath, json);

  return { pack, summary: summarizePack(pack) };
}
