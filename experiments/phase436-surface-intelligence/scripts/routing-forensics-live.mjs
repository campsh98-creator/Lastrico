/**
 * Phase 4.36 routing forensics, Agent 1: bounded live experiments with PUBLIC LANDMARK coordinates only.
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-live.mjs --stage=overpass|direct|handler-return|handler-outbound|controls|outbound-probe|ring-probe|osmapi|direct
 *
 * Rules enforced here: at most 20 network requests in total across all stages (counted in the request log, which is persisted),
 * >= 1.1 s between requests, no coordinate from the GPS trace (every coordinate below is an OpenStreetMap node of a named public
 * junction, found in data/sources/milan-citywide-*.osm.json.gz). Each request is logged with UTC time and host. Responses are cached in
 * experiments/phase436-surface-intelligence/data/live-cache/ (git-ignored) so re-runs are offline and do not count.
 * Privacy: only the public corridor names (Via Friuli, Viale Umbria, Viale Isonzo, Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Viale Filippetti,
 * Porta Romana, Alzaia Naviglio Pavese) are written; every other street is "<other street>" (lib/osm-local.mjs pub()). Set PHASE436_REPLAY=1 to re-run
 * offline from the cache without adding log lines.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadHandler } from "./lib/handler-loader.mjs";
import { loadLocalOsm, wayChain, meters, pub } from "./lib/osm-local.mjs";

const stage = process.argv.find((a) => a.startsWith("--stage="))?.slice(8);
const root = new URL("../../../", import.meta.url);
const cacheDir = new URL("experiments/phase436-surface-intelligence/data/live-cache/", root);
const logFile = new URL("outputs/phase436-surface-intelligence/evidence/routing-forensics/live-request-log.json", root);
const resultFile = new URL("outputs/phase436-surface-intelligence/evidence/routing-forensics/live-results.json", root);
const MAX_REQUESTS = 20;
const UA = "Lastrico/0.5.0 (+https://github.com/campsh98-creator/Lastrico)"; // same identification as lib/provider-identity.ts
await mkdir(cacheDir, { recursive: true });

export const LM = {
  SA0: { label: "Via Lazzaro Papi north junction (OSM node, id withheld)", c: [9.2071562, 45.4507078] },
  N1: { label: "Via Friuli lower end x Corso Lodi service lane (OSM node, id withheld)", c: [9.2085528, 45.4484705] },
  SB: { label: "Via Friuli upper junction (OSM node, id withheld)", c: [9.2107236, 45.4511482] },
  E1: { label: "Alzaia Naviglio Pavese junction (OSM node, id withheld)", c: [9.1759083, 45.4437792] },
};
// Piazzale Lodi: the ring way 287070936 tagged surface=sett (11 nodes, OSM). Graph-aligned shape for a penalised-search probe.
const SETT_RING = [[9.210151, 45.447711], [9.210118, 45.447709], [9.210087, 45.447706], [9.210056, 45.447701], [9.210025, 45.447694], [9.209996, 45.447687],
  [9.209965, 45.447678], [9.209938, 45.447668], [9.209911, 45.447657], [9.209886, 45.447645], [9.209858, 45.44763]];

const state = JSON.parse(await readFile(logFile, "utf8").catch(() => '{"requests":[]}'));
const sha = (v) => createHash("sha256").update(v).digest("hex");
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const native = globalThis.fetch;
const round3 = (c) => c.map((x) => +x.toFixed(3));
let currentLabel = "";

async function recorded(url, init = {}, meta = {}) {
  const host = new URL(String(url)).host;
  const bodyText = typeof init.body === "string" ? init.body : "";
  const key = sha(JSON.stringify({ url: String(url), method: init.method ?? "GET", body: bodyText }));
  const file = new URL(`${key}.json`, cacheDir);
  let entry = null;
  try { entry = JSON.parse(await readFile(file, "utf8")); } catch { /* not cached */ }
  const cached = Boolean(entry);
  if (!entry) {
    if (state.requests.filter((r) => !r.cached).length >= MAX_REQUESTS) throw new Error("request cap (20) reached");
    await sleep(Math.max(0, 1150 - (Date.now() - last)));
    last = Date.now();
    const startedAt = new Date().toISOString(); const t = performance.now();
    const headers = { ...(init.headers ?? {}), "User-Agent": UA };
    let status = 0; let text = "";
    try { const res = await native(url, { ...init, headers, signal: AbortSignal.timeout(25_000) }); status = res.status; text = await res.text(); }
    catch (e) { text = String(e); }
    entry = { key, startedAt, host, status, elapsedMs: Math.round(performance.now() - t), body: text };
    if (status === 200) await writeFile(file, JSON.stringify(entry));
  }
  if (!(cached && process.env.PHASE436_REPLAY)) state.requests.push({ n: state.requests.length + 1, utc: entry.startedAt, host, stage, label: meta.label ?? currentLabel, cached, status: entry.status, elapsedMs: entry.elapsedMs, key: key.slice(0, 12) });
  await writeFile(logFile, JSON.stringify(state, null, 1) + "\n");
  return new Response(entry.body, { status: entry.status || 599, headers: { "Content-Type": "application/json" } });
}

