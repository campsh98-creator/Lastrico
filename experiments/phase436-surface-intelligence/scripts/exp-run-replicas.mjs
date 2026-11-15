/**
 * Phase 4.36 routing-experiments: the two public-landmark replicas. Candidate pools produced by each generation variant (live/cached runs of
 * exp-live-variants.mjs, probe of exp-live-probes.mjs) are scored under every data layer and ranked by models A-D; Pareto sets (model E) and the
 * stone/time break-even are reported. Q5: would uncertainty-aware ranking have changed the outcome?
 *   node exp-run-replicas.mjs        (offline; reads data/exp-cache/pools-variants.json and probes.json)
 */
import { readFile, writeFile } from "node:fs/promises";
import { OUT, CACHE, DEPARTURE, sha256 } from "./exp-harness.mjs";
import { select, selectRobust, paretoIndices, POLICY } from "./exp-models.mjs";
import { buildCase, makeContext, views } from "./exp-eval.mjs";
const read = async (u) => JSON.parse(await readFile(u, "utf8"));
const ctx = await makeContext(await read(new URL("base-rates.json", OUT)));
const store = await read(new URL("pools-variants.json", CACHE));
const probes = await read(new URL("probes.json", CACHE));
const run = (c, v) => store.runs.find((r) => r.case === c && r.variant === v)?.result;
const entryOf = (p) => ({ source: p.source, coordinates: p.coordinates, duration: p.duration, distance: p.distance, maneuvers: p.maneuvers, uturns: p.uturns, uturnInfo: p.uturnInfo });
const poolSpecs = [];
for (const [caseId, variants] of [["replica-return-heading", ["G0", "G1", "G6"]], ["replica-outbound", ["G0", "G1", "G6"]]]) {
  for (const v of variants) {
    const r = run(caseId, v); if (!r?.pool) continue;
    poolSpecs.push({ name: `${caseId}/${v}`, caseId, variant: v, entries: r.pool.map(entryOf), prodRequests: r.calls.length });
    const probe = probes.find((p) => p.case === caseId);
    if (v === "G0" && probe?.routes[0]) poolSpecs.push({ name: `${caseId}/G0+P1(shortest)`, caseId, variant: "G0+P1", entries: [...r.pool.map(entryOf), { source: "probe-shortest", coordinates: probe.routes[0].coordinates, duration: probe.routes[0].seconds, distance: probe.routes[0].meters, maneuvers: probe.routes[0].maneuvers, uturns: probe.routes[0].uturns, uturnInfo: [] }], prodRequests: r.calls.length + 1 });
  }
}
const MODELS = {
  "A@L0": (cs, L = "L0", o = {}) => select(views(cs, L), cs.fastIdx, cs.eq, cs.mode, o),
  B: (cs, L = "L0", o = {}) => select(views(cs, L, (e) => e.riskB), cs.fastIdx, cs.eq, cs.mode, o),
  "C-global": (cs, L = "L0", o = {}) => select(views(cs, L, (e) => e.risk + e.expG), cs.fastIdx, cs.eq, cs.mode, { ...o, burden: (c) => c.risk }),
  "C-zoned": (cs, L = "L0", o = {}) => select(views(cs, L, (e) => e.risk + e.expZ), cs.fastIdx, cs.eq, cs.mode, { ...o, burden: (c) => c.risk }),
  "D-regret": (cs, L = "L0", o = {}) => selectRobust(views(cs, L), cs.fastIdx, cs.eq, cs.mode, { ...o, rule: "regret" }),
  "D-maximin": (cs, L = "L0", o = {}) => selectRobust(views(cs, L), cs.fastIdx, cs.eq, cs.mode, { ...o, rule: "maximin" }),
};
const out = { generatedBy: "exp-run-replicas.mjs", departure: DEPARTURE, pools: [] };
for (const spec of poolSpecs) {
  // fast = fastest candidate (provider reported time), as the handler does
  const fastIdx = spec.entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.duration - b.e.duration)[0].i;
  const cs = await buildCase({ id: spec.name, mode: "car", kind: "replica", group: "REPLICA" }, spec.entries, ctx, DEPARTURE, fastIdx, fastIdx);
  const cand = cs.cands.map((c) => ({ source: c.source, seconds: Math.round(c.dur), meters: Math.round(c.dist), maneuvers: c.maneuvers, uturns: c.uturns,
    L0: { confirmed: c.ex.L0.confirmed, probable: c.ex.L0.probable, unknown: c.ex.L0.unknown, risk: c.ex.L0.risk }, Lb_counterfactualRingSett: { confirmed: c.ex.Lb.confirmed, risk: c.ex.Lb.risk }, Lac: { confirmed: c.ex.Lac.confirmed, probable: c.ex.Lac.probable, risk: c.ex.Lac.risk, unknown: c.ex.Lac.unknown },
    railMetres: c.ex.L0.ch.rail, riskB: c.ex.L0.riskB, expectedRoughInUnknown: { global: c.ex.L0.expG, zoned: c.ex.L0.expZ } }));
  const picks = {};
  for (const [name, fn] of Object.entries(MODELS)) for (const L of ["L0", "Lb", "Lac"]) { const r = fn(cs, L); picks[`${name}@${L}`] = { pick: cs.cands[r.pick].source, distinct: r.distinct }; }
  for (const lv of ["balanced", "strong", "maximum"]) { const r = MODELS["A@L0"](cs, "L0", { avoidance: lv }); picks[`A@L0/${lv}`] = { pick: cs.cands[r.pick].source }; const r2 = MODELS["A@L0"](cs, "Lb", { avoidance: lv }); picks[`A@Lb/${lv}`] = { pick: cs.cands[r2.pick].source }; }
  // break-even: smallest multiplier of the production stone/time exchange at which the cleanest candidate is chosen (strong limits kept)
  const cleanest = cs.cands.map((c, i) => ({ c, i })).sort((a, b) => a.c.ex.L0.risk - b.c.ex.L0.risk || a.c.dur - b.c.dur)[0];
  const breakEven = {};
  for (const L of ["L0", "Lb"]) {
    const rows = []; let first = null;
    for (const k of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8, 12, 16]) { const r = MODELS["A@L0"](cs, L, { secondsWeightMul: 1 / k }); const src = cs.cands[r.pick].source; rows.push([k, src]); if (first === null && r.pick === cleanest.i) first = k; }
    breakEven[L] = { cleanestCandidate: cleanest.c.source, cleanestRiskL0: cleanest.c.ex[L].risk, firstMultiplierPickingCleanest: first, secondsPerMetreCarAtThatMultiplier: first ? +(1.2 * first).toFixed(2) : null, sweep: rows };
  }
  const P = paretoIndices(cs.cands.map((c) => ({ i: c.i })), (v) => [cs.cands[v.i].dur, cs.cands[v.i].ex.L0.confirmed, cs.cands[v.i].ex.L0.probable, cs.cands[v.i].ex.L0.unknown, cs.cands[v.i].maneuvers, cs.cands[v.i].uturns]);
  out.pools.push({ pool: spec.name, requestsToBuildPool: spec.prodRequests, fastest: cs.cands[fastIdx].source, candidates: cand, picks, breakEvenExchange: breakEven, pareto6: P.map((i) => cs.cands[i].source) });
}
const text = JSON.stringify(out, null, 1) + "\n";
await writeFile(new URL("replicas.json", OUT), text);
await writeFile(new URL("replicas.sha256", OUT), sha256(text) + "\n");
for (const p of out.pools) {
  console.log("==", p.pool, "requests", p.requestsToBuildPool, "fast", p.fastest);
  for (const c of p.candidates) console.log("  ", c.source.padEnd(26), c.seconds + "s", c.meters + "m", "conf", c.L0.confirmed, "unk", c.L0.unknown, "Lb conf", c.Lb_counterfactualRingSett.confirmed, "Lac conf", c.Lac.confirmed, "man", c.maneuvers, "ut", c.uturns, "rail", JSON.stringify(c.railMetres));
  console.log("  picks:", Object.entries(p.picks).map(([k, v]) => `${k}=${v.pick}`).join("  "));
  console.log("  breakEven L0:", p.breakEvenExchange.L0.cleanestCandidate, p.breakEvenExchange.L0.firstMultiplierPickingCleanest, "| Lb:", p.breakEvenExchange.Lb.firstMultiplierPickingCleanest, "pareto6:", p.pareto6.join(","));
}
