/**
 * Phase 4.31 — anti-pavé quality of reroutes. For each Milan benchmark journey and mode, the
 * selected route of the archived Phase 4.30 run is left at its first clear turn by a SYNTHETIC
 * mirrored wrong turn on the real OSM road (Lastrico's road tiles), and the real /api/routes
 * handler is asked for a navigation reroute 120 m down that road. When that reroute has no
 * distinct alternative, a second wrong turn on the reroute is simulated as well, which is where
 * the pre-4.31 app dropped the anti-pavé objective.
 * Provider responses go to the Phase 4.25 archive (FOSSGIS-paced, ≥1.1 s apart) and replay offline.
 *
 *   node scripts/benchmark-reroutes.mjs --label=before [--live] [--limit=N]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { roadWalk, routeTurns } from "../tests/helpers/deviation-scenarios.mjs";

const root = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = arg("label") ?? "run";
const limit = Number(arg("limit") ?? Infinity);
const live = process.argv.includes("--live");
const departure = arg("departure");
const archive = new URL("outputs/phase425-benchmark/responses/", root);
const out = new URL(`outputs/phase431/reroute-bench/${label}/`, root);
await mkdir(new URL("cases/", out), { recursive: true });
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root), "utf8"));
const nativeFetch = globalThis.fetch;
const missing = [];
let currentCalls = [];
let lastNetworkAt = 0;
let networkQueue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function archivedFetch(url, init = {}) {
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  const key = sha256(JSON.stringify(request));
  const file = new URL(`${key}.json`, archive);
  let entry;
  try { entry = JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const cached = Boolean(entry);
  if (!entry && !live) { missing.push(key); throw new Error(`No archived response: ${key}`); }
  if (!entry) {
    const pending = networkQueue.then(async () => {
      await sleep(Math.max(0, 1100 - (Date.now() - lastNetworkAt)));
      lastNetworkAt = Date.now();
      const started = performance.now();
      try {
        const response = await nativeFetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
        const body = await response.text();
        return { request, key, retrievedAt: new Date().toISOString(), status: response.status,
          elapsedMs: performance.now() - started, body, bodySha256: sha256(body) };
      } catch (error) {
        return { request, key, retrievedAt: new Date().toISOString(), elapsedMs: performance.now() - started, error: String(error) };
      }
    });
    networkQueue = pending.then(() => undefined, () => undefined);
    entry = await pending;
    if (!entry.error && entry.status < 500 && entry.status !== 429) await writeFile(file, JSON.stringify(entry) + "\n");
  } else if (sha256(JSON.stringify(entry.request)) !== key || sha256(entry.body) !== entry.bodySha256) {
    throw new Error(`Invalid archived response: ${key}`);
  }
  currentCalls.push({ key, cached, status: entry.status ?? null, error: entry.error ?? null, providerMs: Math.round(entry.elapsedMs) });
  if (entry.error) throw new Error(entry.error);
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
}
function installFetch() {
  globalThis.fetch = async (url, init) => {
    try { return await archivedFetch(url, init); } finally { installFetch(); }
  };
}
installFetch();

const { GET } = await loadApi("app/api/routes/route.ts");
const { spatialRoadStore: store } = await import(new URL("lib/spatial-road-store.ts", root).href);
const { buildRouteProgressModel } = await import(new URL("lib/route-progress.ts", root).href);
const { distanceMeters } = await import(new URL("lib/navigation-fix-processor.ts", root).href);

const pick = (r) => r ? { seconds: Math.round(r.minutes * 60), meters: Math.round(r.distance * 1000), pave: r.paveMeters,
  confirmed: r.confirmedPaveMeters, probable: r.probablePaveMeters, unknown: r.unknownSurfaceMeters, total: r.surfaceTotalMeters } : null;

async function reroute(start, end, mode) {
  currentCalls = [];
  installFetch();
  const params = new URLSearchParams({ area: "milan", start: start.join(","), end: end.join(","), mode, avoid: fixture.request.avoid, navigation: "1" });
  // Phase 4.31: a fixed Milan departure (--departure=YYYY-MM-DDTHH:MM) keeps ZTL and time windows reproducible.
  if (departure) params.set("departure", departure);
  const cpu = process.cpuUsage();
  const started = performance.now();
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  const used = process.cpuUsage(cpu);
  return {
    params: Object.fromEntries(params), status: response.status, payload,
    row: { status: response.status, error: payload.error ?? null, computeMs: Math.round(performance.now() - started),
      cpuMs: Math.round((used.user + used.system) / 1000), handlerTotalMs: payload.performance?.totalMs ?? null,
      providerCalls: currentCalls.length, providerMs: currentCalls.reduce((a, c) => a + c.providerMs, 0),
      captured: currentCalls.filter((c) => !c.cached).length,
      fast: pick(payload.fast), safe: pick(payload.safe), hasDistinctAlternative: payload.hasDistinctAlternative ?? false,
      alternativesAnalyzed: payload.alternativesAnalyzed ?? 0,
      sources: (payload.candidateDiagnostics ?? []).map((c) => c.source) },
  };
}

/** A wrong turn at the route's first clear turn: the point 120 m down the mirrored real road. */
async function deviationPoint(route, mode) {
  const model = buildRouteProgressModel(route.coordinates, route.instructions ?? [], distanceMeters);
  const turns = routeTurns(route.coordinates, model.instructions.map((e) => e.progressMeters), { before: 150, after: 300 });
  for (const turn of turns) {
    const walk = await roadWalk(store, turn.junction, (turn.inBearing - turn.turn + 360) % 360, mode, 120);
    if (!walk.onRoad) continue;
    return { point: walk.points.at(-1), turnMeters: Math.round(turn.meters), turnAngle: Math.round(turn.turn) };
  }
  return null;
}

