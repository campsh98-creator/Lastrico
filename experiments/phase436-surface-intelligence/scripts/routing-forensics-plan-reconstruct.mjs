/**
 * Phase 4.36 routing forensics, Agent 1: offline reconstruction of the planning decision at fix 0 of the return trace.
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-plan-reconstruct.mjs <trace.json> \
 *        --scenario=base-only|with-friuli-first|route1-only [--navigation] [--out=<file.json>]
 *
 * The production /api/routes handler (app/api/routes/route.ts, loaded by tests/helpers/load-api.mjs) is run with a
 * STUB provider: globalThis.fetch is replaced, nothing leaves the machine. The stub answers the first Valhalla request with
 * route 0 of the trace (what the plan really used: geometry, maneuvers, 4.703 km, 15.63 min) and answers every later
 * request (penalised search, detour waypoints) with HTTP 503, while logging what the handler asked for. This shows:
 *   - the scoring components the planner computed for route 0 (pavé, risk, unknown, confirmed/probable),
 *   - whether the anti-pavé penalised search and the detour waypoints would have been requested, and with what size,
 *   - with `with-friuli-first`: what the engine does when a Via-Friuli-first candidate (route 0 up to the Via Friuli
 *     crossing, then route 1) IS in the candidate pool (the candidate the provider did not return).
 * Output has no coordinates (metres, counts, ids, street names of the shared corridor only).
 */
import { readFile, writeFile } from "node:fs/promises";
import { loadHandler } from "./lib/handler-loader.mjs";
import { encodePolyline6 } from "../../../lib/surface-aware-routing.ts";
import { distanceMeters } from "../../../lib/navigation-fix-processor.ts";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const scenario = args.find((a) => a.startsWith("--scenario="))?.slice(11) ?? "base-only";
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
if (!path) { console.error("usage: routing-forensics-plan-reconstruct.mjs <trace.json> --scenario=base-only|with-friuli-first [--out=file]"); process.exit(2); }
const trace = JSON.parse(await readFile(path, "utf8"));
const [r0, r1] = trace.routes;
const len = (cs) => cs.slice(1).reduce((s, p, i) => s + distanceMeters(cs[i], p), 0);

const TYPE = (ins) => ins.type === "depart" ? 1 : ins.type === "arrive" ? 4 : ins.type === "roundabout" ? 26 : ins.type === "roundabout exit" ? 27
  : ins.modifier === "right" ? 10 : ins.modifier === "left" ? 15 : 8;
function toTrip(coordinates, instructions, minutes, km) {
  const maneuvers = instructions.map((ins) => {
    const begin = Math.max(0, coordinates.findIndex((c) => c[0] === ins.location[0] && c[1] === ins.location[1]));
    return { type: TYPE(ins), instruction: ins.text, street_names: ins.roadName ? [ins.roadName] : [], length: ins.distance / 1000, time: 0,
      begin_shape_index: begin, end_shape_index: begin, ...(ins.exit ? { roundabout_exit_count: ins.exit } : {}) };
  });
  maneuvers.forEach((m, i) => { m.end_shape_index = i + 1 < maneuvers.length ? maneuvers[i + 1].begin_shape_index : coordinates.length - 1; });
  return { status: 0, summary: { time: minutes * 60, length: km }, legs: [{ shape: encodePolyline6(coordinates), maneuvers }] };
}
const trip0 = toTrip(r0.coordinates, r0.instructions, r0.minutes, r0.distanceKm);
const trip1 = toTrip(r1.coordinates, r1.instructions, r1.minutes, r1.distanceKm);
const navigation = args.includes("--navigation");

// The Via-Friuli-first candidate: route 0 up to the Via Friuli crossing (vertex 4, 65 m), then straight along Via Friuli to the first vertex of route 1.
// Added time is an assumption (126 m at 30 km/h + 7 s turn); it is varied with --extra-seconds.
const extraSeconds = Number(args.find((a) => a.startsWith("--extra-seconds="))?.slice(16) ?? 22);
const junctionIndex = 4;
const friuliNodes = []; // intermediate Via Friuli shape points are not needed: Via Friuli is straight over these 60 m
const spliced = [...r0.coordinates.slice(0, junctionIndex + 1), ...friuliNodes, ...r1.coordinates];
const splicedInstr = [
  { ...r0.instructions[0], distance: len(r0.coordinates.slice(0, junctionIndex + 1)), id: "s0" },
  { id: "s1", text: "Svolta a destra su Via Friuli.", roadName: "Via Friuli", distance: len([r0.coordinates[junctionIndex], ...friuliNodes, r1.coordinates[0]]) + r1.instructions[0].distance,
    location: r0.coordinates[junctionIndex], type: "turn", modifier: "right", direction: "right" },
  ...r1.instructions.slice(1).map((i, k) => ({ ...i, id: `s${k + 2}` })),
];
const tripF = toTrip(spliced, splicedInstr, r1.minutes + extraSeconds / 60, len(spliced) / 1000);
tripF.summary.length = len(spliced) / 1000;

