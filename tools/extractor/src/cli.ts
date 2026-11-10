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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runExtraction } from './run';
import { runPackCommand } from './pack';
import {
  buildWorksheet,
  GeometryImportError,
  importObservations,
  seedFromIrDirectory,
  seedFromPackFile,
  worksheetJson,
} from './geometry';

const usage = `stationeers-extract — Stationeers game-data extraction

Usage:
  bun tools/extractor/src/cli.ts <adapter> [args]

Adapters:
  xml <inputDir> --out <outDir>    Adapter A: recipe XML -> normalized IR
  stationpedia                     Adapter B: planned (EXT-02)
  geometry init|import …           Adapter C: geometry capture harness (EXT-05)
  behavior                         Adapter D: planned (SIM-01)

Packing (EXT-03):
  pack <irDir> --out <pack.json> --build <version> --branch stable|beta
       [--channel published|user-generated] [--date <ISO-8601 UTC>]
       [--validated <promotions.json>]

Adapter C (EXT-05) is a capture harness: no game access exists here, so a human
  measures in game and the tooling validates and normalizes what they record.

  geometry init <irDir|pack.json> --out <worksheet.json>
      Write an observation worksheet: one empty row per prefab id in the
      recipes, one per pipe/cable element candidate, each with its protocol
      question. Deterministic; fill it in while playing.

  geometry import <observations.json> --out <dir>
      Validate a filled worksheet and write geometry.json (entity-contract
      field names, per-field provenance at extracted-unverified) plus
      geometry-coverage.json (what is known, which connectors are unknown, and
      what still blocks buildability). Incomplete documents import with gaps;
      documents claiming verification are refused.

  The human procedure is docs/plan/ext-05-probe.md. No output of geometry
  import is verified data, and none of it may be published as validated (§6.5).

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

/**
 * Split argv into positionals and `--flag value` pairs for the geometry
 * subcommands. A flag without a value is refused instead of being guessed at.
 */
function parseFlagsAndPositionals(argv: string[]): {
  positionals: string[];
  flags: Record<string, string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument.startsWith('--')) {
      const name = argument.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`--${name} requires a value`);
      }
      flags[name] = value;
      index += 1;
      continue;
    }
    positionals.push(argument);
  }
  return { positionals, flags };
}

if (adapter === 'geometry') {
  const geometryUsage = `geometry init <irDir|pack.json> --out <worksheet.json>
geometry import <observations.json> --out <dir>`;

  let parsed: ReturnType<typeof parseFlagsAndPositionals>;
  try {
    parsed = parseFlagsAndPositionals(process.argv.slice(3));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.log(geometryUsage);
    process.exit(1);
  }

  const [subcommand, inputPath] = parsed.positionals;
  const outPath = parsed.flags['out'];

  if (subcommand !== 'init' && subcommand !== 'import') {
    console.error('geometry requires a subcommand: init or import');
    console.log(geometryUsage);
    process.exit(1);
  }
  const inputLabel = subcommand === 'init' ? '<irDir|pack.json>' : '<observations.json>';
  const outLabel = subcommand === 'init' ? '<worksheet.json>' : '<dir>';
  if (inputPath === undefined || outPath === undefined) {
    console.error(`geometry ${subcommand} requires ${inputLabel} and --out ${outLabel}`);
    console.log(geometryUsage);
    process.exit(1);
  }

  if (subcommand === 'init') {
    try {
      if (!existsSync(inputPath)) {
        throw new Error(`input path not found: ${inputPath}`);
      }
      const seed = statSync(inputPath).isFile()
        ? await seedFromPackFile(inputPath)
        : seedFromIrDirectory(inputPath);
      const worksheet = buildWorksheet(seed);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, worksheetJson(worksheet));
      console.log(`wrote ${outPath}`);
      console.log(
        `seeded ${worksheet.definitions.length} prefab row(s) and ${worksheet.elements.length} element candidate(s) from the ${seed.source === 'ir' ? `IR (v${seed.irVersion ?? '?'})` : 'pack'}`,
      );
      console.log('fill it in while playing: docs/plan/ext-05-probe.md');
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    process.exit(0);
  }

  try {
    const result = importObservations(readFileSync(inputPath, 'utf8'));
    mkdirSync(outPath, { recursive: true });
    const geometryPath = join(outPath, 'geometry.json');
    const coveragePath = join(outPath, 'geometry-coverage.json');
    writeFileSync(geometryPath, result.geometryJson);
    writeFileSync(coveragePath, result.coverageJson);
    console.log(`wrote ${geometryPath}, ${coveragePath}`);
    console.log(result.summary);
    if (result.coverage.blockers.length > 0) {
      console.log('blockers:');
      for (const blocker of result.coverage.blockers) {
        console.log(`  ${blocker.code} (${blocker.severity}) ${blocker.message}`);
      }
    }
    console.log(
      'nothing here is verified data; promotion to extracted-and-validated is a later fixture/review step (spec 6.5).',
    );
  } catch (e) {
    if (e instanceof GeometryImportError) {
      console.error(`geometry import refused the document: ${e.message}`);
      for (const issue of e.issues) console.error(`  ${issue}`);
    } else {
      console.error(e instanceof Error ? e.message : String(e));
    }
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
