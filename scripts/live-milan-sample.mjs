/** Phase 4.25 — rate-limited live sample against a locally served build (wrangler dev --local).
 * Real provider, real Worker bundle; ≥10 s between requests. The first request after the server
 * starts is the cold one; the same journey is repeated at the end as a warm reference.
 *   node scripts/live-milan-sample.mjs --label=before [--base=http://127.0.0.1:8799]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const label = arg("label") ?? "run";
const baseUrl = arg("base") ?? "http://127.0.0.1:8799";
const root = new URL("../", import.meta.url);
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root), "utf8"));
const IDS = ["duomo-brera", "castello-porta-romana", "corvetto-duomo", "san-siro-forlanini"];
const cases = [];
for (const mode of fixture.modes) for (const id of IDS) cases.push({ id, mode });
cases.push({ ...cases[0], repeat: "warm" });
const results = [];
let last = 0;
for (const c of cases) {
  const j = fixture.journeys.find((x) => x.id === c.id);
  const wait = Math.max(0, 10_000 - (Date.now() - last));
  if (last) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const params = new URLSearchParams({ start: j.start.join(","), end: j.end.join(","), mode: c.mode, avoid: "strong" });
  const started = performance.now();
  let status = null, payload = null, error = null;
  try {
    const res = await fetch(`${baseUrl}/api/routes?${params}`, { signal: AbortSignal.timeout(30_000) });
    status = res.status; payload = await res.json();
  } catch (e) { error = String(e); }
  const ms = Math.round(performance.now() - started);
  const row = { id: c.id, mode: c.mode, repeat: c.repeat ?? null, status, ms, error,
    serverTotalMs: payload?.performance?.totalMs ?? null, routingMs: payload?.performance?.routingAndSurfaceDataMs ?? null,
    scoringMs: payload?.performance?.candidateGenerationAndScoringMs ?? null, alternatives: payload?.alternativesAnalyzed ?? null,
    hasDistinctAlternative: payload?.hasDistinctAlternative ?? null,
    fastConfirmed: payload?.fast?.confirmedPaveMeters ?? null, chosenConfirmed: payload?.safe?.confirmedPaveMeters ?? null,
    extraSeconds: payload?.fast ? Math.round((payload.safe.minutes - payload.fast.minutes) * 60) : null };
  results.push(row);
  console.log(JSON.stringify(row));
}
const ok = results.filter((r) => r.status === 200);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };
const summary = { label, baseUrl, generatedAt: new Date().toISOString(), spacing: "≥10 s between request starts; real FOSSGIS Valhalla",
  requests: results.length, http200: ok.length, coldMs: results[0]?.ms ?? null,
  warmMedianMs: q(ok.slice(1).map((r) => r.ms), 0.5), warmP90Ms: q(ok.slice(1).map((r) => r.ms), 0.9), warmMaxMs: Math.max(...ok.slice(1).map((r) => r.ms)),
  serverScoringMedianMs: q(ok.map((r) => r.scoringMs), 0.5), results };
await mkdir(new URL("outputs/phase425-benchmark/", root), { recursive: true });
await writeFile(new URL(`outputs/phase425-benchmark/live-${label}.json`, root), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify({ ...summary, results: undefined }));
