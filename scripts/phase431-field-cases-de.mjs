/**
 * Phase 4.31 — field cases D and E (Corso di Porta Vittoria, Viale Beatrice d'Este, "Via Carlo…",
 * Porta Romana / Viale Angelo Filippetti), reconstructed with the real handler and the real
 * provider. The person's origin was not recorded: a point on Corso di Porta Vittoria and the
 * person's usual destination (Largo Promessi Sposi) are ASSUMED and labelled as such.
 *
 * For D, the "later alternative" via Via Carlo Patellani / Vittadini is forced with a provider
 * waypoint and scored with Lastrico's own surface engine, so it can be compared with what the app
 * proposed. (For E, the Filippetti route turned out to be the app's own anti-pavé route.)
 *
 *   node scripts/phase431-field-cases-de.mjs [--live]
 */
import { writeFile } from "node:fs/promises";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { installArchivedProvider } from "./lib/archived-provider.mjs";

const live = process.argv.includes("--live");
const provider = installArchivedProvider({ live });
const { GET } = await loadApi("app/api/routes/route.ts");
const { spatialRoadStore } = await import(new URL("../lib/spatial-road-store.ts", import.meta.url).href);
const { scoreRoadIntelligence } = await import(new URL("../lib/road-intelligence-scoring.ts", import.meta.url).href);
const { parseLocalDeparture } = await import(new URL("../lib/access-conditions.ts", import.meta.url).href);

const PORTA_VITTORIA = [9.2025, 45.4625]; // on Corso di Porta Vittoria (assumed origin)
const PROMESSI_SPOSI = [9.1734728, 45.4349746];
// Case D variant: from Viale Beatrice d'Este south on Via Carlo Patellani / Via Carlo Vittadini
// (the "Via Carlo…" streets that leave the ring there; the person's street was not confirmed).
const VITTADINI = [9.19435, 45.4487];
const departure = "2026-11-09T12:00";
const decode = (str) => { let i = 0, lat = 0, lon = 0; const out = []; while (i < str.length) { for (const k of [0, 1]) { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); const d = (r & 1) ? ~(r >> 1) : (r >> 1); if (k === 0) lat += d; else lon += d; } out.push([lon / 1e6, lat / 1e6]); } return out; };
const streets = (route) => [...new Set((route.instructions ?? []).map((i) => i.roadName).filter(Boolean))];
const summary = (route) => ({ minutes: Math.round(route.minutes * 10) / 10, km: Math.round(route.distance * 100) / 100,
  confirmedPave: route.confirmedPaveMeters, probablePave: route.probablePaveMeters, unknown: route.unknownSurfaceMeters, streets: streets(route) });
const out = { assumption: "origin on Corso di Porta Vittoria and destination Largo Promessi Sposi are assumed; the field trace was not recorded", departure, results: [] };

for (const mode of ["car", "motorcycle"]) {
  provider.reset();
  const params = new URLSearchParams({ area: "milan", start: PORTA_VITTORIA.join(","), end: PROMESSI_SPOSI.join(","), mode, avoid: "strong", departure });
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  const app = { fast: summary(payload.fast), antiPave: payload.hasDistinctAlternative ? summary(payload.safe) : null, candidates: payload.alternativesAnalyzed,
    sources: (payload.candidateDiagnostics ?? []).map((c) => ({ source: c.source, seconds: c.seconds, meters: c.distance, pave: c.paveMeters, risk: Math.round(c.riskMeters) })) };

  // The Filippetti variant: same end points, a through point on its westbound carriageway.
  provider.reset();
  const costing = mode === "car" ? "auto" : "motorcycle";
  const body = JSON.stringify({
    locations: [
      { lon: PORTA_VITTORIA[0], lat: PORTA_VITTORIA[1], type: "break" },
      { lon: VITTADINI[0], lat: VITTADINI[1], type: "through" },
      { lon: PROMESSI_SPOSI[0], lat: PROMESSI_SPOSI[1], type: "break" },
    ],
    costing, units: "kilometers", directions_options: { units: "kilometers", language: "it-IT" },
  });
  const raw = await (await fetch("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json" }, body })).json();
  const legs = raw.trip?.legs ?? [];
  const coordinates = legs.flatMap((leg, index) => decode(leg.shape).slice(index ? 1 : 0));
  const tiles = spatialRoadStore.getTileKeysForCoordinates(coordinates, 50);
  await spatialRoadStore.preloadTiles(tiles);
  const scoped = spatialRoadStore.getScopedIntelligence(coordinates, 50);
  const score = scoreRoadIntelligence(coordinates, scoped.surfaceIndex, mode === "car" ? 12 : 11, mode, false,
    { terminalWalkingForBicycle: true, departure: parseLocalDeparture(departure) });
  const variant = { minutes: Math.round((raw.trip?.summary?.time ?? 0) / 6) / 10, km: Math.round((raw.trip?.summary?.length ?? 0) * 100) / 100,
    confirmedPave: score.confirmedMeters, probablePave: score.probableMeters, unknown: score.unknownMeters,
    blockingRestrictionMeters: score.blockingRestrictionMeters,
    streets: [...new Set(legs.flatMap((leg) => leg.maneuvers.flatMap((m) => m.street_names ?? [])))] };
  out.results.push({ mode, app, viaCarloVariant: variant });
  const shown = app.antiPave ?? app.fast;
  console.log(`${mode}: app ${app.antiPave ? "anti-pavé" : "fastest"} ${shown.minutes} min ${shown.km} km conf ${shown.confirmedPave} prob ${shown.probablePave} | streets ${shown.streets.join(" → ").slice(0, 260)}`);
  console.log(`   fastest ${app.fast.minutes} min conf ${app.fast.confirmedPave} | streets ${app.fast.streets.join(" → ").slice(0, 200)}`);
  console.log(`   Via Carlo variant ${variant.minutes} min ${variant.km} km conf ${variant.confirmedPave} prob ${variant.probablePave} blocking ${variant.blockingRestrictionMeters} | ${variant.streets.join(" → ").slice(0, 300)}`);
}
provider.restore();
await writeFile(new URL("../outputs/phase431/field-cases-de.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
