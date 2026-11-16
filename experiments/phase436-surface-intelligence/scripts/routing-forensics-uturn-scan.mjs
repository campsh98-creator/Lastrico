/**
 * Phase 4.36 routing forensics, Agent 1: where do Valhalla U-turn maneuvers (types 12/13) sit in the archived responses?
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-uturn-scan.mjs [archiveDir] [--out=file]
 *
 * For every archived FOSSGIS response (Phase 4.25-4.31 benchmark archive, 2160 files) it classifies each U-turn by request kind and by
 * position: within 150 m of the route start, within 150 m of the end, at a `through` waypoint (<= 40 m from the via point), or elsewhere.
 * Offline. Coordinates are never written out.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? new URL("../data/archive/responses/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const K = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const m = (a, b) => Math.hypot((a[0] - b[0]) * K((a[1] + b[1]) / 2), (a[1] - b[1]) * 110540);
function decode6(s) { let i = 0, la = 0, lo = 0; const o = []; while (i < s.length) { for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) la += d; else lo += d; } o.push([lo / 1e6, la / 1e6]); } return o; }
const kindOf = (b) => b.linear_cost_factors ? "penalised" : b.exclude_polygons ? "excluding" : b.locations.length > 2 ? "via-waypoint" : b.alternates ? "base-alternates" : "single";
const tally = {};
let trips = 0;
for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
  const e = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
  let body, data; try { body = JSON.parse(e.request.body); data = JSON.parse(e.body); } catch { continue; }
  const kind = kindOf(body);
  const t = (tally[kind] ??= { trips: 0, tripsWithUturn: 0, uturns: 0, atStart150: 0, atEnd150: 0, atVia40: 0, elsewhere: 0, firstManeuverIsUturn: 0, uturnInstructionStreets: {} });
  for (const trip of [data.trip, ...(data.alternates ?? []).map((a) => a.trip ?? a)].filter(Boolean)) {
    trips += 1; t.trips += 1;
    const leg = trip.legs[0]; const total = trip.summary.length * 1000;
    let cum = 0; let any = false;
    const vias = body.locations.slice(1, -1).map((l) => [l.lon, l.lat]);
    for (const leg of trip.legs) {
      const pts = decode6(leg.shape);
      for (const man of leg.maneuvers ?? []) {
        if (man.type === 12 || man.type === 13) {
          any = true; t.uturns += 1;
          const here = pts[man.begin_shape_index ?? 0];
          if (cum <= 150) t.atStart150 += 1;
          else if (total - cum <= 150) t.atEnd150 += 1;
          else if (vias.some((v) => m(v, here) <= 40)) t.atVia40 += 1;
          else t.elsewhere += 1;
        }
        cum += (man.length ?? 0) * 1000;
      }
    }
    if (any) t.tripsWithUturn += 1;
  }
}
for (const [k, t] of Object.entries(tally)) { t.shareTripsWithUturn = +(t.tripsWithUturn / t.trips).toFixed(3); delete t.uturnInstructionStreets; }
console.log(JSON.stringify({ trips, tally }, null, 1));
if (out) await writeFile(out, JSON.stringify({ trips, tally }, null, 1) + "\n");