function decode6(shape) {
  let i = 0, lat = 0, lon = 0; const out = [];
  while (i < shape.length) {
    for (const k of [0, 1]) { let r = 0, s = 0, b; do { b = shape.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lon += d; }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
function encode6(coords) {
  let pl = 0, pn = 0, s = "";
  for (const [lon, lat] of coords) { for (const v of [Math.round(lat * 1e6) - pl, Math.round(lon * 1e6) - pn]) { let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 32) { s += String.fromCharCode((32 | (n & 31)) + 63); n >>= 5; } s += String.fromCharCode(n + 63); } pl = Math.round(lat * 1e6); pn = Math.round(lon * 1e6); }
  return s;
}

const osm = loadLocalOsm();
function summariseTrip(trip) {
  const coords = trip.legs.flatMap((l, i) => (i ? decode6(l.shape).slice(1) : decode6(l.shape)));
  const man = trip.legs.flatMap((l) => l.maneuvers ?? []);
  const chain = wayChain(osm, coords);
  const names = new Set(chain.map((c) => c.name));
  const sett = chain.filter((c) => ["sett", "cobblestone", "paving_stones"].includes(c.surface)).reduce((s, c) => s + c.meters, 0);
  return {
    km: +trip.summary.length.toFixed(3), min: +(trip.summary.time / 60).toFixed(2), maneuvers: man.length, uturns: man.filter((m) => m.type === 12 || m.type === 13).length,
    firstManeuvers: man.slice(0, 7).map((m) => `${m.type}:${pub((m.street_names ?? [""])[0] || "")}:${Math.round((m.length ?? 0) * 1000)}m`),
    uturnAt: man.filter((m) => m.type === 12 || m.type === 13).map((m) => `${pub((m.street_names ?? [""])[0] || "")}`),
    passes: { viaFriuli: names.has("Via Friuli"), vialeUmbria: names.has("Viale Umbria"), piazzaleLodi: names.has("Piazzale Lodi"), corsoLodi: names.has("Corso Lodi"), viaLazzaroPapi: names.has("Via Lazzaro Papi") },
    osmSettMetersOnWays: Math.round(sett),
    streetSequence: chain.filter((c) => c.meters >= 15).slice(0, 14).map((c) => `${c.name ?? "?"}(${c.highway ?? "-"}${c.surface === "sett" || c.surface === "paving_stones" ? "," + c.surface : ""}):${c.meters}`),
  };
}

const valhallaBody = (locations, extra = {}) => ({
  locations, costing: "auto", costing_options: { auto: { use_highways: 0.7, use_tolls: 0.2 } }, units: "kilometers",
  directions_options: { units: "kilometers", language: "it-IT" }, alternates: 2, ...extra,
});
const loc = (lm, type, extra = {}) => ({ lon: LM[lm].c[0], lat: LM[lm].c[1], type, ...extra });
async function valhalla(label, body, summary) {
  currentLabel = label;
  const res = await recorded("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Client-Id": "lastrico-milano" }, body: JSON.stringify(body) }, { label });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* keep {} */ }
  const trips = [data.trip, ...(data.alternates ?? []).map((a) => a.trip ?? a)].filter(Boolean);
  return { label, status: res.status, ...summary, request: { locations: body.locations.map((l) => ({ at: round3([l.lon, l.lat]), type: l.type, heading: l.heading ?? null })), alternates: body.alternates, linearCostFactors: body.linear_cost_factors?.length ?? 0 },
    error: res.status !== 200 ? text.slice(0, 160) : null, trips: trips.map(summariseTrip) };
}

const results = JSON.parse(await readFile(resultFile, "utf8").catch(() => "{}"));
const save = async () => writeFile(resultFile, JSON.stringify(results, null, 1) + "\n");

