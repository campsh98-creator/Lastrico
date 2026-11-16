/**
 * Phase 4.36 routing-experiments, step 1: model A (production baseline) over the Phase 4.25 Milan corpus, offline from the archive.
 *   node experiments/phase436-surface-intelligence/scripts/exp-run-baseline.mjs
 * Writes (git-ignored) data/exp-cache/pools-baseline.json (full pools, with geometry) and the compact, coordinate-free
 * evidence/routing-experiments/baseline-reproduction.json (cross-check against the stored Phase 4.31 results).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ROOT, OUT, CACHE, DEPARTURE, loadPatchedHandler, ProviderStub, runBaselineCase, sha256, miss } from "./exp-harness.mjs";

const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", ROOT), "utf8"));
const stored = JSON.parse(await readFile(new URL("outputs/phase431/anti-pave-availability-p431-decision-noon-vs-p431-decision-swap.json", ROOT), "utf8"));
const storedBy = new Map(stored.rows.map((r) => [r.case, r.after]));

const cases = [];
for (const j of fixture.journeys) for (const mode of fixture.modes) cases.push({ id: `${j.id}-${mode}`, journey: j.id, mode, kind: "main", start: j.start, end: j.end });
for (const j of fixture.stability) for (const mode of fixture.modes) cases.push({ id: `${j.id}-${mode}`, journey: j.id, baseId: j.baseId, mode, kind: "shift", start: j.start, end: j.end });

{
  const { GET } = await loadPatchedHandler([], "baseline");
  const stub = new ProviderStub();
  const results = [];
  const t0 = Date.now();
  for (const c of cases) { results.push(await runBaselineCase(GET, stub, c)); }
  await mkdir(CACHE, { recursive: true });
  const poolsFile = JSON.stringify({ departure: DEPARTURE, cases: results });
  await writeFile(new URL("pools-baseline.json", CACHE), poolsFile);

  // Cross-check against the stored Phase 4.31 results (264 main cases).
  const main = results.filter((r) => r.kind === "main");
  let compared = 0, same = 0; const diffs = [];
  const statusCounts = {};
  let shownKnownPave = 0, shownConfirmed = 0;
  for (const r of main) {
    statusCounts[r.antiPave ?? "error"] = (statusCounts[r.antiPave ?? "error"] ?? 0) + 1;
    const st = storedBy.get(r.id);
    if (!st) continue;
    compared += 1;
    const shownPave = r.shown ? (r.hasDistinctAlternative ? r.shown.safePave : r.shown.fastPave) : null;
    const shownConf = r.shown ? (r.hasDistinctAlternative ? r.shown.safeConfirmed : r.shown.fastConfirmed) : null;
    const shownSeconds = r.shown ? (r.hasDistinctAlternative ? r.shown.safeSeconds : r.shown.fastSeconds) : null;
    if (shownPave !== null) { shownKnownPave += shownPave; shownConfirmed += shownConf; }
    const ok = st.status === "error" ? (r.antiPave ?? "error") === "error" : (st.status === (r.antiPave ?? "error")) && st.shownPave === shownPave && st.shownConfirmed === shownConf && st.shownSeconds === shownSeconds;
    if (ok) same += 1; else diffs.push({ id: r.id, stored: st, mine: { status: r.antiPave, shownPave, shownConf, shownSeconds } });
  }
  const callTotals = { all: 0, archive: 0, miss: 0 };
  for (const r of results) for (const call of r.calls) { callTotals.all += 1; if (call.hit === "miss") callTotals.miss += 1; else callTotals.archive += 1; }
  const evidence = {
    generatedBy: "experiments/phase436-surface-intelligence/scripts/exp-run-baseline.mjs", departure: DEPARTURE, handlerPatches: ["P0-capture (no behaviour change)"],
    cases: { main: main.length, shift: results.length - main.length },
    crossCheckAgainst: "outputs/phase431/anti-pave-availability-p431-decision-noon-vs-p431-decision-swap.json (rows[].after, 264 cases)",
    compared, identical: same, differing: diffs.length, differences: diffs.slice(0, 20),
    statusCountsMine: statusCounts, statusCountsStoredAfter: stored.summary.statusAfter,
    shownKnownPaveMeters: { mine: shownKnownPave, stored: stored.summary.shownKnownPaveAfter }, shownConfirmedMeters: { mine: shownConfirmed, stored: stored.summary.shownConfirmedAfter },
    providerCalls: callTotals, casesWithMissingResponses: results.filter((r) => miss(r.calls) > 0).map((r) => r.id),
    poolsFileSha256: sha256(poolsFile),
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL("baseline-reproduction.json", OUT), JSON.stringify(evidence, null, 1) + "\n");
  console.log(JSON.stringify({ ...evidence, differences: evidence.differences.slice(0, 5) }, null, 1));
}
