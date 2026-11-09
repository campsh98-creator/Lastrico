/**
 * Phase 4.31 release gate — records the permanent regression fixtures for the anti-pavé outcome:
 * the exact provider responses each case needs (from the Phase 4.25 archive, so the test runs the
 * real handler offline) and the resulting payloads for the browser scenarios.
 *
 *   node scripts/record-phase431-anti-pave-fixtures.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { installArchivedProvider } from "./lib/archived-provider.mjs";

const root = new URL("../", import.meta.url);
const providerDir = new URL("tests/fixtures/phase431-anti-pave/provider/", root);
await mkdir(providerDir, { recursive: true });
const provider = installArchivedProvider({ live: false });
const { GET } = await loadApi("app/api/routes/route.ts");

const PROMESSI_SPOSI = "9.1734728,45.4349746";
export const CASES = [
  { id: "porta-vittoria-car", label: "Porta Romana / Filippetti: a useful anti-pavé alternative", start: "9.2025,45.4625", end: PROMESSI_SPOSI, mode: "car", expect: "alternative" },
  { id: "porta-vittoria-car-no-extra", label: "Same journey with 0 extra minutes allowed", start: "9.2025,45.4625", end: PROMESSI_SPOSI, mode: "car", maxExtraMinutes: "0", expect: "over-extra-time" },
  { id: "regina-margherita-car", label: "Approach to Porta Romana by car: the anti-pavé search must run", start: "9.205341,45.458728", end: PROMESSI_SPOSI, mode: "car", expect: "fastest-avoids-pave" },
  { id: "regina-margherita-motorcycle-reroute", label: "Reroute on the approach by motorcycle (the field case)", start: "9.205341,45.458728", end: PROMESSI_SPOSI, mode: "motorcycle", navigation: true, expect: "fastest-avoids-pave" },
  { id: "regina-margherita-motorcycle-reroute-search-down", label: "Same reroute with the anti-pavé search failing at the provider", start: "9.205341,45.458728", end: PROMESSI_SPOSI, mode: "motorcycle", navigation: true, failSearch: true, expect: "generation-failed" },
  { id: "promessi-sposi-vetra-car", label: "Promessi Sposi → Vetra: no meaningful improvement exists", start: PROMESSI_SPOSI, end: "9.1825442,45.4572551", mode: "car", expect: "no-better-route" },
];

const nativeFetch = globalThis.fetch;
const payloads = {};
for (const c of CASES) {
  provider.reset();
  // The penalised (anti-pavé) provider call answers 503, as during a provider outage.
  provider.state.failWhen = c.failSearch ? (request) => String(request.body ?? "").includes("linear_cost_factors") : null;
  const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid: "strong", departure: "2026-11-09T12:00" });
  if (c.navigation) params.set("navigation", "1");
  if (c.maxExtraMinutes) params.set("maxExtraMinutes", c.maxExtraMinutes);
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  console.log(`${c.id}: ${response.status} ${payload.antiPave?.status} (expected ${c.expect}) calls ${provider.state.calls.length}`);
  for (const call of provider.state.calls.filter((call) => call.key)) {
    const entry = await readFile(new URL(`../outputs/phase425-benchmark/responses/${call.key}.json`, import.meta.url));
    await writeFile(new URL(`${call.key}.json.gz`, providerDir), gzipSync(entry));
  }
  // Diagnostics are server-side detail; the fixture keeps what the browser receives and shows.
  const visible = { ...payload };
  delete visible.candidateDiagnostics;
  payloads[c.id] = visible;
}
globalThis.fetch = nativeFetch;
provider.restore();
await writeFile(new URL("tests/fixtures/phase431-anti-pave/cases.json", root), JSON.stringify({
  note: "Phase 4.31 release gate. Provider responses are real (FOSSGIS Valhalla, archived); departure Monday 9 November 2026 12:00.",
  cases: CASES }, null, 1) + "\n");
await mkdir(new URL("tests/e2e/fixtures/", root), { recursive: true });
for (const [id, payload] of Object.entries(payloads)) {
  await writeFile(new URL(`tests/e2e/fixtures/phase431-${id}.json`, root), JSON.stringify(payload) + "\n");
}
