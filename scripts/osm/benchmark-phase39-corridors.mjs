/**
 * Phase 3.9 Benchmark:
 * Evaluates the 4 Milan expansion corridors across all transport modes (car, motorcycle, bicycle)
 * comparing:
 * 1. Old baseline: milan-central.json (pilot-only bounds [9.180, 45.455, 9.200, 45.475])
 * 2. New spatially scoped: milan-compact-tiles.json (12-tile compact store with western & eastern expansion)
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

const CORRIDORS = [
  {
    id: "cadorna-darsena",
    name: "Cadorna -> Darsena",
    modeProfiles: ["car", "motorcycle", "bicycle"],
    // Cadorna -> Carducci -> De Amicis -> Resistenza Partigiana -> Conca del Naviglio -> Darsena
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
    id: "moscova-porta-venezia",
    name: "Moscova -> Porta Venezia",
    modeProfiles: ["car", "motorcycle", "bicycle"],
    // Moscova -> Fatebenefratelli -> Piazza Cavour -> Palestro -> Porta Venezia
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
    id: "sempione-porta-romana",
    name: "Sempione -> Porta Romana",
    modeProfiles: ["car", "motorcycle", "bicycle"],
    // Arco della Pace -> Cairoli -> Cordusio -> Missori -> Corso di Porta Romana
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
  {
    id: "magenta-missori",
    name: "Magenta -> Missori",
    modeProfiles: ["car", "motorcycle", "bicycle"],
    // Corso Magenta (Santa Maria delle Grazie) -> Meravigli -> Cordusio -> Missori
    coordinates: [
      [9.1725, 45.4655],
      [9.1775, 45.4650],
      [9.1820, 45.4652],
      [9.1865, 45.4655],
      [9.1890, 45.4600],
    ],
  },
];

async function runBenchmark() {
  console.log("=== Lastrico Phase 3.9: Corridor Benchmark & Verification ===");
  console.log(`Loaded Compact Store: ${spatialRoadStore.tileCount} tiles, ${spatialRoadStore.totalSegments} segments`);

  // Load old pilot dataset
  const oldRaw = JSON.parse(await readFile(join(root, "data/surfaces/milan-central.json"), "utf8"));
  console.log(`Loaded Old Pilot Dataset: ${oldRaw.length} segments`);
  const oldIndex = createRoadIntelligenceIndex(oldRaw);

  const results = [];

  for (const corridor of CORRIDORS) {
    for (const mode of corridor.modeProfiles) {
      // 1. Old Pilot Scoring
      const t0Old = performance.now();
      const oldScore = scoreRoadIntelligence(corridor.coordinates, oldIndex, 12, mode);
      const tOld = performance.now() - t0Old;

      // 2. Spatially Scoped Scoring
      const t0Scoped = performance.now();
      const tileKeys = spatialRoadStore.getTileKeysForCoordinates(corridor.coordinates, 80);
      const scoped = spatialRoadStore.getScopedIntelligence(corridor.coordinates, 80);
      const scopedScore = scoreRoadIntelligence(corridor.coordinates, scoped.surfaceIndex, 12, mode);
      const tScoped = performance.now() - t0Scoped;

      results.push({
        corridor: corridor.name,
        corridorId: corridor.id,
        mode,
        tilesLoaded: tileKeys.join(", "),
        segmentsQueried: scoped.roads.length,
        totalLengthM: Math.round(scopedScore.totalMeters),
        old: {
          roughM: Math.round(oldScore.roughMeters),
          smoothM: Math.round(oldScore.smoothMeters),
          unknownM: Math.round(oldScore.unknownMeters),
          unknownPct: Math.round((oldScore.unknownMeters / (oldScore.totalMeters || 1)) * 100),
          latencyMs: Number(tOld.toFixed(3)),
        },
        new: {
          roughM: Math.round(scopedScore.roughMeters),
          smoothM: Math.round(scopedScore.smoothMeters),
          unknownM: Math.round(scopedScore.unknownMeters),
          unknownPct: Math.round((scopedScore.unknownMeters / (scopedScore.totalMeters || 1)) * 100),
          latencyMs: Number(tScoped.toFixed(3)),
        },
      });
    }
  }

  console.log("\n--- Corridor Benchmark Summary ---");
  for (const res of results) {
    const unknownDiff = res.new.unknownPct - res.old.unknownPct;
    const diffSign = unknownDiff <= 0 ? `${unknownDiff}%` : `+${unknownDiff}%`;
    console.log(
      `[${res.corridorId}] mode: ${res.mode.padEnd(10)} | ` +
      `tiles: ${res.tilesLoaded.padEnd(24)} | ` +
      `segs: ${String(res.segmentsQueried).padStart(5)} | ` +
      `old unknown: ${String(res.old.unknownPct).padStart(3)}% (${res.old.unknownM}m) -> ` +
      `new unknown: ${String(res.new.unknownPct).padStart(3)}% (${res.new.unknownM}m) [diff: ${diffSign}] | ` +
      `latency: ${res.new.latencyMs.toFixed(2)}ms (vs old ${res.old.latencyMs.toFixed(2)}ms)`
    );
  }

  return results;
}

runBenchmark().catch(console.error);
