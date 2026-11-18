/**
 * General-purpose navigation across Milan's service area: calculates a small set of public-landmark journeys
 * (inside Milan, to Malpensa, Linate, Monza, Como, Bergamo, and from outside into Milan) with the real route handler.
 * Provider answers are recorded in tests/fixtures/region/provider (gzip, keyed like the other fixtures) and replayed
 * offline; only a missing answer goes to the network, under a hard cap and serially.
 *
 *   node scripts/record-region-journeys.mjs [--live-cap=45] [--out=work/region-journeys.json]
 * Coordinates are public places only. No private trace is involved.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { PILOT_AREAS, coordinateInCoverage } from "../lib/pilot-areas.ts";
import { PROVIDER_USER_AGENT } from "../lib/provider-identity.ts";

const root = new URL("../", import.meta.url);
const dir = new URL("tests/fixtures/region/provider/", root);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const liveCap = Number(arg("live-cap") ?? 45);
export const JOURNEYS = JSON.parse(await readFile(new URL("tests/fixtures/region/journeys.json", root), "utf8")).journeys;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const nativeFetch = globalThis.fetch;
let live = 0, replayed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(dir, { recursive: true });
globalThis.fetch = async (url, init = {}) => {
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  const key = sha(JSON.stringify(request));
  const file = new URL(`${key}.json.gz`, dir);
  try {
    const entry = JSON.parse(gunzipSync(await readFile(file)));
    replayed++;
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (live >= liveCap) throw new Error(`live request cap ${liveCap} reached`);
  live++;
  await sleep(1400);
  const res = await nativeFetch(url, { ...init, headers: { ...(init.headers ?? {}), "User-Agent": PROVIDER_USER_AGENT } });
  const body = await res.text();
  if (res.status === 200 || res.status === 400 || res.status === 404) await writeFile(file, gzipSync(JSON.stringify({ request, status: res.status, body, retrievedAt: new Date().toISOString() })));
  return new Response(body, { status: res.status, headers: { "Content-Type": "application/json" } });
};
const { GET } = await loadApi("app/api/routes/route.ts");
const share = (route) => { const total = route.surfaceTotalMeters ?? 0; return total ? Math.round((1 - (route.unknownSurfaceMeters ?? 0) / total) * 1000) / 10 : null; };
const rows = [];
for (const j of JOURNEYS) {
  const requests = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (u, i) => { requests.push(String(u)); return before(u, i); };
  const t = Date.now(); const cpu = process.cpuUsage();
  const params = new URLSearchParams({ start: j.start, end: j.end, mode: j.mode ?? "car", avoid: j.avoid ?? "strong", departure: "2026-11-09T12:00" });
  if (j.navigation) params.set("navigation", "1");
  let res; let payload = null;
  try { res = await GET(new NextRequest(`http://localhost/api/routes?${params}`)); payload = await res.json(); } catch (e) { payload = { error: String(e.message) }; }
  const c = process.cpuUsage(cpu);
  globalThis.fetch = before;
  const s = payload?.safe, f = payload?.fast;
  const pt = (str) => str.split(",").map(Number);
  rows.push({
    id: j.id, status: res?.status ?? null, error: payload?.error ?? null, area: payload?.area ?? null,
    startInCoverage: coordinateInCoverage(pt(j.start), PILOT_AREAS.milan), endInCoverage: coordinateInCoverage(pt(j.end), PILOT_AREAS.milan),
    km: s ? Math.round(s.distance * 10) / 10 : null, minutes: s ? Math.round(s.minutes * 10) / 10 : null,
    coveragePercentSafe: s ? s.surfaceCoveragePercent ?? share(s) : null, unknownMetersSafe: s?.unknownSurfaceMeters ?? null,
    confirmedSafe: s?.confirmedPaveMeters ?? null, confirmedFast: f?.confirmedPaveMeters ?? null, alt: payload?.hasDistinctAlternative ?? null,
    providerRequests: requests.length, cpuMs: Math.round((c.user + c.system) / 1000), wallMs: Date.now() - t, surfaceDataAvailable: payload?.surfaceDataAvailable ?? null,
  });
}
const out = { liveRequests: live, replayed, rows };
if (arg("out")) { const { dirname } = await import("node:path"); await mkdir(dirname(arg("out")), { recursive: true }); await writeFile(arg("out"), JSON.stringify(out, null, 1)); }
console.log(JSON.stringify(out, null, 1));
