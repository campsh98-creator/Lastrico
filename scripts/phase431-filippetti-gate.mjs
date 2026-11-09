/**
 * Phase 4.31 release gate — the Porta Romana / Viale Angelo Filippetti field case, through the
 * DEPLOYED handler (the 03a6776e release copy) and the LOCAL handler, for planning and for
 * navigation reroutes, from the assumed origin and from points along the approach to Piazzale
 * Medaglie d'Oro. Provider responses are archived (FOSSGIS-paced capture with --live).
 *
 *   node scripts/phase431-filippetti-gate.mjs <deployed-release-dir> [--live]
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server.js";
import { installArchivedProvider } from "./lib/archived-provider.mjs";

const releaseDir = path.resolve(process.argv[2]);
const live = process.argv.includes("--live");
const provider = installArchivedProvider({ live });
const handlers = {
  deployed: (await (await import(pathToFileURL(path.join(releaseDir, "tests/helpers/load-api.mjs")).href)).loadApi("app/api/routes/route.ts")).GET,
  local: (await (await import(new URL("../tests/helpers/load-api.mjs", import.meta.url).href)).loadApi("app/api/routes/route.ts")).GET,
};
const { spatialRoadStore } = await import(new URL("../lib/spatial-road-store.ts", import.meta.url).href);

const PROMESSI_SPOSI = [9.1734728, 45.4349746];
// Points on real Milan geometry: the assumed origin, then the approach the screenshot showed.
async function pointOn(name, fraction = 0.5) {
  const keys = spatialRoadStore.getTileKeysForCoordinates([[9.203, 45.457]], 1500);
  await spatialRoadStore.preloadTiles(keys);
  const segments = keys.flatMap((key) => spatialRoadStore.getTileSegments(key)).filter((s) => s.name === name && s.lengthMeters > 10);
  segments.sort((a, b) => b.coordinates[0][1] - a.coordinates[0][1]);
  const segment = segments[Math.floor(fraction * (segments.length - 1))];
  const [a, b] = segment.coordinates;
  return [Number(((a[0] + b[0]) / 2).toFixed(6)), Number(((a[1] + b[1]) / 2).toFixed(6))];
}
const starts = [
  { label: "Corso di Porta Vittoria (origine ipotizzata)", at: [9.2025, 45.4625] },
  { label: "Viale Regina Margherita", at: await pointOn("Viale Regina Margherita", 0.5) },
  { label: "Viale Emilio Caldara (inizio)", at: await pointOn("Viale Emilio Caldara", 0.2) },
  { label: "Viale Emilio Caldara (prima di Medaglie d'Oro)", at: await pointOn("Viale Emilio Caldara", 0.85) },
];
const filippettiKeys = spatialRoadStore.getTileKeysForCoordinates([[9.199, 45.452]], 600);
await spatialRoadStore.preloadTiles(filippettiKeys);
const filippetti = filippettiKeys.flatMap((key) => spatialRoadStore.getTileSegments(key)).filter((s) => s.name === "Viale Angelo Filippetti");
const sabotino = filippettiKeys.flatMap((key) => spatialRoadStore.getTileSegments(key)).filter((s) => s.name === "Viale Sabotino");
const metersOn = (coordinates, segments) => {
  let meters = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1], b = coordinates[i];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const near = segments.some(({ coordinates: [c, d] }) => {
      const dx = (d[0] - c[0]) * 78_000, dy = (d[1] - c[1]) * 110_540, px = (m[0] - c[0]) * 78_000, py = (m[1] - c[1]) * 110_540;
      const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
      return Math.hypot(px - t * dx, py - t * dy) < 4;
    });
    if (near) meters += Math.hypot((b[0] - a[0]) * 78_000, (b[1] - a[1]) * 110_540);
  }
  return Math.round(meters);
};
const describe = (route) => route && ({ minutes: Math.round(route.minutes * 60) / 60, seconds: Math.round(route.minutes * 60), km: Math.round(route.distance * 100) / 100,
  confirmedPave: route.confirmedPaveMeters, filippettiMeters: metersOn(route.coordinates, filippetti), sabotinoMeters: metersOn(route.coordinates, sabotino) });

const rows = [];
for (const start of starts) {
  for (const mode of ["car", "motorcycle"]) {
    for (const navigation of [false, true]) {
      for (const [version, GET] of Object.entries(handlers)) {
        provider.reset();
        const params = new URLSearchParams({ area: "milan", start: start.at.join(","), end: PROMESSI_SPOSI.join(","), mode, avoid: "strong" });
        if (navigation) params.set("navigation", "1");
        if (version === "local") params.set("departure", "2026-11-09T12:00");
        const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
        const payload = await response.json();
        const safeSource = payload.candidateDiagnostics?.find((c) => payload.safe && c.seconds === Math.round(payload.safe.minutes * 60) && c.distance === Math.round(payload.safe.distance * 1000))?.source ?? null;
        const row = { start: start.label, at: start.at, mode, navigation, version, status: response.status,
          hasDistinctAlternative: payload.hasDistinctAlternative ?? null,
          fast: describe(payload.fast), antiPave: payload.hasDistinctAlternative ? describe(payload.safe) : null, antiPaveSource: payload.hasDistinctAlternative ? safeSource : null,
          candidates: (payload.candidateDiagnostics ?? []).map((c) => ({ source: c.source, seconds: c.seconds, pave: c.paveMeters, risk: Math.round(c.riskMeters) })),
          providerCalls: provider.state.calls.length };
        rows.push(row);
        const shown = row.antiPave ?? row.fast;
        console.log(`${version.padEnd(8)} ${navigation ? "reroute" : "plan   "} ${mode.padEnd(10)} ${start.label.padEnd(46)} → ${row.hasDistinctAlternative ? `ANTI-PAVÉ (${row.antiPaveSource})` : "solo più rapido"} | shown ${shown?.confirmedPave} m pavé, Filippetti ${shown?.filippettiMeters} m, Sabotino ${shown?.sabotinoMeters} m, ${shown?.seconds}s | fast ${row.fast?.confirmedPave} m ${row.fast?.seconds}s | candidates ${row.candidates.map((c) => c.source).join(",")}`);
      }
    }
  }
}
provider.restore();
await writeFile(new URL("../outputs/phase431/filippetti-gate.json", import.meta.url), JSON.stringify({ note: "deployed = 03a6776e release copy; local = working tree. Origin assumed; approach points are on real OSM geometry.", rows }, null, 1) + "\n");
if (provider.state.missing.length) process.exitCode = 1;
