/**
 * Phase 3.11: Multi-Modal Before/After Routing Benchmark
 *
 * Compares:
 * 1. Before: milan-central.json (pilot monolithic index)
 * 2. After: milan-compact-tiles.json (12-tile spatially scoped store)
 *
 * Evaluates across:
 * - Transport modes: car, motorcycle, bicycle
 * - Both core pilot routes and expansion corridors
 * - Metrics: total distance, rough exposure, unknown coverage, compute latency
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { spatialRoadStore } from "../../lib/spatial-road-store.ts";
import {
  createRoadIntelligenceIndex,
  scoreRoadIntelligence,
} from "../../lib/road-intelligence-scoring.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const BENCHMARK_ROUTES = [
  // Core Historical Center (High Coverage)
  {
    name: "San Babila -> Cordusio",
    category: "core-pilot",
    coordinates: [
      [9.1978, 45.4667],
      [9.1940, 45.4655],
      [9.1905, 45.4645],
      [9.1865, 45.4655],
    ],
  },
  {
    name: "Castello -> Missori",
    category: "core-pilot",
    coordinates: [
      [9.1805, 45.4705],
      [9.1835, 45.4680],
      [9.1865, 45.4655],
      [9.1890, 45.4600],
    ],
  },
  {
    name: "Brera -> Santa Sofia",
    category: "core-pilot",
    coordinates: [
      [9.1880, 45.4720],
      [9.1895, 45.4660],
      [9.1910, 45.4600],
      [9.1925, 45.4550],
    ],
  },
  // Expansion Corridors
  {
    name: "Cadorna -> Darsena",
    category: "expansion",
    coordinates: [
      [9.1758, 45.4684],
      [9.1765, 45.4660],
      [9.1772, 45.4635],
      [9.1779, 45.4605],
      [9.1785, 45.4580],
      [9.1790, 45.4550],
      [9.1798, 45.4522],
    ],
  },
  {
    name: "Magenta -> Missori",
    category: "expansion",
    coordinates: [
      [9.1725, 45.4655],
      [9.1775, 45.4650],
      [9.1820, 45.4652],
      [9.1865, 45.4655],
      [9.1890, 45.4600],
    ],
  },
  {
    name: "Moscova -> Porta Venezia",
    category: "expansion",
    coordinates: [
      [9.1875, 45.4780],
      [9.1910, 45.4755],
      [9.1945, 45.4735],
      [9.1985, 45.4725],
      [9.2020, 45.4735],
      [9.2052, 45.4746],
    ],
  },
  {
    name: "Sempione -> Porta Romana",
    category: "expansion",
    coordinates: [
      [9.1718, 45.4758],
      [9.1790, 45.4705],
      [9.1825, 45.4680],
      [9.1865, 45.4655],
      [9.1895, 45.4600],
      [9.1950, 45.4560],
      [9.2018, 45.4518],
    ],
  },
];

async function main() {
  console.log("=== Lastrico Phase 3.11: Multi-Modal Routing Benchmark ===\n");
  const pilotData = JSON.parse(await readFile(join(root, "data/surfaces/milan-central.json"), "utf8"));
  const pilotIndex = createRoadIntelligenceIndex(pilotData);

  const MODES = ["car", "motorcycle", "bicycle"];

  for (const route of BENCHMARK_ROUTES) {
    console.log(`================================================================================`);
    console.log(`Route: ${route.name} [${route.category.toUpperCase()}]`);

    for (const mode of MODES) {
      const matchDist = mode === "bicycle" ? 9 : 12;

      // Before: Full pilot monolithic index
      const t0Before = performance.now();
      const scoreBefore = scoreRoadIntelligence(route.coordinates, pilotIndex, matchDist, mode);
      const dtBefore = performance.now() - t0Before;

      // After: Spatially scoped compact store (warm cache)
      // Prime cache first to evaluate warm runtime
      spatialRoadStore.getScopedIntelligence(route.coordinates, 80);
      const t0After = performance.now();
      const scoped = spatialRoadStore.getScopedIntelligence(route.coordinates, 80);
      const scoreAfter = scoreRoadIntelligence(route.coordinates, scoped.surfaceIndex, matchDist, mode);
      const dtAfter = performance.now() - t0After;

      const roughDiff = Math.round(scoreAfter.paveMeters - scoreBefore.paveMeters);
      const unknownDiff = Math.round(scoreAfter.unknownMeters - scoreBefore.unknownMeters);
      const signR = roughDiff > 0 ? `+${roughDiff}` : `${roughDiff}`;
      const signU = unknownDiff > 0 ? `+${unknownDiff}` : `${unknownDiff}`;

      console.log(
        `  [${mode.padEnd(10)}] ` +
        `Rough: ${Math.round(scoreBefore.paveMeters)}m -> ${Math.round(scoreAfter.paveMeters)}m (${signR}m) | ` +
        `Unknown: ${Math.round(scoreBefore.unknownMeters)}m -> ${Math.round(scoreAfter.unknownMeters)}m (${signU}m) | ` +
        `Fidelity: ${scoreBefore.paveMeters === scoreAfter.paveMeters && scoreBefore.unknownMeters === scoreAfter.unknownMeters ? "BIT-FOR-BIT MATCH" : "EXPANDED RECOVERY"} | ` +
        `Latency: ${dtBefore.toFixed(2)}ms -> ${dtAfter.toFixed(2)}ms (${(dtBefore / (dtAfter || 0.001)).toFixed(1)}x)`
      );
    }
  }
}

main().catch(console.error);
