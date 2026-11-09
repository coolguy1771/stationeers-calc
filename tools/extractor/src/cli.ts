#!/usr/bin/env bun
/**
 * Stationeers game-data extraction CLI (spec 6).
 *
 * Adapters:
 *   A — XML configuration and recipes (EXT-01/EXT-01b)
 *   B — runtime Stationpedia extractor (EXT-02)
 *   C — geometry: footprints, connectors, orientations, grid sizes, volumes (EXT-05)
 *   D — behavior verification fixtures (SIM-01)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExtraction } from './run';
import { runPackCommand } from './pack';

const usage = `stationeers-extract — Stationeers game-data extraction

Usage:
  bun tools/extractor/src/cli.ts <adapter> [args]

Adapters:
  xml <inputDir> --out <outDir>    Adapter A: recipe XML -> normalized IR
  stationpedia                     Adapter B: planned (EXT-02)
  geometry                         Adapter C: planned (EXT-05)
  behavior                         Adapter D: planned (SIM-01)

Packing (EXT-03):
  pack <irDir> --out <pack.json> --build <version> --branch stable|beta
       [--channel published|user-generated] [--date <ISO-8601 UTC>]
       [--validated <promotions.json>]

Adapter A reads the confirmed <GameData> recipe format from a CLEAN VANILLA
  install: <SteamLibrary>/steamapps/common/Stationeers/rocketstation_Data/
  StreamingAssets/Data. Mod content is out of scope (spec 6.3). Writes ir.json,
  coverage.json, and manifest.json into outDir; byte-identical across runs on the
  same input. Unit semantics and non-recipe families remain unresolved — see
  tools/extractor/README.md limitations.

The pack subcommand builds a versioned pack from an irDir and validates it with
  the runtime loader. Nothing is extracted-and-validated unless --validated
  names it; the build number and branch are install facts, supplied here.
`;

const adapter = process.argv[2];

if (!adapter || adapter === '--help' || adapter === '-h') {
  console.log(usage);
  process.exit(0);
}

if (adapter === 'xml') {
  const positional = process.argv.slice(3);
  const inputDir = positional[0];
  const outIdx = positional.indexOf('--out');
  const outDir = outIdx >= 0 ? positional[outIdx + 1] : undefined;

  if (!inputDir || inputDir.startsWith('--') || !outDir) {
    console.error('xml adapter requires <inputDir> and --out <outDir>');
    console.log(usage);
    process.exit(1);
  }

  try {
    const result = runExtraction(inputDir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'ir.json'), result.irJson);
    writeFileSync(join(outDir, 'coverage.json'), result.coverageJson);
    writeFileSync(join(outDir, 'manifest.json'), result.manifestJson);
    console.log(`wrote ${join(outDir, 'ir.json')}, ${join(outDir, 'coverage.json')}, ${join(outDir, 'manifest.json')}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  process.exit(0);
}

if (adapter === 'pack') {
  const rest = process.argv.slice(3);
  const irDir = rest[0];
  const flag = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };

  const outPath = flag('--out');
  const gameBuild = flag('--build');
  const branch = flag('--branch');
  const channel = flag('--channel') ?? 'user-generated';
  const extractionDate = flag('--date') ?? new Date().toISOString();
  const validatedPath = flag('--validated');

  if (!irDir || irDir.startsWith('--') || !outPath || !gameBuild || !branch) {
    console.error('pack requires <irDir>, --out <pack.json>, --build <version>, and --branch stable|beta');
    console.log(usage);
    process.exit(1);
  }
  if (branch !== 'stable' && branch !== 'beta') {
    console.error(`--branch must be "stable" or "beta", not "${branch}"`);
    process.exit(1);
  }
  if (channel !== 'published' && channel !== 'user-generated') {
    console.error(`--channel must be "published" or "user-generated", not "${channel}"`);
    process.exit(1);
  }

  try {
    const { summary } = await runPackCommand({
      irDir,
      outPath,
      gameBuild,
      gameBranch: branch,
      channel,
      extractionDate,
      ...(validatedPath === undefined ? {} : { validatedPath }),
    });
    console.log(`wrote ${outPath}`);
    console.log(summary);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown adapter: ${adapter}`);
console.log(usage);
process.exit(1);
