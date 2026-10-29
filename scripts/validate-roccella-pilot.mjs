/** Actual Roccella route handler validation. --live captures uncached provider responses.
 * Offline replay is the default. Overpass is deliberately unavailable in both modes:
 * surface measurements must use the reproducible local OSM archive, not changing live tags.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { buildRouteProgressModel, calculateRouteProgress } from "../lib/route-progress.ts";
import { geographicDistance } from "../lib/road-intelligence-scoring.ts";
import { evaluateTimedGpsReading, evaluateOffRouteReading } from "../lib/navigation-state.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";

const root = new URL("../", import.meta.url);
const output = new URL("outputs/phase42-validation/", root);
const live = process.argv.includes("--live");
const refreshErrors = process.argv.includes("--retry-errors");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const nativeFetch = globalThis.fetch;
const calls = [];
let currentCalls = [];
const missing = [];
await mkdir(new URL("responses/", output), { recursive: true });
const cases = JSON.parse(await readFile(new URL("cases.json", output), "utf8"));

async function delay(ms, signal) {
  if (signal?.aborted) throw signal.reason;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes("overpass")) return new Response("Validation: frozen authentic OSM archive only", { status: 503 });
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  const key = sha256(JSON.stringify(request));
  const file = new URL(`responses/${key}.json`, output);
  let entry;
  try { entry = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (entry && refreshErrors && (entry.error || entry.status >= 500)) entry = undefined;
  const cached = Boolean(entry);
  if (!entry && !live) { missing.push(key); throw new Error(`No archived response: ${key}`); }
  if (!entry) {
    const started = performance.now();
    try {
      const response = await nativeFetch(url, init);
      const body = await response.text();
      entry = { request, key, retrievedAt: new Date().toISOString(), status: response.status,
        elapsedMs: performance.now() - started, body, bodySha256: sha256(body) };
    } catch (error) {
      entry = { request, key, retrievedAt: new Date().toISOString(), elapsedMs: performance.now() - started, error: String(error) };
    }
    await writeFile(file, JSON.stringify(entry, null, 2) + "\n");
  } else {
    if (sha256(JSON.stringify(entry.request)) !== key || (entry.body !== undefined && sha256(entry.body) !== entry.bodySha256)) throw new Error(`Invalid checksum: ${key}`);
    await delay(entry.elapsedMs, init.signal);
  }
  const call = { key, cached, status: entry.status ?? null, error: entry.error ?? null, elapsedMs: entry.elapsedMs };
  calls.push(call); currentCalls.push(call);
  if (entry.error) throw new Error(entry.error);
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
};

const beforeImport = process.memoryUsage().heapUsed;
const { GET } = await loadApi("app/api/routes/route.ts");
const importedHeap = process.memoryUsage().heapUsed;
const results = [];
const metrics = (route) => route ? {
  seconds: route.minutes * 60, distanceMeters: route.distance * 1000,
  roughMeters: route.paveMeters, smoothMeters: route.smoothSurfaceMeters,
  unpavedMeters: route.unpavedSurfaceMeters, unknownMeters: route.unknownSurfaceMeters,
  surfaceTotalMeters: route.surfaceTotalMeters, knownCoveragePercent: route.surfaceCoveragePercent,
  cyclingMeters: route.cyclewayMeters, instructions: route.instructions?.length ?? 0,
} : null;

async function runCase(id, start, end, mode, navigation = false) {
  currentCalls = [];
  const params = new URLSearchParams({ area: "roccella", start: start.join(","), end: end.join(","), mode,
    avoid: "strong", maxExtraMinutes: "5", ...(navigation ? { navigation: "1" } : {}) });
  const started = performance.now();
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  const elapsedMs = performance.now() - started;
  await writeFile(new URL(`${id}-${mode}.json`, output), JSON.stringify({ request: Object.fromEntries(params), status: response.status, elapsedMs, payload, calls: currentCalls }, null, 2) + "\n");
  const row = { id, mode, navigation, status: response.status, elapsedMs,
    fast: metrics(payload.fast), safe: metrics(payload.safe), hasDistinctAlternative: payload.hasDistinctAlternative ?? false,
    alternativesAnalyzed: payload.alternativesAnalyzed ?? 0, routingProfile: payload.routingProfile,
    error: payload.error ?? null, calls: currentCalls };
  if (payload.fast) {
    const chosen = payload.safe ?? payload.fast;
    const model = buildRouteProgressModel(chosen.coordinates, chosen.instructions, geographicDistance);
    const midIndex = Math.floor(chosen.coordinates.length / 2);
    const states = [chosen.coordinates[0], chosen.coordinates[midIndex], chosen.coordinates.at(-1)]
      .map((point) => calculateRouteProgress(model, point, chosen.minutes, null));
    const now = Date.now();
    const gps = evaluateTimedGpsReading({ coordinate: chosen.coordinates[0], accuracy: 5, timestamp: now, now,
      previousCoordinate: null, previousAccuracy: null, previousTimestamp: null,
      bounds: PILOT_AREAS.roccella.bounds, distanceMeters: geographicDistance, maximumSpeedMetersPerSecond: 70 });
    row.navigationSoftware = { gpsAccepted: gps.accepted, progressStart: states[0].routeProgressMeters,
      progressMid: states[1].routeProgressMeters, remainingAtArrival: states[2].remainingMeters,
      currentInstructionAtStart: states[0].instruction?.text ?? null };
    row.invariants = {
      exactMode: payload.transportMode === mode,
      correctProfile: payload.routingProfile.profile === (mode === "car" ? "auto" : mode)
        || (mode === "car" && payload.routingProfile.profile === "driving"),
      timeBudget: chosen.minutes <= payload.fast.minutes + 5,
      measuredCategories: chosen.paveMeters + chosen.smoothSurfaceMeters + chosen.unpavedSurfaceMeters + chosen.unknownSurfaceMeters === chosen.surfaceTotalMeters,
      instructionsPresent: chosen.instructions.length > 1,
    };
  }
  results.push(row);
  console.log(`${id} ${mode}: HTTP ${response.status}, ${Math.round(elapsedMs)} ms, rough ${row.fast?.roughMeters ?? "n/a"}→${row.safe?.roughMeters ?? "n/a"}, unknown ${row.safe?.unknownMeters ?? "n/a"} m`);
  return payload;
}

try {
  for (const sample of cases.routes) {
    for (const mode of ["car", "motorcycle", "bicycle"]) await runCase(sample.id, sample.start, sample.end, mode);
  }
  const navigation = cases.routes[0];
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    await runCase("navigation", navigation.start, navigation.end, mode, true);
    await runCase("reroute", cases.reroute.start, navigation.end, mode, true);
  }
} finally { globalThis.fetch = nativeFetch; }

const offRoute = evaluateOffRouteReading({ currentReadings: 1, offRouteMeters: 100, thresholdMeters: 55,
  requiredReadings: 2, now: 30_000, lastCalculationAt: 0, cooldownMs: 15_000, calculationInProgress: false });
const summary = {
  generatedAt: new Date().toISOString(), runMode: live ? "capture-missing-real-provider-responses" : "offline-response-replay",
  surfaceMode: "authentic local compact archive; Overpass deliberately unavailable",
  handlerSha256: sha256(await readFile(new URL("app/api/routes/route.ts", root))),
  compactSha256: sha256(await readFile(new URL("data/surfaces/roccella-compact-tiles.json", root))),
  heapMiB: { beforeHandlerImport: beforeImport / 2 ** 20, afterHandlerImport: importedHeap / 2 ** 20, end: process.memoryUsage().heapUsed / 2 ** 20 },
  offRouteSoftwareTrigger: offRoute.shouldRecalculate,
  requests: calls.length, newlyCaptured: calls.filter((c) => !c.cached).length, missingCaptures: missing, results,
};
await writeFile(new URL(live ? "summary-live.json" : "summary-replay.json", output), JSON.stringify(summary, null, 2) + "\n");
if (missing.length || results.some((row) => row.status !== 200 || Object.values(row.invariants ?? {}).some((ok) => !ok))) process.exitCode = 1;
