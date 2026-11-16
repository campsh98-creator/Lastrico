/**
 * Phase 4.36 routing-experiments: deterministic live sample for the early-stop variant on the corpus.
 * Candidates: corpus journeys (public landmark OD pairs of tests/fixtures/phase425-milan-journeys.json) whose production run skipped the penalised
 * search through `improvesCheaply` (baseAlreadyImproves) while >= 50 m of weighted stone remain on the shown route. Order: sha256("earlystop:"+id), first N.
 *   node exp-live-earlystop.mjs --n=6 [--live] [--budget=25]
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { OUT, CACHE, DEPARTURE, loadPatchedHandler, ProviderStub, runBaselineCase } from "./exp-harness.mjs";
import { VARIANTS } from "./exp-patches.mjs";
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const N = Number(arg("n", "6")), live = process.argv.includes("--live"), budget = Number(arg("budget", "25"));
const pb = JSON.parse(await readFile(new URL("pools-baseline.json", CACHE), "utf8"));
const cands = pb.cases.filter((c) => c.kind === "main" && c.pool && c.flags?.baseAlreadyImproves && c.pool[c.hasDistinctAlternative ? c.safeIndex : c.fastIndex].diag.risk >= 50)
  .sort((a, b) => createHash("sha256").update("earlystop:" + a.id).digest("hex").localeCompare(createHash("sha256").update("earlystop:" + b.id).digest("hex")));
const chosen = cands.slice(0, N);
const { GET } = await loadPatchedHandler(VARIANTS.G4.patches, "earlystop");
const rows = [];
for (const c of chosen) {
  const stub = new ProviderStub({ allowLive: live, liveBudget: budget, logFile: new URL("live-request-log.json", OUT), stage: `earlystop:${c.id}` });
  const r = await runBaselineCase(GET, stub, { id: c.id, mode: c.mode, start: c.start, end: c.end });
  const prodIdx = c.hasDistinctAlternative ? c.safeIndex : c.fastIndex, p = c.pool[prodIdx], f = c.pool[c.fastIndex];
  const idx = r.hasDistinctAlternative ? r.safeIndex : r.fastIndex, v = r.pool?.[idx], vf = r.pool?.[r.fastIndex];
  rows.push({ case: c.id, mode: c.mode, eligibleOfPool: cands.length, productionPick: { seconds: Math.round(p.duration), risk: p.diag.risk, confirmed: p.diag.confirmed, unknown: p.diag.unknown, uturns: p.uturns },
    variantPick: v ? { seconds: Math.round(v.duration), risk: v.diag.risk, confirmed: v.diag.confirmed, unknown: v.diag.unknown, uturns: v.uturns, source: v.source } : null, variantFastSeconds: vf ? Math.round(vf.duration) : null,
    productionFastSeconds: Math.round(f.duration), requestsProduction: c.calls.length, requestsVariant: r.calls.length, requestsNew: r.calls.filter((k) => k.hit === "live").length, missing: r.calls.filter((k) => k.hit === "miss").length, status: r.antiPave });
  console.log(JSON.stringify(rows.at(-1)));
}
await writeFile(new URL("earlystop-sample.json", OUT), JSON.stringify({ rule: "sha256('earlystop:'+id) ascending among early-stop cases with >= 50 m weighted stone left", eligible: cands.length, variant: "G4 stop-when-clean", rows }, null, 1) + "\n");