const rows = [];
let count = 0;
try {
  for (const journey of fixture.journeys) {
    for (const mode of fixture.modes) {
      if (count >= limit) break;
      let initial;
      try { initial = JSON.parse(gunzipSync(await readFile(new URL(`outputs/phase425-benchmark/p430-final/cases/${journey.id}-${mode}.json.gz`, root)))).payload; } catch { continue; }
      if (!initial?.fast) continue;
      count += 1;
      const selected = initial.hasDistinctAlternative ? initial.safe : initial.fast;
      const first = await deviationPoint(selected, mode);
      const row = { id: journey.id, mode, initial: { hasDistinctAlternative: initial.hasDistinctAlternative, fast: pick(initial.fast), safe: pick(initial.safe) } };
      if (!first) { row.skipped = "no on-road wrong turn"; rows.push(row); continue; }
      const one = await reroute(first.point, journey.end, mode);
      row.deviation = first;
      row.reroute1 = one.row;
      await writeFile(new URL(`cases/${journey.id}-${mode}-1.json.gz`, out), gzipSync(JSON.stringify({ request: one.params, status: one.status, payload: one.payload })));
      // The second wrong turn matters only when the first reroute had no distinct alternative.
      if (one.status === 200 && !one.payload.hasDistinctAlternative) {
        const second = await deviationPoint(one.payload.fast, mode);
        if (second) {
          const two = await reroute(second.point, journey.end, mode);
          row.deviation2 = second;
          row.reroute2 = two.row;
          await writeFile(new URL(`cases/${journey.id}-${mode}-2.json.gz`, out), gzipSync(JSON.stringify({ request: two.params, status: two.status, payload: two.payload })));
        }
      }
      rows.push(row);
      const r = row.reroute1;
      console.log(`${journey.id} ${mode}: ${r.status} calls=${r.providerCalls}(+${r.captured}) cpu=${r.cpuMs}ms conf ${r.fast?.confirmed ?? "-"}→${r.safe?.confirmed ?? "-"}${r.hasDistinctAlternative ? " ALT" : ""}${row.reroute2 ? ` | 2nd conf ${row.reroute2.fast?.confirmed}→${row.reroute2.safe?.confirmed}${row.reroute2.hasDistinctAlternative ? " ALT" : ""}` : ""}`);
    }
  }
} finally { globalThis.fetch = nativeFetch; }

const summary = { label, generatedAt: new Date().toISOString(), runMode: live ? "capture-missing-then-replay" : "offline-replay", synthetic: "wrong turns are synthetic; provider routes and surface scores are real",
  handlerSha256: sha256(await readFile(new URL("app/api/routes/route.ts", root))),
  requests: rows.reduce((a, r) => a + (r.reroute1?.providerCalls ?? 0) + (r.reroute2?.providerCalls ?? 0), 0),
  newlyCaptured: rows.reduce((a, r) => a + (r.reroute1?.captured ?? 0) + (r.reroute2?.captured ?? 0), 0),
  missingCaptures: [...new Set(missing)], rows };
await writeFile(new URL("summary.json", out), JSON.stringify(summary, null, 1) + "\n");
console.log(`rows=${rows.length} requests=${summary.requests} captured=${summary.newlyCaptured} missing=${summary.missingCaptures.length}`);
if (summary.missingCaptures.length) process.exitCode = 1;
