/**
 * Phase 4.36 routing forensics, Agent 1: does the planner's anti-pavé penalised search have anything to target on route 0?
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-slice-check.mjs <trace.json> [--out=file]
 *
 * app/api/routes/route.ts:688 builds the penalised search from extractRoughSlices(fastestBase.coordinates, isSegmentRough, 25):
 * only rough slices of at least 25 m (sum of vertex-to-vertex lengths) are penalised. This scores route 0 and route 1 of the
 * trace with the production scorer and the local Milan surface tiles and prints the slice lengths at several thresholds.
 * Local only; output has no coordinates.
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSpatialRoadStore } from "../../../lib/spatial-road-store.ts";
import { EdgeMemo, scoreRoadIntelligence } from "../../../lib/road-intelligence-scoring.ts";
import { extractRoughSlices, pointDistanceMeters, buildLinearCostFactors } from "../../../lib/surface-aware-routing.ts";

const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const trace = JSON.parse(await readFile(path, "utf8"));
const store = await getSpatialRoadStore("milan");
const slen = (s) => s.slice(1).reduce((t, p, i) => t + pointDistanceMeters(s[i], p), 0);
const result = {};
for (const [name, route] of [["route0", trace.routes[0]], ["route1", trace.routes[1]]]) {
  const coords = route.coordinates;
  await store.preloadTiles(store.getTileKeysForCoordinates(coords, 50));
  const scoped = store.getScopedIntelligence(coords, 50);
  const s = scoreRoadIntelligence(coords, scoped.surfaceIndex, 12, "car", false, { terminalWalkingForBicycle: false, authorisedZtl: new Set(), edgeMemo: new EdgeMemo() });
  const rough = s.roughSegmentIndices ?? new Set();
  const at = {};
  for (const min of [25, 24, 20, 15, 10, 0]) at[`min${min}`] = extractRoughSlices(coords, (_p, _c, i) => rough.has(i), min).map((x) => +slen(x).toFixed(2));
  const { factors, totalPenalizedMeters } = buildLinearCostFactors(extractRoughSlices(coords, (_p, _c, i) => rough.has(i), 25), 15, 4);
  result[name] = {
    vertices: coords.length, paveMeters: s.paveMeters, confirmedMeters: s.confirmedMeters, probableMeters: s.probableMeters, weightedPaveMeters: s.weightedPaveMeters,
    unknownMeters: s.unknownMeters, totalMeters: s.totalMeters, roughSegmentCount: rough.size, roughSliceLengthsMetersByMinimum: at,
    penalisedFactorsWithMin25: factors.length, penalisedMetersWithMin25: totalPenalizedMeters,
    roughFeatures: [...(s.roughSegmentFeatures?.values() ?? [])].map((f) => `${f.name}:${f.material}`).filter((v, i, a) => a.indexOf(v) === i),
  };
}
console.log(JSON.stringify(result, null, 1));
if (out) await writeFile(out, JSON.stringify(result, null, 1) + "\n");
