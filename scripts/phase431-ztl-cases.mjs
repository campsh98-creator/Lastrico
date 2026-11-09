/**
 * Phase 4.31 — ZTL and time-window cases through the real /api/routes handler (provider
 * responses archived; --live captures missing ones). Departure times are explicit, so every run
 * is reproducible. Monday 9 November 2026 is used: 12:00 (Navigli evening ZTL inactive) and 21:00
 * (active), without and with the person's authorisation.
 *
 *   node scripts/phase431-ztl-cases.mjs [--live]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";
import { installArchivedProvider } from "./lib/archived-provider.mjs";

const live = process.argv.includes("--live");
const provider = installArchivedProvider({ live });
const { GET } = await loadApi("app/api/routes/route.ts");
const PROMESSI_SPOSI = [9.1734728, 45.4349746];
const VETRA = [9.1825442, 45.4572551];
// A destination on Via Monte Napoleone (inside the mapped Quadrilatero polygon) and one on Via Magolfa.
const MONTENAPOLEONE = [9.1953, 45.4683];
const PIAZZA_CAVOUR = [9.1958, 45.4731];
const MAGOLFA = [9.17567, 45.44961];
const cases = [];
for (const mode of ["car", "motorcycle", "bicycle"]) {
  for (const [label, start, end] of [["B Promessi Sposi → Vetra", PROMESSI_SPOSI, VETRA], ["C Vetra → Promessi Sposi", VETRA, PROMESSI_SPOSI]]) {
    cases.push({ label, mode, start, end, departure: "2026-11-09T12:00", ztl: "" });
    cases.push({ label, mode, start, end, departure: "2026-11-09T21:00", ztl: "" });
    cases.push({ label, mode, start, end, departure: "2026-11-09T21:00", ztl: "ztl-via-mario-pichi" });
  }
}
cases.push({ label: "Vetra → Via Magolfa (in ZTL Navigli)", mode: "car", start: VETRA, end: MAGOLFA, departure: "2026-11-09T21:00", ztl: "" });
cases.push({ label: "Vetra → Via Magolfa (in ZTL Navigli)", mode: "car", start: VETRA, end: MAGOLFA, departure: "2026-11-09T21:00", ztl: "ztl-via-mario-pichi" });
cases.push({ label: "Piazza Cavour → Via Monte Napoleone (Quadrilatero)", mode: "car", start: PIAZZA_CAVOUR, end: MONTENAPOLEONE, departure: "2026-11-09T12:00", ztl: "" });
cases.push({ label: "Piazza Cavour → Via Monte Napoleone (Quadrilatero)", mode: "car", start: PIAZZA_CAVOUR, end: MONTENAPOLEONE, departure: "2026-11-09T12:00", ztl: "ztl-quadrilatero-della-moda" });
cases.push({ label: "Piazza Cavour → Via Monte Napoleone (Quadrilatero)", mode: "bicycle", start: PIAZZA_CAVOUR, end: MONTENAPOLEONE, departure: "2026-11-09T12:00", ztl: "" });

const brief = (route) => route && ({
  minutes: Math.round(route.minutes * 10) / 10, km: Math.round(route.distance * 100) / 100,
  confirmedPave: route.confirmedPaveMeters, probablePave: route.probablePaveMeters,
  access: route.access ?? null,
});
const results = [];
try {
  for (const c of cases) {
    provider.reset();
    const params = new URLSearchParams({ area: "milan", start: c.start.join(","), end: c.end.join(","), mode: c.mode, avoid: "strong", departure: c.departure });
    if (c.ztl) params.set("ztl", c.ztl);
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    const payload = await response.json();
    const sources = (payload.candidateDiagnostics ?? []).map((d) => `${d.source}${d.eligibleModeAndAccess ? "" : "✗"}`);
    const row = { ...c, status: response.status, error: payload.error ?? null, hasDistinctAlternative: payload.hasDistinctAlternative ?? null,
      fast: brief(payload.fast), antiPave: payload.hasDistinctAlternative ? brief(payload.safe) : null, sources,
      providerCalls: provider.state.calls.length, accessContext: payload.accessContext ?? null,
      notice: payload.dataNotice?.match(/\. (Partenza o destinazione in [^.]+|Attraversa [^.]+)/g) ?? [] };
    results.push(row);
    const shown = row.antiPave ?? row.fast;
    console.log(`${c.label} | ${c.mode} | ${c.departure.slice(11)} | ztl=${c.ztl || "-"} → ${response.status}${row.error ? ` ${row.error}` : ` ${shown.km} km ${shown.minutes} min conf ${shown.confirmedPave} | ztl ${JSON.stringify(shown.access?.ztl ?? [])} auth ${JSON.stringify(shown.access?.authorisedZtl ?? [])} | ${sources.join(",")}`}`);
  }
} finally { provider.restore(); }
await mkdir(new URL("../outputs/phase431/", import.meta.url), { recursive: true });
await writeFile(new URL("../outputs/phase431/ztl-cases.json", import.meta.url), JSON.stringify({
  note: "Provider routes through the Phase 4.31 handler at explicit departure times; ZTL areas from OSM tags in the repository.",
  generatedAt: new Date().toISOString(), results }, null, 1) + "\n");
if (provider.state.missing.length) { console.log(`missing ${provider.state.missing.length}`); process.exitCode = 1; }
