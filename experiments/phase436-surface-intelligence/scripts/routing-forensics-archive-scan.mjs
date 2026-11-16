/**
 * Phase 4.36 routing forensics, Agent 1: scan the archived FOSSGIS Valhalla responses (Phase 4.25-4.31)
 * for routes that use the streets of the Piazzale Lodi corridor, and count U-turn maneuvers by request kind.
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-archive-scan.mjs [archiveDir] [--out=file]
 *
 * archiveDir defaults to experiments/phase436-surface-intelligence/data/archive/responses (untar of
 * outputs/phase425-benchmark/provider-responses.tar.gz; sha256 acea0e12...b8356). Offline; no coordinates of the GPS trace.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? new URL("../data/archive/responses/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
import { pub } from "./lib/osm-local.mjs";
const NAMES = ["Via Friuli", "Viale Umbria", "Piazzale Lodi", "Corso Lodi", "Via Lazzaro Papi", "Viale Isonzo", "Viale Filippetti"];
// Privacy: the origin street is not in this list and is never written out by name.
const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
const stats = { files: files.length, valhalla: 0, withUturn: 0, uturnManeuvers: 0, byKind: {}, corridor: [] };
const kindOf = (body) => body.linear_cost_factors ? "penalised" : body.exclude_polygons ? "excluding" : (body.locations?.length ?? 0) > 2 ? "via-waypoint" : body.alternates ? "base-alternates" : "single";
for (const f of files) {
  const entry = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
  if (!entry.request?.url?.includes("valhalla")) continue;
  stats.valhalla += 1;
  let body; try { body = JSON.parse(entry.request.body); } catch { continue; }
  let data; try { data = JSON.parse(entry.body); } catch { continue; }
  const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip ?? a)].filter(Boolean);
  const kind = kindOf(body);
  stats.byKind[kind] ??= { requests: 0, trips: 0, maneuvers: 0, uturns: 0, tripsWithUturn: 0 };
  stats.byKind[kind].requests += 1;
  for (const [ti, trip] of trips.entries()) {
    stats.byKind[kind].trips += 1;
    const names = new Set(); let uturns = 0, maneuvers = 0;
    for (const leg of trip.legs ?? []) for (const m of leg.maneuvers ?? []) {
      maneuvers += 1;
      if (m.type === 12 || m.type === 13) { uturns += 1; }
      for (const n of m.street_names ?? []) if (NAMES.includes(n)) names.add(n);
    }
    stats.byKind[kind].maneuvers += maneuvers; stats.byKind[kind].uturns += uturns;
    if (uturns) { stats.byKind[kind].tripsWithUturn += 1; stats.withUturn += 1; stats.uturnManeuvers += uturns; }
    if (names.size) stats.corridor.push({ file: f.slice(0, 12), kind, trip: ti, locations: body.locations.length, km: +trip.summary.length.toFixed(2), min: +(trip.summary.time / 60).toFixed(1), names: [...names], uturns, uturnStreets: (trip.legs ?? []).flatMap((l) => l.maneuvers ?? []).filter((m) => m.type === 12 || m.type === 13).map((m) => pub((m.street_names ?? [""])[0] || "")) });
  }
}
console.log(JSON.stringify({ ...stats, corridor: undefined, corridorTrips: stats.corridor.length }, null, 1));
for (const c of stats.corridor.filter((c) => c.uturns)) console.log(JSON.stringify(c));
if (out) await writeFile(out, JSON.stringify(stats, null, 1) + "\n");
