#!/usr/bin/env bun
/**
 * Stationeers game-data extraction CLI (spec 6).
 *
 * Adapters:
 *   A — XML configuration and recipes (EXT-01, in progress)
 *   B — runtime Stationpedia extractor (EXT-02)
 *   C — geometry: footprints, connectors, orientations, grid sizes, volumes (EXT-05)
 *   D — behavior verification fixtures (SIM-01)
 */

const usage = `stationeers-extract — Stationeers game-data extraction

Usage:
  bun tools/extractor/src/cli.ts <adapter> [args]

Adapters:
  xml <inputDir> --out <outDir>    Adapter A: XML config/recipes -> normalized IR
  stationpedia                     Adapter B: planned (EXT-02)
  geometry                         Adapter C: planned (EXT-05)
  behavior                         Adapter D: planned (SIM-01)
`;

const adapter = process.argv[2];

if (!adapter || adapter === '--help' || adapter === '-h') {
  console.log(usage);
  process.exit(0);
}

console.error(`Unknown adapter: ${adapter}`);
console.log(usage);
process.exit(1);