const calls = [];
const nativeFetch = globalThis.fetch;
const decodeLen = (shape) => { // polyline6 length in metres, for the penalised slices
  let i = 0, lat = 0, lon = 0; const pts = [];
  while (i < shape.length) { for (const t of ["lat", "lon"]) { let r = 0, s = 0, b; do { b = shape.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (t === "lat") lat += d; else lon += d; } pts.push([lon / 1e6, lat / 1e6]); }
  return len(pts);
};
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    try {
      const body = JSON.parse(init.body ?? "{}");
      const kind = body.linear_cost_factors ? "penalised-search" : body.exclude_polygons ? "exclude" : (body.locations?.length ?? 0) > 2 ? "via-waypoint-detour" : "base";
      const entry = { n: calls.length + 1, kind, locations: body.locations?.map((l) => l.type), alternates: body.alternates, costing: body.costing,
        costingOptions: body.costing_options, hasHeading: body.locations?.some((l) => "heading" in l) ?? false };
      if (body.linear_cost_factors) entry.factors = body.linear_cost_factors.map((f) => ({ factor: f.factor, meters: Math.round(decodeLen(f.shape)) }));
      if (kind === "via-waypoint-detour") {
        // distance of the via point from the start and from route 0 (metres); no coordinates are kept
        const via = [body.locations[1].lon, body.locations[1].lat];
        entry.viaFromStartMeters = Math.round(distanceMeters(r0.coordinates[0], via));
        entry.viaFromRoute0Meters = Math.round(Math.min(...r0.coordinates.map((c) => distanceMeters(c, via))));
      }
      calls.push(entry);
      if (kind === "base") {
        const payload = scenario === "with-friuli-first" ? { trip: tripF, alternates: [{ trip: trip0 }] } : scenario === "route1-only" ? { trip: trip1 } : { trip: trip0 };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 503 });
    } finally { installFetch(); }
  };
}
installFetch();
const { GET } = await loadHandler("app/api/routes/route.ts");
let payload;
try {
  const params = new URLSearchParams({ area: "milan", start: (scenario === "route1-only" ? r1.coordinates[0] : r0.coordinates[0]).join(","), end: r0.coordinates.at(-1).join(","), mode: "car", avoid: "strong", ...(navigation ? { navigation: "1" } : {}) });
  const response = await GET(Object.assign(new Request(`http://localhost/api/routes?${params}`), { nextUrl: new URL(`http://localhost/api/routes?${params}`) }));
  payload = await response.json();
  if (response.status !== 200) throw new Error(`handler status ${response.status}: ${payload.error}`);
} finally { globalThis.fetch = nativeFetch; }

const brief = (r) => ({ km: +r.distance.toFixed(3), min: +r.minutes.toFixed(2), confirmedPave: r.confirmedPaveMeters, probablePave: r.probablePaveMeters,
  unknown: r.unknownSurfaceMeters, rough: (r.roughSections ?? []).map((s) => ({ at: s.startMeters, to: s.endMeters, name: s.name ?? null, surface: s.surface ?? null })) });
const result = {
  scenario, navigation, extraSecondsAssumed: scenario === "with-friuli-first" ? extraSeconds : null,
  note: "Stub provider; route 0 is the plan's own route. Requests after the base call are answered 503 (logged).",
  route0Length: { traceKm: r0.distanceKm, geometryMeters: Math.round(len(r0.coordinates)) },
  providerRequestsInOrder: calls,
  fast: brief(payload.fast), safe: brief(payload.safe), hasDistinctAlternative: payload.hasDistinctAlternative,
  antiPave: payload.antiPave, optimization: payload.optimization, alternativesAnalyzed: payload.alternativesAnalyzed, dataNotice: payload.dataNotice,
  candidates: payload.candidateDiagnostics.map(({ source, provider, distance, seconds, paveMeters, weightedPaveMeters, riskMeters, unknownSurfaceMeters, confirmedPaveMeters, probablePaveMeters,
    selectionVerdict, selectionBurden, selectionUtility, paretoOptimal, distinctFromFast, eligibleModeAndAccess, confirmedRestrictionMeters, blockingRestrictionMeters, surfaceCoveragePercent }) => ({
    source, provider, distance, seconds, paveMeters, weightedPaveMeters, riskMeters, unknownSurfaceMeters, confirmedPaveMeters, probablePaveMeters,
    selectionVerdict, selectionBurden, selectionUtility, paretoOptimal, distinctFromFast, eligibleModeAndAccess, confirmedRestrictionMeters, blockingRestrictionMeters, surfaceCoveragePercent })),
};
console.log(JSON.stringify(result, null, 1));
if (out) await writeFile(out, JSON.stringify(result, null, 1) + "\n");
