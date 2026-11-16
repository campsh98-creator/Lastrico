/**
 * Phase 4.36 routing-experiments: the FIELD set (Phase 4.31 field cases, Filippetti / Porta Romana approach, ZTL cases) through the
 * production handler offline from the archive; cases whose provider responses are not archived are reported and skipped.
 *   node experiments/phase436-surface-intelligence/scripts/exp-run-field.mjs
 * Labels: these are corridors where the user reported stone in Phase 4.31 (user observation, not measured) and OSM claims.
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, OUT, CACHE, DEPARTURE, loadPatchedHandler, ProviderStub, runBaselineCase, miss } from "./exp-harness.mjs";
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const PS = [9.1734728, 45.4349746]; // Largo Promessi Sposi (public landmark of the Phase 4.31 field case)
const cases = [];
const add = (c) => { const k = JSON.stringify([c.start, c.end, c.mode, c.params ?? {}]); if (!cases.some((x) => x.k === k)) cases.push({ ...c, k }); };
const fx = await read("tests/fixtures/phase431-anti-pave/cases.json");
for (const c of fx.cases) {
  if (c.failSearch) continue;
  const params = { ...(c.navigation ? { navigation: "1" } : {}), ...(c.maxExtraMinutes ? { maxExtraMinutes: c.maxExtraMinutes } : {}) };
  add({ id: `f431-${c.id}`, kind: "field", mode: c.mode, start: c.start.split(",").map(Number), end: c.end.split(",").map(Number), params });
}
const approach = [["regina-margherita", [9.205341, 45.458728]], ["caldara-start", [9.203196, 45.455049]], ["caldara-before-medaglie", [9.202064, 45.45278]], ["porta-vittoria", [9.2025, 45.4625]]];
for (const [name, start] of approach) for (const mode of ["car", "motorcycle"]) for (const nav of [false, true])
  add({ id: `gate-${name}-${mode}${nav ? "-nav" : ""}`, kind: "field", mode, start, end: PS, params: nav ? { navigation: "1" } : {} });
add({ id: "gae-aulenti-promessi-sposi-car", kind: "field", mode: "car", start: [9.1902248, 45.4834778], end: PS, params: {} });
const z = await read("outputs/phase431/ztl-cases.json");
for (const r of z.results) {
  if (r.status !== 200) continue;
  add({ id: `ztl-${r.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 28)}-${r.mode}-${r.departure.slice(11, 13)}${r.ztl ? "-auth" : ""}`, kind: "ztl", mode: r.mode, start: r.start, end: r.end, params: { departure: r.departure, ...(r.ztl ? { ztl: r.ztl } : {}) } });
}
const { GET } = await loadPatchedHandler([], "field");
const stub = new ProviderStub();
const results = [], skipped = [];
for (const c of cases) {
  const r = await runBaselineCase(GET, stub, c);
  if (miss(r.calls) > 0 || !r.pool) skipped.push({ id: c.id, missing: miss(r.calls), status: r.status }); else results.push(r);
}
await writeFile(new URL("pools-field.json", CACHE), JSON.stringify({ departure: DEPARTURE, cases: results }));
const ev = { generatedBy: "exp-run-field.mjs", requested: cases.length, ran: results.length, skipped, statuses: Object.fromEntries(Object.entries(results.reduce((a, r) => { a[r.antiPave] = (a[r.antiPave] ?? 0) + 1; return a; }, {}))) };
await writeFile(new URL("field-set.json", OUT), JSON.stringify(ev, null, 1) + "\n");
console.log(JSON.stringify(ev, null, 1));
