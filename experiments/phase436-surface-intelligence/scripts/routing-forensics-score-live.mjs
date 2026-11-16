/**
 * Phase 4.36 routing forensics, Agent 1: score the cached live provider routes (landmark requests only) with the PRODUCTION scorer
 * (lib/road-intelligence-scoring.ts + local Milan surface tiles), the way /api/routes would. Offline (reads data/live-cache/).
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-score-live.mjs [--out=file]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { getSpatialRoadStore } from "../../../lib/spatial-road-store.ts";
import { EdgeMemo, scoreRoadIntelligence } from "../../../lib/road-intelligence-scoring.ts";
import { pub } from "./lib/osm-local.mjs";
import { extractRoughSlices } from "../../../lib/surface-aware-routing.ts";

const cache = new URL("../data/live-cache/", import.meta.url);
const decode6 = (s) => { let i = 0, la = 0, lo = 0; const o = []; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) la += d; else lo += d; } o.push([lo / 1e6, la / 1e6]); } return o; };
const store = await getSpatialRoadStore("milan");
const rows = [];
for (const f of (await readdir(cache)).filter((x) => x.endsWith(".json"))) {
  const e = JSON.parse(await readFile(new URL(f, cache), "utf8"));
  if (e.host !== "valhalla1.openstreetmap.de") continue;
  let data; try { data = JSON.parse(e.body); } catch { continue; }
  for (const [ti, trip] of [data.trip, ...(data.alternates ?? []).map((a) => a.trip ?? a)].filter(Boolean).entries()) {
    const coords = trip.legs.flatMap((l, i) => (i ? decode6(l.shape).slice(1) : decode6(l.shape)));
    await store.preloadTiles(store.getTileKeysForCoordinates(coords, 50));
    const sc = store.getScopedIntelligence(coords, 50);
    const s = scoreRoadIntelligence(coords, sc.surfaceIndex, 12, "car", false, { terminalWalkingForBicycle: false, authorisedZtl: new Set(), edgeMemo: new EdgeMemo() });
    const rough = s.roughSegmentIndices ?? new Set();
    rows.push({ key: e.key.slice(0, 12), utc: e.startedAt, trip: ti, km: +trip.summary.length.toFixed(3), min: +(trip.summary.time / 60).toFixed(2),
      engine: { confirmed: s.confirmedMeters, probable: s.probableMeters, unknown: s.unknownMeters, weighted: s.weightedPaveMeters, blockingRestriction: s.blockingRestrictionMeters },
      roughSlicesAtMin25: extractRoughSlices(coords, (_a, _b, i) => rough.has(i), 25).length, roughSlicesAtMin15: extractRoughSlices(coords, (_a, _b, i) => rough.has(i), 15).length,
      roughNames: [...(s.roughSegmentFeatures?.values() ?? [])].map((x) => `${pub(x.name)}:${x.material}`).filter((v, i, a) => a.indexOf(v) === i) });
  }
}
console.log(JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
const o = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (o) await writeFile(o, JSON.stringify(rows, null, 1) + "\n");
