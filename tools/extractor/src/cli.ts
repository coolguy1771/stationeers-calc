#!/usr/bin/env bun
/**
 * Stationeers game-data extraction CLI (spec 6).
 *
 * Adapters:
 *   A — XML configuration and recipes (EXT-01)
 *   B — runtime Stationpedia extractor (EXT-02)
 *   C — geometry: footprints, connectors, orientations, grid sizes, volumes (EXT-05)
 *   D — behavior verification fixtures (SIM-01)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExtraction } from './run';

const usage = `stationeers-extract — Stationeers game-data extraction

Usage:
  bun tools/extractor/src/cli.ts <adapter> [args]

Adapters:
  xml <inputDir> --out <outDir>    Adapter A: XML config/recipes -> normalized IR
  stationpedia                     Adapter B: planned (EXT-02)
  geometry                         Adapter C: planned (EXT-05)
  behavior                         Adapter D: planned (SIM-01)

Adapter A parses the PROVISIONAL XML format — NOT GAME DATA; see
  tools/extractor/README.md limitations. Writes ir.json, coverage.json,
  and manifest.json into outDir; byte-identical across runs on the same input.
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

console.error(`Unknown adapter: ${adapter}`);
console.log(usage);
process.exit(1);
