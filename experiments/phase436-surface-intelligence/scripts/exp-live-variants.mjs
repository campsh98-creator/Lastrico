/**
 * Phase 4.36 routing-experiments: candidate-generation variants (patched production handler) on public-landmark cases.
 *   node exp-live-variants.mjs --cases=return,outbound [--variants=G0,G1,...] [--live] [--budget=25]
 * Offline by default (archive + Agent 1 cache + this experiment's own cache). With --live, a response missing from every cache is requested from
 * valhalla1.openstreetmap.de (>= 1.2 s apart, the handler's own honest User-Agent), logged with UTC time in
 * evidence/routing-experiments/live-request-log.json, and cached in data/exp-live-cache/; the total over ALL runs is capped by --budget.
 * Only PUBLIC landmark coordinates are used (named junctions found in OSM, or fixture landmarks); nothing derives from the GPS trace.
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, OUT, CACHE, DEPARTURE, loadPatchedHandler, ProviderStub, runBaselineCase, renderDiff, sha256, miss } from "./exp-harness.mjs";
import { VARIANTS } from "./exp-patches.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const live = process.argv.includes("--live");
const budget = Number(arg("budget", "25"));
const variantIds = arg("variants", Object.keys(VARIANTS).join(",")).split(",");
const caseIds = arg("cases", "return,outbound").split(",");
const logFile = new URL("live-request-log.json", OUT);
const SA0 = [9.2071562, 45.4507078], E1 = [9.1759083, 45.4437792]; // public OSM junctions (Via Lazzaro Papi north junction; Alzaia Naviglio Pavese junction)
const CASES = {
  return: { id: "replica-return", kind: "replica", mode: "car", start: SA0, end: E1, label: "Return-like replica: Via Lazzaro Papi north junction -> Alzaia Naviglio Pavese junction (public junctions; the real plan is not reproducible)" },
  returnh: { id: "replica-return-heading", kind: "replica", mode: "car", start: SA0, end: E1, heading: 121, label: "Return-like replica with a SE heading hint on the first location (the real plan started ON the one-way street; the junction alone is ambiguous)" },
  outbound: { id: "replica-outbound", kind: "replica", mode: "car", start: E1, end: SA0, label: "Outbound-like replica: Alzaia Naviglio Pavese junction -> Via Lazzaro Papi north junction (reverse corridor; the real outbound plan is unknown)" },
};
const store = JSON.parse(await readFile(new URL("pools-variants.json", CACHE), "utf8").catch(() => '{"runs":[]}'));
const evidence = JSON.parse(await readFile(new URL("variants-results.json", OUT), "utf8").catch(() => '{"runs":[]}'));
const patchDiffs = {};
for (const caseId of caseIds) {
  const c = CASES[caseId];
  for (const vid of variantIds) {
    const v = VARIANTS[vid];
    const { GET, diffs } = await loadPatchedHandler(v.patches, `variant-${vid}`);
    patchDiffs[vid] = diffs.filter((d) => d.id !== "P0-capture");
    const stub = new ProviderStub({ allowLive: live, liveBudget: budget, logFile, stage: `variants:${caseId}:${vid}` });
    if (c.heading) stub.bodyTransform = (b) => { b.locations[0].heading = c.heading; return b; };
    const r = await runBaselineCase(GET, stub, c, {});
    const run = { case: c.id, variant: vid, label: v.label, status: r.status, antiPave: r.antiPave, hasDistinctAlternative: r.hasDistinctAlternative ?? null,
      calls: r.calls.map((k) => ({ kind: k.kind, hit: k.hit, ms: k.ms, factors: k.factors, locations: k.locations })), requestsTotal: r.calls.length, requestsNew: r.calls.filter((k) => k.hit === "live").length, missing: miss(r.calls),
      flags: r.flags ?? null, fastSource: r.fastSource ?? null, safeSource: r.safeSource ?? null, pool: (r.pool ?? []).map((p) => ({ source: p.source, seconds: Math.round(p.duration), meters: Math.round(p.distance), confirmed: p.diag.confirmed, probable: p.diag.probable, unknown: p.diag.unknown, risk: p.diag.risk, maneuvers: p.maneuvers, uturns: p.uturns, verdict: p.diag.verdict, utility: p.diag.utility })), shown: r.shown ?? null };
    evidence.runs = evidence.runs.filter((x) => !(x.case === run.case && x.variant === vid)); evidence.runs.push(run);
    store.runs = store.runs.filter((x) => !(x.case === run.case && x.variant === vid)); store.runs.push({ case: c.id, variant: vid, start: c.start, end: c.end, mode: c.mode, result: r });
    console.log(`${c.id} ${vid} (${v.label}): status ${r.status} ${r.antiPave} calls=${run.requestsTotal} new=${run.requestsNew} missing=${run.missing} pool=${run.pool.map((p) => `${p.source}:${p.seconds}s/${p.confirmed}m`).join(" | ")}`);
  }
}
await writeFile(new URL("pools-variants.json", CACHE), JSON.stringify(store));
evidence.generatedBy = "exp-live-variants.mjs"; evidence.departure = DEPARTURE; evidence.budget = budget;
await writeFile(new URL("variants-results.json", OUT), JSON.stringify(evidence, null, 1) + "\n");
const log = JSON.parse(await readFile(logFile, "utf8").catch(() => '{"requests":[]}'));
console.log(`live requests so far: ${log.requests.length}/${budget}`);
void ROOT; void sha256;
