/**
 * Phase 4.31 — offline, deterministic deviation replay. Every Milan benchmark journey (88 × car,
 * motorcycle, bicycle; routes from the archived Phase 4.30 benchmark payloads) is driven through
 * synthetic wrong turns, missed junctions, parallel streets and correct drives with GPS faults,
 * and replayed through one or more navigation processors. SYNTHETIC GPS: not iPhone evidence.
 *
 *   node scripts/navigation-deviation-bench.mjs --label=after deployed=<dir> p430=<dir> current=.
 * Each processor argument names a directory that contains `lib/`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { DEVIATION_SCENARIOS, buildDeviationDrive, replayDrive, routeTurns } from "../tests/helpers/deviation-scenarios.mjs";

const root = new URL("../", import.meta.url);
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "run";
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);
const processors = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((arg) => {
  const [name, dir] = arg.split("=");
  return { name, dir: path.resolve(dir) };
});
for (const p of processors) {
  p.module = await import(pathToFileURL(path.join(p.dir, "lib/navigation-fix-processor.ts")).href);
  p.progress = await import(pathToFileURL(path.join(p.dir, "lib/route-progress.ts")).href);
}
const { spatialRoadStore: store } = await import(new URL("lib/spatial-road-store.ts", root).href);
const { buildRouteProgressModel } = await import(new URL("lib/route-progress.ts", root).href);
const { distanceMeters } = await import(new URL("lib/navigation-fix-processor.ts", root).href);
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root), "utf8"));
const casesDir = new URL("outputs/phase425-benchmark/p430-final/cases/", root);
const seedOf = (text) => parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16);

const variants = [];
for (const kind of Object.keys(DEVIATION_SCENARIOS)) variants.push({ kind, reportHeading: true });
for (const kind of ["correct-good", "correct-canyon-multipath", "wrong-turn-mirrored", "missed-junction-straight", "parallel-street-45m"]) variants.push({ kind, reportHeading: false });

const rows = [];
let routes = 0, turnsTotal = 0, offRoad = 0, drives = 0;
for (const journey of fixture.journeys) {
  for (const mode of fixture.modes) {
    if (routes >= limit) break;
    let payload;
    try { payload = JSON.parse(gunzipSync(await readFile(new URL(`${journey.id}-${mode}.json.gz`, casesDir)))).payload; } catch { continue; }
    if (!payload?.fast) continue;
    const selected = payload.hasDistinctAlternative ? payload.safe : payload.fast;
    const instructions = selected.instructions ?? [];
    const model = buildRouteProgressModel(selected.coordinates, instructions, distanceMeters);
    const turns = routeTurns(selected.coordinates, model.instructions.map((entry) => entry.progressMeters)).slice(0, 2);
    routes += 1;
    turnsTotal += turns.length;
    for (const [turnIndex, turn] of turns.entries()) {
      for (const variant of variants) {
        const seed = seedOf(`${journey.id}|${mode}|${turnIndex}|${variant.kind}|${variant.reportHeading}`);
        const drive = await buildDeviationDrive({ store, route: selected.coordinates, turn, mode, kind: variant.kind, seed, reportHeading: variant.reportHeading });
        drives += 1;
        if (!drive.onRoad) offRoad += 1;
        const row = { id: journey.id, mode, turn: turnIndex, turnAngle: Math.round(turn.turn), kind: variant.kind, heading: variant.reportHeading, onRoad: drive.onRoad, results: {} };
        for (const p of processors) {
          const reroutes = replayDrive(p.module, p.progress.buildRouteProgressModel, selected.coordinates, instructions, drive, mode);
          const afterJunction = reroutes.filter((r) => r.truthMeters >= drive.junctionPathMeters - 5);
          const beforeJunction = reroutes.filter((r) => r.truthMeters < drive.junctionPathMeters - 5);
          const first = afterJunction[0];
          row.results[p.name] = {
            reroutes: reroutes.length,
            early: beforeJunction.length,
            detectedMeters: first ? Math.round(first.truthMeters - drive.junctionPathMeters) : null,
            detectedSeconds: first ? Math.round((first.seconds - drive.junctionTime) * 10) / 10 : null,
          };
        }
        rows.push(row);
      }
    }
  }
}

const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];
};
const summary = {};
for (const p of processors) {
  summary[p.name] = {};
  for (const variant of variants) {
    const key = `${variant.kind}${variant.reportHeading ? "" : " (no heading)"}`;
    const subset = rows.filter((r) => r.kind === variant.kind && r.heading === variant.reportHeading);
    const deviates = DEVIATION_SCENARIOS[variant.kind].deviates;
    const results = subset.map((r) => r.results[p.name]);
    if (deviates) {
      const detected = results.filter((r) => r.detectedMeters !== null);
      summary[p.name][key] = {
        drives: subset.length,
        detectedPercent: Math.round((detected.length / Math.max(1, subset.length)) * 1000) / 10,
        medianMetersAfterJunction: percentile(detected.map((r) => r.detectedMeters), 0.5),
        p90MetersAfterJunction: percentile(detected.map((r) => r.detectedMeters), 0.9),
        medianSeconds: percentile(detected.map((r) => r.detectedSeconds), 0.5),
        p90Seconds: percentile(detected.map((r) => r.detectedSeconds), 0.9),
        earlyFalseReroutes: results.reduce((a, r) => a + r.early, 0),
        byMode: Object.fromEntries(fixture.modes.map((mode) => {
          const m = subset.filter((r) => r.mode === mode).map((r) => r.results[p.name]);
          return [mode, Math.round((m.filter((r) => r.detectedMeters !== null).length / Math.max(1, m.length)) * 1000) / 10];
        })),
      };
    } else {
      const falsePositive = results.filter((r) => r.reroutes > 0);
      summary[p.name][key] = {
        drives: subset.length,
        falseRerouteDrives: falsePositive.length,
        falseReroutePercent: Math.round((falsePositive.length / Math.max(1, subset.length)) * 1000) / 10,
      };
    }
  }
}
const out = new URL("outputs/phase431/", root);
await mkdir(out, { recursive: true });
const report = { label, generatedAt: new Date().toISOString(), synthetic: true, routes, turns: turnsTotal, drives, straightFallbackDrives: offRoad,
  processors: processors.map((p) => p.name), summary, rows };
await writeFile(new URL(`deviation-bench-${label}.json`, out), JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ routes, turns: turnsTotal, drives, straightFallbackDrives: offRoad, summary }, null, 1));
