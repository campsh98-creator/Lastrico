/** Phase 4.25 — Milan anti-pavé benchmark through the real /api/routes handler.
 * Offline replay of archived provider responses is the default; --live captures only the
 * responses that are missing (serial queue, ≥1100 ms between starts: FOSSGIS policy).
 * Surface scoring always uses the local OSM archive in the working tree.
 *
 *   node scripts/benchmark-milan-routing.mjs --label=before [--live] [--only=id] [--no-stability]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";

const root = new URL("../", import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = arg("label") ?? "run";
const only = arg("only");
const live = process.argv.includes("--live");
const withStability = !process.argv.includes("--no-stability");
// Phase 4.31: a fixed Milan departure time ("YYYY-MM-DDTHH:MM"), so time windows and ZTL rules are reproducible.
const departure = arg("departure");
const base = new URL("outputs/phase425-benchmark/", root);
const archive = new URL("responses/", base);
const out = new URL(`${label}/`, base);
await mkdir(archive, { recursive: true });
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
    // Transient provider failures are not archived, so a later capture can retry them.
    if (!entry.error && entry.status < 500 && entry.status !== 429) await writeFile(file, JSON.stringify(entry) + "\n");
  } else if (sha256(JSON.stringify(entry.request)) !== key || sha256(entry.body) !== entry.bodySha256) {
    throw new Error(`Invalid archived response: ${key}`);
  }
  currentCalls.push({ key, cached, status: entry.status ?? null, error: entry.error ?? null, providerMs: Math.round(entry.elapsedMs) });
  if (entry.error) throw new Error(entry.error);
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
}
// A fresh wrapper per call resets the handler's per-isolate provider pacing (it keys on the
// fetch identity), so archived responses are not delayed 1.05 s each. Real network calls in
// --live mode still go through this harness's serial queue (≥1.1 s between starts).
function installFetch() {
  globalThis.fetch = async (url, init) => {
    try { return await archivedFetch(url, init); } finally { installFetch(); }
  };
}
installFetch();

const { GET } = await loadApi("app/api/routes/route.ts");
const pick = (r) => r ? { seconds: Math.round(r.minutes * 60), meters: Math.round(r.distance * 1000), pave: r.paveMeters,
  confirmed: r.confirmedPaveMeters, probable: r.probablePaveMeters, smooth: r.smoothSurfaceMeters, unpaved: r.unpavedSurfaceMeters,
  unknown: r.unknownSurfaceMeters, total: r.surfaceTotalMeters, coverage: r.surfaceCoveragePercent,
  points: r.coordinates.length, geometrySha256: sha256(JSON.stringify(r.coordinates)), instructions: r.instructions?.length ?? 0 } : null;

const rows = [];
async function runCase(journey, mode, kind) {
  currentCalls = [];
  const params = new URLSearchParams({ area: "milan", start: journey.start.join(","), end: journey.end.join(","), mode, avoid: fixture.request.avoid });
  if (departure) params.set("departure", departure);
  installFetch();
  const started = performance.now();
  const cpu = process.cpuUsage();
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  const cpuUsed = process.cpuUsage(cpu);
  const computeMs = performance.now() - started;
  const row = { id: journey.id, baseId: journey.baseId ?? journey.id, kind, mode, status: response.status, error: payload.error ?? null,
    computeMs: Math.round(computeMs), cpuMs: Math.round((cpuUsed.user + cpuUsed.system) / 1000), handlerTotalMs: payload.performance?.totalMs ?? null, providerCalls: currentCalls.length, providerMs: currentCalls.reduce((a, c) => a + c.providerMs, 0),
    captured: currentCalls.filter((c) => !c.cached).length, fast: pick(payload.fast), safe: pick(payload.safe),
    hasDistinctAlternative: payload.hasDistinctAlternative ?? false, alternativesAnalyzed: payload.alternativesAnalyzed ?? 0,
    directCandidateGenerated: payload.optimization?.directCandidateGenerated ?? false,
    candidates: (payload.candidateDiagnostics ?? []).map((c) => ({ source: c.source, legal: c.eligibleModeAndAccess, blocking: c.blockingRestrictionMeters,
      seconds: c.seconds, meters: c.distance, pave: c.paveMeters, weighted: c.weightedPaveMeters, risk: c.riskMeters, unknown: c.unknownSurfaceMeters,
      smooth: c.smoothSurfaceMeters, pareto: c.paretoOptimal, distinct: c.distinctFromFast })),
    profile: payload.routingProfile?.profile ?? null, provider: payload.routingProfile?.provider ?? null, calls: currentCalls };
  rows.push(row);
  await writeFile(new URL(`cases/${journey.id}-${mode}.json.gz`, out), gzipSync(JSON.stringify({ request: Object.fromEntries(params), status: response.status, payload })));
  const f = row.fast, s = row.safe;
  console.log(`${kind} ${journey.id} ${mode}: ${response.status} ${row.computeMs}ms calls=${row.providerCalls}(+${row.captured}) conf ${f?.confirmed ?? "-"}→${s?.confirmed ?? "-"} prob ${f?.probable ?? "-"}→${s?.probable ?? "-"} +${s && f ? s.seconds - f.seconds : "-"}s${row.hasDistinctAlternative ? " ALT" : ""}`);
}

try {
  const list = fixture.journeys.filter((j) => !only || j.id === only);
  for (const j of list) for (const mode of fixture.modes) await runCase(j, mode, "main");
  if (withStability) for (const j of fixture.stability.filter((s) => !only || s.baseId === only)) for (const mode of fixture.modes) await runCase(j, mode, "shift");
} finally { globalThis.fetch = nativeFetch; }

const summary = { label, generatedAt: new Date().toISOString(), runMode: live ? "capture-missing-then-replay" : "offline-replay",
  handlerSha256: sha256(await readFile(new URL("app/api/routes/route.ts", root))),
  optimizationSha256: sha256(await readFile(new URL("lib/route-optimization.ts", root))),
  milanTilesMetadataSha256: sha256(await readFile(new URL("data/surfaces/milan-tiles/metadata.json", root))),
  fixtureSha256: sha256(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root))),
  requests: rows.reduce((a, r) => a + r.providerCalls, 0), newlyCaptured: rows.reduce((a, r) => a + r.captured, 0),
  missingCaptures: [...new Set(missing)], rows };
await writeFile(new URL(`${only ? `${only}-` : ""}summary.json`, out), JSON.stringify(summary, null, 1) + "\n");
console.log(`rows=${rows.length} requests=${summary.requests} captured=${summary.newlyCaptured} missing=${summary.missingCaptures.length}`);
if (summary.missingCaptures.length) process.exitCode = 1;
