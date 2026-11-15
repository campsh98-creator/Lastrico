/**
 * Phase 4.36 routing-experiments: cross-check of model A / the feature layer against the recorded return plan (Agent 1: 25 / 0 / 285 m, 4.703 km),
 * and Q5 for the real plan. The trace is read LOCALLY; only aggregate numbers are written (no coordinates, no street names).
 *   node exp-crosscheck-return-plan.mjs "<trace.json>"
 * Pool = { route 0 (the plan), shortcut-first (route 0 up to the Via Friuli crossing, then route 1 = the route the driver actually followed after the
 * reroute; extra time ASSUMED: 22..180 s) }. The shortcut is a counterfactual candidate, not something the planner produced.
 */
import { readFile, writeFile } from "node:fs/promises";
import { OUT, DEPARTURE, sha256 } from "./exp-harness.mjs";
import { select, selectRobust, POLICY } from "./exp-models.mjs";
import { buildCase, makeContext, views } from "./exp-eval.mjs";
const trace = JSON.parse(await readFile(process.argv[2], "utf8"));
const [r0, r1] = trace.routes;
const ctx = await makeContext(JSON.parse(await readFile(new URL("base-rates.json", OUT), "utf8")));
const lenM = (cs) => cs.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - cs[i][0]) * 111320 * Math.cos(((p[1] + cs[i][1]) / 2 * Math.PI) / 180), (p[1] - cs[i][1]) * 110540), 0);
const spliced = [...r0.coordinates.slice(0, 5), ...r1.coordinates]; // the Via Friuli crossing is vertex 4 of route 0 (Agent 1, plan-reconstruct)
const out = { generatedBy: "exp-crosscheck-return-plan.mjs", departure: DEPARTURE, route0: {}, extraSecondsSweep: [] };
const results = [];
for (const extra of [22, 40, 60, 90, 120, 180]) {
  const entries = [
    { source: "route0-plan", coordinates: r0.coordinates, duration: r0.minutes * 60, distance: lenM(r0.coordinates), maneuvers: r0.instructions.length, uturns: 0, uturnInfo: [] },
    { source: "shortcut-first(counterfactual)", coordinates: spliced, duration: r1.minutes * 60 + extra, distance: lenM(spliced), maneuvers: r1.instructions.length + 1, uturns: 0, uturnInfo: [] },
  ];
  const cs = await buildCase({ id: "return-plan", mode: "car", kind: "replica", group: "REPLICA" }, entries, ctx, DEPARTURE, 0, 0);
  // fast = the plan's route (as in the app); the counterfactual is the alternative
  const row = { extraSeconds: extra, picks: {} };
  const M = { "A@L0": [(L) => select(views(cs, L), 0, cs.eq, "car"), "L0"], "A@Lb(ring sett)": [(L) => select(views(cs, L), 0, cs.eq, "car"), "Lb"], "A@Lac": [(L) => select(views(cs, L), 0, cs.eq, "car"), "Lac"],
    B: [(L) => select(views(cs, L, (e) => e.riskB), 0, cs.eq, "car"), "L0"], "C-global": [(L) => select(views(cs, L, (e) => e.risk + e.expG), 0, cs.eq, "car", { burden: (c) => c.risk }), "L0"], "C-zoned": [(L) => select(views(cs, L, (e) => e.risk + e.expZ), 0, cs.eq, "car", { burden: (c) => c.risk }), "L0"],
    "D-regret": [(L) => selectRobust(views(cs, L), 0, cs.eq, "car", { rule: "regret" }), "L0"], "D-maximin": [(L) => selectRobust(views(cs, L), 0, cs.eq, "car", { rule: "maximin" }), "L0"] };
  for (const [name, [fn, L]] of Object.entries(M)) row.picks[name] = cs.cands[fn(L).pick].source;
  out.extraSecondsSweep.push(row);
  if (extra === 22) {
    const c = cs.cands[0], s = cs.cands[1];
    out.route0 = { meters: Math.round(c.dist), seconds: Math.round(c.dur), L0: { confirmed: c.ex.L0.confirmed, probable: c.ex.L0.probable, unknown: c.ex.L0.unknown, risk: c.ex.L0.risk }, Lb_ringSett: { confirmed: c.ex.Lb.confirmed }, Lac: { confirmed: c.ex.Lac.confirmed, probable: c.ex.Lac.probable, risk: c.ex.Lac.risk },
      unknownByWhy: c.ex.L0.ch.unk, unknownByClass: c.ex.L0.ch.unkClass, expectedRoughMetresInUnknown: { global: c.ex.L0.expG, zoned: c.ex.L0.expZ }, railMetres: c.ex.L0.ch.rail };
    out.shortcutFirst = { meters: Math.round(s.dist), L0: { confirmed: s.ex.L0.confirmed, probable: s.ex.L0.probable, unknown: s.ex.L0.unknown, risk: s.ex.L0.risk }, expectedRoughMetresInUnknown: { global: s.ex.L0.expG, zoned: s.ex.L0.expZ }, railMetres: s.ex.L0.ch.rail };
    results.push(cs);
  }
}
// break-even extra time for A: shortcut stops being chosen when extra seconds x 0.8333 m/s >= risk saved
const risk0 = out.route0.L0.risk, riskLb = out.route0.Lb_ringSett.confirmed;
out.breakEvenSecondsSlowerThanPlanA = { baselineData: +(risk0 / (POLICY.car.div / 600)).toFixed(1), ringCounterfactualSett: +(riskLb / (POLICY.car.div / 600)).toFixed(1) };
out.reproducesRecordedPlan = { recorded: { confirmed: 25, probable: 0, unknown: 285, kmFromTrace: r0.distanceKm }, mine: { confirmed: out.route0.L0.confirmed, probable: out.route0.L0.probable, unknown: out.route0.L0.unknown, km: +(out.route0.meters / 1000).toFixed(3) } };
const text = JSON.stringify(out, null, 1) + "\n";
await writeFile(new URL("return-plan-crosscheck.json", OUT), text); await writeFile(new URL("return-plan-crosscheck.sha256", OUT), sha256(text) + "\n");
console.log(text);
