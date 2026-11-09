/**
 * Phase 4.31 — the three iPhone field journeys, reconstructed through the real /api/routes
 * handler. These are PROVIDER ROUTES between the reported end points, not the person's actual
 * traces (none were recorded). Car and motorcycle are both shown because B and C did not state
 * the mode. Provider responses go to the Phase 4.25 archive (≥1.1 s apart) and replay offline.
 *
 *   node scripts/phase431-field-journeys.mjs [--live]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";

const root = new URL("../", import.meta.url);
const live = process.argv.includes("--live");
const archive = new URL("outputs/phase425-benchmark/responses/", root);
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const nativeFetch = globalThis.fetch;
let lastNetworkAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function archivedFetch(url, init = {}) {
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  const key = sha256(JSON.stringify(request));
  const file = new URL(`${key}.json`, archive);
  let entry;
  try { entry = JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (!entry && !live) throw new Error(`No archived response: ${key}`);
  if (!entry) {
    await sleep(Math.max(0, 1100 - (Date.now() - lastNetworkAt)));
    lastNetworkAt = Date.now();
    const started = performance.now();
    const response = await nativeFetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    entry = { request, key, retrievedAt: new Date().toISOString(), status: response.status, elapsedMs: performance.now() - started, body, bodySha256: sha256(body) };
    if (entry.status < 500 && entry.status !== 429) await writeFile(file, JSON.stringify(entry) + "\n");
  }
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
}
function installFetch() {
  globalThis.fetch = async (url, init) => { try { return await archivedFetch(url, init); } finally { installFetch(); } };
}
installFetch();
const { GET } = await loadApi("app/api/routes/route.ts");

// End points: Piazza Gae Aulenti and Largo Promessi Sposi as in the Phase 4.29 fixture; M4 Vetra
// is the OSM station node 11638880259 (data/sources/milan-pilot-sw.osm.json.gz).
const GAE_AULENTI = [9.1902248, 45.4834778];
const PROMESSI_SPOSI = [9.1734728, 45.4349746];
const VETRA = [9.1825442, 45.4572551];
const journeys = [
  { test: "A", label: "Piazza Gae Aulenti → Largo Promessi Sposi", start: GAE_AULENTI, end: PROMESSI_SPOSI, modes: ["car"] },
  { test: "B", label: "Largo Promessi Sposi → M4 Vetra", start: PROMESSI_SPOSI, end: VETRA, modes: ["car", "motorcycle"] },
  { test: "C", label: "M4 Vetra → Largo Promessi Sposi", start: VETRA, end: PROMESSI_SPOSI, modes: ["car", "motorcycle"] },
];
const brief = (route) => ({
  minutes: Math.round(route.minutes * 10) / 10, km: Math.round(route.distance * 100) / 100,
  confirmedPave: route.confirmedPaveMeters, probablePave: route.probablePaveMeters, unknown: route.unknownSurfaceMeters,
  roughSections: (route.roughSections ?? []).map((s) => ({ at: s.startMeters, length: s.endMeters - s.startMeters, confirmed: s.confirmedMeters, probable: s.probableMeters, name: s.name ?? null, surface: s.surface ?? null })),
  roadFeatures: route.roadFeatures ? { coverage: route.roadFeatures.coverage, counts: route.roadFeatures.items.reduce((c, i) => ({ ...c, [i.type]: (c[i.type] ?? 0) + 1 }), {}) } : null,
});
const results = [];
try {
  for (const journey of journeys) {
    for (const mode of journey.modes) {
      const params = new URLSearchParams({ area: "milan", start: journey.start.join(","), end: journey.end.join(","), mode, avoid: "strong" });
      const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
      const payload = await response.json();
      if (response.status !== 200) { results.push({ test: journey.test, mode, status: response.status, error: payload.error }); continue; }
      results.push({ test: journey.test, label: journey.label, mode, hasDistinctAlternative: payload.hasDistinctAlternative,
        alternativesAnalyzed: payload.alternativesAnalyzed, fast: brief(payload.fast), antiPave: payload.hasDistinctAlternative ? brief(payload.safe) : null });
      console.log(`${journey.test} ${mode}: fast ${payload.fast.confirmedPaveMeters} m confirmed, ${payload.hasDistinctAlternative ? `anti-pavé ${payload.safe.confirmedPaveMeters} m (+${Math.round((payload.safe.minutes - payload.fast.minutes) * 60)} s)` : "no distinct alternative"}`);
    }
  }
} finally { globalThis.fetch = nativeFetch; }
await mkdir(new URL("outputs/phase431/", root), { recursive: true });
await writeFile(new URL("outputs/phase431/field-journeys-reconstructed.json", root), JSON.stringify({
  note: "Provider routes between the reported end points through the Phase 4.31 handler; not the person's actual GPS traces.",
  generatedAt: new Date().toISOString(), results }, null, 1) + "\n");