if (stage === "overpass") {
  currentLabel = "Overpass: Via Friuli ways + turn-restriction relations (no coordinates in the query)";
  const query = '[out:json][timeout:25];area["name"="Milano"]["boundary"="administrative"]["admin_level"="8"]->.a;way(area.a)["highway"]["name"="Via Friuli"]->.f;(.f;rel(bw.f)["type"~"^restriction"];);out meta;';
  const endpoint = process.argv.find((a) => a.startsWith("--endpoint="))?.slice(11) ?? "https://overpass-api.de/api/interpreter";
  const res = await recorded(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) });
  const text = await res.text(); let d = {}; try { d = JSON.parse(text); } catch { /* keep */ }
  const els = d.elements ?? [];
  results.overpass = { status: res.status, queryHasCoordinates: false, osmBase: d.osm3s?.timestamp_osm_base ?? null, ways: els.filter((e) => e.type === "way").map((w) => ({ id: w.id, version: w.version, timestamp: w.timestamp, oneway: w.tags?.oneway ?? null, highway: w.tags?.highway, surface: w.tags?.surface ?? null, access: w.tags?.access ?? null, motor_vehicle: w.tags?.motor_vehicle ?? null })),
    restrictions: els.filter((e) => e.type === "relation").map((r) => ({ id: r.id, version: r.version, timestamp: r.timestamp, tags: r.tags, members: r.members?.map((m) => `${m.role}:${m.type}:${m.ref}`) })) };
  await save(); console.log(JSON.stringify(results.overpass, null, 1));
} else if (stage === "osmapi") {
  // Overpass timed out twice (25 s each): ask the OSM API by way ID instead (no coordinates, no street name). A turn restriction
  // from the origin street into Via Friuli must have the first Via Friuli way after the crossing as its "to" (or "via") member.
  currentLabel = "OSM API 0.6: relations of Via Friuli way 264363537 (turn restrictions into Via Friuli), by way id";
  const res = await recorded("https://api.openstreetmap.org/api/0.6/way/264363537/relations.json", { method: "GET", headers: { Accept: "application/json" } });
  const text = await res.text(); let d = {}; try { d = JSON.parse(text); } catch { /* keep */ }
  results.osmapi = { status: res.status, way: 264363537, relations: (d.elements ?? []).map((r) => ({ id: r.id, version: r.version, timestamp: r.timestamp, tags: r.tags, members: r.members?.map((m) => m.role + ":" + m.type + ":" + m.ref) })), raw: res.status === 200 ? undefined : text.slice(0, 120) };
  await save(); console.log(JSON.stringify(results.osmapi, null, 1));
} else if (stage === "direct") {
  const heading = 121; // azimuth of the one-way street from the Via Lazzaro Papi junction (south-east)
  const out = [];
  out.push(await valhalla("V2 turn probe: Via Lazzaro Papi north junction (heading SE) -> Via Friuli lower end [break,break]", valhallaBody([loc("SA0", "break", { heading }), loc("N1", "break")], { alternates: 0 }), { purpose: "can a car go from the one-way street into Via Friuli?" }));
  out.push(await valhalla("V1 base: Via Lazzaro Papi north junction (heading SE) -> Naviglio Pavese junction [production payload, alternates 2]", valhallaBody([loc("SA0", "break", { heading }), loc("E1", "break")]), { purpose: "does the provider's best route use Via Friuli or Viale Umbria/Piazzale Lodi?" }));
  out.push(await valhalla("V3 shortcut: Via Friuli upper node -> Naviglio Pavese junction [production payload]", valhallaBody([loc("SB", "break"), loc("E1", "break")]), { purpose: "from upstream Via Friuli, no turn needed: which way does the provider go?" }));
  const penalised = valhallaBody([loc("SA0", "break", { heading }), loc("E1", "break")], { alternates: 0, linear_cost_factors: [{ shape: encode6(SETT_RING), factor: 15 }] });
  out.push(await valhalla("V4 penalised: V1 + linear_cost_factors x15 on the Piazzale Lodi sett ring way (25 m)", penalised, { purpose: "does the engine's own anti-pavé mechanism move the provider to the Via Friuli shortcut?" }));
  results.direct = out; await save(); console.log(JSON.stringify(out, null, 1));
} else if (stage === "controls") {
  const heading = 121; const out = results.controls ?? [];
  const start = loc("SA0", "break", { heading }), end = loc("E1", "break");
  out.push(await valhalla("V5 control: V1 with alternates 0, no cost factors", valhallaBody([start, end], { alternates: 0 }), { purpose: "is the base optimum the same without alternates and without penalty?" }));
  for (const factor of [2, 4]) {
    out.push(await valhalla("V" + (factor === 2 ? 6 : 7) + " sensitivity: linear_cost_factors x" + factor + " on the Piazzale Lodi sett ring way", valhallaBody([start, end], { alternates: 0, linear_cost_factors: [{ shape: encode6(SETT_RING), factor }] }), { purpose: "how small a penalty flips the provider to the Via Friuli shortcut?" }));
    if (out.at(-1).trips[0]?.passes.viaFriuli) break;
  }
  results.controls = out; await save(); console.log(JSON.stringify(out.map((o) => ({ label: o.label, status: o.status, trips: o.trips.map((t) => ({ km: t.km, min: t.min, first: t.firstManeuvers, viaFriuli: t.passes.viaFriuli, piazzaleLodi: t.passes.piazzaleLodi, osmSett: t.osmSettMetersOnWays })) })), null, 1));
} else if (stage === "ring-probe") {
  // Agent 2 found ring way 713165261 (Piazzale Lodi, 10.3 m) without `oneway` (junction=circular since 2022). Does the PROVIDER graph treat it as
  // two-way? Route from a point 5 m downstream on that way to a point upstream of it, i.e. against the ring flow (flow = decreasing longitude):
  // a two-way link answers with a ~5 m route, a one-way ring with a loop of about one ring length (~250 m).
  LM.RUP = { label: "Piazzale Lodi ring way 713165261, node 2 of 5 (upstream)", c: [9.21025, 45.447709] };
  LM.RDOWN = { label: "Piazzale Lodi ring way 713165261, node 4 of 5 (downstream)", c: [9.210185, 45.447712] };
  const out = [await valhalla("V9 ring probe: downstream -> upstream point on ring way 713165261 (against the ring flow)", valhallaBody([loc("RDOWN", "break"), loc("RUP", "break")], { alternates: 0 }), { purpose: "does the provider graph allow travelling against the ring flow on way 713165261?" })];
  results["ring-probe"] = out; await save(); console.log(JSON.stringify(out.map((o) => ({ label: o.label, status: o.status, trips: o.trips.map((t) => ({ km: t.km, min: t.min, first: t.firstManeuvers, uturns: t.uturns, seq: t.streetSequence })) })), null, 1));
} else if (stage === "outbound-probe") {
  // One extra provider request: penalise EVERY stone slice of both engine candidates for E1 -> Via Lazzaro Papi north junction (the way
  // the planner refinement step would) and score the answer with the production scorer. In the handler the refinement did not run
  // because the first penalised route already cut the stone by more than half (route.ts:716).
  const { getSpatialRoadStore } = await import("../../../lib/spatial-road-store.ts");
  const { EdgeMemo, scoreRoadIntelligence } = await import("../../../lib/road-intelligence-scoring.ts");
  const { extractRoughSlices, buildLinearCostFactors } = await import("../../../lib/surface-aware-routing.ts");
  globalThis.fetch = (url, init) => recorded(url, init, { label: "outbound-probe: replay of handler-outbound (cached)" });
  const { GET } = await loadHandler("app/api/routes/route.ts", "probe");
  const params = new URLSearchParams({ area: "milan", start: LM.E1.c.join(","), end: LM.SA0.c.join(","), mode: "car", avoid: "strong" });
  const url = "http://localhost/api/routes?" + params;
  const p0 = await (await GET(Object.assign(new Request(url), { nextUrl: new URL(url) }))).json();
  globalThis.fetch = native;
  const store = await getSpatialRoadStore("milan");
  const scoreOf = async (coords) => {
    await store.preloadTiles(store.getTileKeysForCoordinates(coords, 50));
    const sc = store.getScopedIntelligence(coords, 50);
    return scoreRoadIntelligence(coords, sc.surfaceIndex, 12, "car", false, { terminalWalkingForBicycle: false, authorisedZtl: new Set(), edgeMemo: new EdgeMemo() });
  };
  const slices = [];
  for (const r of [p0.fast, p0.safe]) {
    const sc = await scoreOf(r.coordinates);
    slices.push(...extractRoughSlices(r.coordinates, (_a, _b, i) => sc.roughSegmentIndices?.has(i), 15));
  }
  const { factors, totalPenalizedMeters } = buildLinearCostFactors(slices, 15, 12);
  const label = "V8 outbound probe: E1 -> Via Lazzaro Papi north junction, x15 on " + factors.length + " stone slices of fast+safe";
  const body = valhallaBody([loc("E1", "break"), loc("SA0", "break")], { alternates: 0, linear_cost_factors: factors });
  const res = await valhalla(label, body, { purpose: "does a route that avoids all stone slices of both engine candidates exist, and what does it cost?" });
  const cached = JSON.parse(await (await recorded("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Client-Id": "lastrico-milano" }, body: JSON.stringify(body) }, { label: "cache read of V8" })).text());
  const coords = cached.trip.legs.flatMap((l, i) => (i ? decode6(l.shape).slice(1) : decode6(l.shape)));
  const sc = await scoreOf(coords);
  res.engineScore = { confirmedMeters: sc.confirmedMeters, probableMeters: sc.probableMeters, unknownMeters: sc.unknownMeters, weightedPaveMeters: sc.weightedPaveMeters, roughFeatures: [...(sc.roughSegmentFeatures?.values() ?? [])].map((f) => pub(f.name) + ":" + f.material) };
  res.penalisedSlices = { count: factors.length, meters: totalPenalizedMeters };
  res.compare = { fast: { km: +p0.fast.distance.toFixed(3), min: +p0.fast.minutes.toFixed(2), confirmed: p0.fast.confirmedPaveMeters }, safe: { km: +p0.safe.distance.toFixed(3), min: +p0.safe.minutes.toFixed(2), confirmed: p0.safe.confirmedPaveMeters } };
  results["outbound-probe"] = res; await save(); console.log(JSON.stringify(res, null, 1));
} else if (stage === "handler-return" || stage === "handler-outbound") {
  const [from, to] = stage === "handler-return" ? ["SA0", "E1"] : ["E1", "SA0"];
  globalThis.fetch = (url, init) => recorded(url, init, { label: `handler ${stage}: ${from} -> ${to}` });
  currentLabel = `handler ${stage}: ${from} -> ${to}`;
  const { GET } = await loadHandler("app/api/routes/route.ts", stage);
  const params = new URLSearchParams({ area: "milan", start: LM[from].c.join(","), end: LM[to].c.join(","), mode: "car", avoid: "strong" });
  const before = state.requests.length;
  const url = `http://localhost/api/routes?${params}`;
  const response = await GET(Object.assign(new Request(url), { nextUrl: new URL(url) }));
  globalThis.fetch = native;
  const p = await response.json();
  const brief = (r) => ({ km: +r.distance.toFixed(3), min: +r.minutes.toFixed(2), confirmedPave: r.confirmedPaveMeters, probablePave: r.probablePaveMeters, unknown: r.unknownSurfaceMeters,
    rough: (r.roughSections ?? []).map((s) => `${pub(s.name) ?? "?"}:${s.surface ?? "?"}:${s.startMeters}-${s.endMeters}`), instructions: (r.instructions ?? []).map((i) => `${i.direction}:${pub(i.roadName)}:${Math.round(i.distance)}`).slice(0, 14) });
  results[stage] = { from: LM[from].label, to: LM[to].label, requestsMade: state.requests.slice(before).map((r) => ({ n: r.n, utc: r.utc, host: r.host, cached: r.cached, status: r.status, ms: r.elapsedMs })),
    status: response.status, error: p.error ?? null, hasDistinctAlternative: p.hasDistinctAlternative, antiPave: p.antiPave, optimization: p.optimization, alternativesAnalyzed: p.alternativesAnalyzed,
    fast: p.fast && brief(p.fast), safe: p.safe && brief(p.safe), dataNotice: p.dataNotice,
    candidates: p.candidateDiagnostics?.map((c) => ({ source: c.source, provider: c.provider, distance: c.distance, seconds: c.seconds, confirmed: c.confirmedPaveMeters, probable: c.probablePaveMeters, unknown: c.unknownSurfaceMeters, risk: c.riskMeters,
      verdict: c.selectionVerdict, burden: c.selectionBurden, utility: c.selectionUtility, pareto: c.paretoOptimal, distinct: c.distinctFromFast, detourPercent: c.detourPercent })) };
  // Street sequence of each returned route, from the local OSM extracts
  results[stage].streetSequence = { fast: wayChain(osm, p.fast.coordinates).filter((c) => c.meters >= 15).slice(0, 16).map((c) => `${c.name ?? "?"}(${c.highway ?? "-"}${["sett", "paving_stones"].includes(c.surface) ? "," + c.surface : ""}):${c.meters}`) };
  if (p.safe && JSON.stringify(p.safe.coordinates) !== JSON.stringify(p.fast.coordinates)) results[stage].streetSequence.safe = wayChain(osm, p.safe.coordinates).filter((c) => c.meters >= 15).slice(0, 16).map((c) => `${c.name ?? "?"}(${c.highway ?? "-"}${["sett", "paving_stones"].includes(c.surface) ? "," + c.surface : ""}):${c.meters}`);
  await save(); console.log(JSON.stringify(results[stage], null, 1));
} else {
  console.error("usage: --stage=overpass|direct|handler-return|handler-outbound"); process.exit(2);
}
console.log(`requests so far (non-cached): ${state.requests.filter((r) => !r.cached).length}/${MAX_REQUESTS}`);
void meters;
