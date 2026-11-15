/**
 * Phase 4.36 routing-experiments: scoring models A-E x data layers on a FIXED candidate pool (cells 1-4 of the experiment matrix),
 * offline from the archive. The pool of each case is what the production handler generated (pools-baseline.json / pools-field.json).
 *   node experiments/phase436-surface-intelligence/scripts/exp-run-scoring.mjs
 * Outputs (evidence/routing-experiments/): scoring-summary.json, scoring-cases.csv, scoring-regressions.json, pareto-summary.json,
 * stability.json, sensitivity.json. No coordinates, no street names beyond the public corridor names.
 */
import { writeFile } from "node:fs/promises";
import { OUT, CACHE, sha256 } from "./exp-harness.mjs";
import { select, selectRobust, paretoIndices, POLICY, secondsPerMetre } from "./exp-models.mjs";
import { loadAllCases, views, pickMetrics, compareToProduction } from "./exp-eval.mjs";

const t0 = Date.now();
const { cases, ctx, split, departure } = await loadAllCases();
const pb = { departure };
console.error(`built ${cases.length} cases in ${Math.round((Date.now() - t0) / 1000)} s`);

// ---------- models ----------
const MODELS = {
  A: (cs, L, o = {}) => select(views(cs, L), cs.fastIdx, cs.eq, cs.mode, o).pick,
  B: (cs, L, o = {}) => select(views(cs, L, (e) => e.riskB), cs.fastIdx, cs.eq, cs.mode, o).pick,
  // C: unknown metres enter as expected rough metres (prior x scale); production's asymmetric unknown burden is replaced.
  C: (cs, L, o = {}) => {
    const key = (o.prior ?? "global") === "global" ? "expG" : "expZ"; const scale = o.scale ?? 1;
    const V = views(cs, L, (e) => e.risk + scale * e[key]);
    return select(V, cs.fastIdx, cs.eq, cs.mode, { ...o, burden: (c) => c.risk }).pick;
  },
  D: (cs, L, o = {}) => selectRobust(views(cs, L), cs.fastIdx, cs.eq, cs.mode, o).pick,
};
const CELLS = [
  // matrix cell (1) baseline data + baseline scoring
  { id: "A@L0", cell: 1, model: "A", layer: "L0" },
  // cell (2) baseline data + alternative scoring
  { id: "B@L0", cell: 2, model: "B", layer: "L0" },
  { id: "C-global@L0", cell: 2, model: "C", layer: "L0", o: { prior: "global" } },
  { id: "C-zoned@L0", cell: 2, model: "C", layer: "L0", o: { prior: "zoned" } },
  { id: "D-regret@L0", cell: 2, model: "D", layer: "L0", o: { rule: "regret" } },
  { id: "D-maximin@L0", cell: 2, model: "D", layer: "L0", o: { rule: "maximin" } },
  // cell (3) enhanced data + baseline scoring
  { id: "A@La", cell: 3, model: "A", layer: "La" },
  { id: "A@Lc", cell: 3, model: "A", layer: "Lc" },
  { id: "A@Lac", cell: 3, model: "A", layer: "Lac" },
  { id: "A@Lb", cell: 3, model: "A", layer: "Lb" },
  // cell (4) enhanced data + alternative scoring
  { id: "B@Lac", cell: 4, model: "B", layer: "Lac" },
  { id: "C-global@Lac", cell: 4, model: "C", layer: "Lac", o: { prior: "global" } },
  { id: "D-regret@Lac", cell: 4, model: "D", layer: "Lac", o: { rule: "regret" } },
];

const R = {}; // R[cellId][caseIdx] = { pick, vsA, m0, mac }
function evaluate(cellId, fn, own = "L0") {
  R[cellId] = cases.map((cs) => {
    const pick = fn(cs);
    return { pick, vsA: compareToProduction(cs, pick, cs.prodPick, "L0"), vsAown: compareToProduction(cs, pick, cs.prodPick, own), mown: pickMetrics(cs, pick, own), vsAac: compareToProduction(cs, pick, cs.prodPick, "Lac"), m0: pickMetrics(cs, pick, "L0"), mac: pickMetrics(cs, pick, "Lac") };
  });
}
for (const c of CELLS) evaluate(c.id, (cs) => MODELS[c.model](cs, c.layer, c.o), c.layer);

// Assertion: model A re-implementation == production handler decision on every case.
const mismatch = cases.map((cs, k) => (R["A@L0"][k].pick !== cs.prodPick ? cs.id : null)).filter(Boolean);
console.error(`A@L0 vs production handler: ${cases.length - mismatch.length}/${cases.length} identical picks`, mismatch.slice(0, 5));

// ---------- aggregation ----------
const GROUPS = ["CORRIDOR", "DEV", "HOLDOUT", "FIELD"];
const EXCESSIVE = (m) => m.dt > 300 || m.ddPct > 0.30; // excessive detour: > 5 min or > 30 % longer than the fastest route
function aggregate(cellId, filter) {
  const rows = cases.map((cs, k) => ({ cs, r: R[cellId][k] })).filter(({ cs }) => cs.kind !== "shift" && filter(cs));
  const o = { n: rows.length, offered: 0, changedVsA: 0, better: 0, trade: 0, worse: 0, worseRough: 0, worseUnknown: 0, worseTime: 0, newUturn: 0, avoidedRisk0: 0, avoidedConf0: 0, avoidedRiskAc: 0,
    avoidedRiskOwn: 0, worseOwn: 0, betterOwn: 0, worseBoth: 0, extraSecondsOffered: 0, dUnknownOffered: 0, excessive: 0, uturnPicks: 0, extraManeuvers: 0, railTramPickMinusFast: 0 };
  for (const { r } of rows) {
    const m = r.m0;
    if (!m.isFast) { o.offered += 1; o.extraSecondsOffered += m.dt; o.dUnknownOffered += m.dUnk; if (EXCESSIVE(m)) o.excessive += 1; o.extraManeuvers += m.dManeuvers; }
    o.avoidedRisk0 += m.riskFast - m.risk; o.avoidedConf0 += m.confFast - m.conf; o.avoidedRiskAc += r.mac.riskFast - r.mac.risk;
    o.avoidedRiskOwn += r.mown.riskFast - r.mown.risk;
    if (r.vsAown.changed && r.vsAown.cls.startsWith("worse")) { o.worseOwn += 1; if (r.vsA.cls.startsWith("worse")) o.worseBoth += 1; }
    if (r.vsAown.changed && (r.vsAown.cls === "better" || r.vsAown.cls === "better-unknown")) o.betterOwn += 1;
    if (m.uturns > 0) o.uturnPicks += 1;
    o.railTramPickMinusFast += m.railTram - m.railTramFast;
    if (r.vsA.changed) { o.changedVsA += 1; const c = r.vsA.cls; if (c === "better" || c === "better-unknown") o.better += 1; else if (c === "trade") o.trade += 1; else if (c.startsWith("worse")) { o.worse += 1; if (c === "worse-rough") o.worseRough += 1; else if (c === "worse-unknown") o.worseUnknown += 1; else if (c === "worse-time") o.worseTime += 1; else o.newUturn += 1; } }
  }
  const rnd = (x) => Math.round(x);
  return { ...o, avoidedRisk0: rnd(o.avoidedRisk0), avoidedConf0: rnd(o.avoidedConf0), avoidedRiskAc: rnd(o.avoidedRiskAc), avoidedRiskOwn: rnd(o.avoidedRiskOwn), extraMinutesOffered: +(o.extraSecondsOffered / 60).toFixed(1), meanExtraSecOffered: o.offered ? rnd(o.extraSecondsOffered / o.offered) : 0,
    dUnknownOffered: rnd(o.dUnknownOffered), railTramPickMinusFast: rnd(o.railTramPickMinusFast), extraSecondsOffered: undefined };
}
const summary = { generatedBy: "exp-run-scoring.mjs", departure: pb.departure, cases: cases.length, nonShiftCases: cases.filter((c) => c.kind !== "shift").length,
  assertion: { "A@L0 equals production handler pick": `${cases.length - mismatch.length}/${cases.length}`, mismatches: mismatch },
  splitSha256: sha256(JSON.stringify(split)), cells: {} };
for (const c of CELLS) {
  const cell = { cell: c.cell, model: c.model, layer: c.layer, options: c.o ?? null, all: aggregate(c.id, () => true), byGroup: {}, byMode: {} };
  for (const g of GROUPS) cell.byGroup[g] = aggregate(c.id, (cs) => cs.group === g);
  for (const m of ["car", "motorcycle", "bicycle"]) cell.byMode[m] = aggregate(c.id, (cs) => cs.mode === m);
  summary.cells[c.id] = cell;
}

summary.productionPickUnderLayer = {};
for (const L of ["L0", "La", "Lb", "Lc", "Lac"]) summary.productionPickUnderLayer[L] = Math.round(cases.filter((cs) => cs.kind !== "shift").reduce((a, cs) => { const m = pickMetrics(cs, cs.prodPick, L); return a + m.riskFast - m.risk; }, 0));

// ---------- regressions list (every non-A cell, changed cases classed worse-*) ----------
const regressions = [];
for (const c of CELLS) {
  if (c.id === "A@L0") continue;
  cases.forEach((cs, k) => {
    const r = R[c.id][k];
    if (cs.kind === "shift") return;
    for (const [yard, v] of [["L0", r.vsA]]) if (v.changed && v.cls.startsWith("worse")) regressions.push({ cell: c.id, case: cs.id, group: cs.group, mode: cs.mode, yardstick: yard, cls: v.cls, dRisk: Math.round(v.dRisk), dUnknown: Math.round(v.dUnk), dSeconds: Math.round(v.dt), pickSource: cs.cands[r.pick].source, prodSource: cs.cands[cs.prodPick].source });
  });
}

// ---------- CSV of main cells ----------
const csvCells = ["A@L0", "B@L0", "C-global@L0", "D-regret@L0", "A@Lac", "B@Lac", "D-regret@Lac"];
const header = ["case", "group", "mode", "kind", "poolSize", "fastSource", "prodPick", ...csvCells.flatMap((c) => [`${c}.pick`, `${c}.dt`, `${c}.dRisk0`, `${c}.dUnk0`, `${c}.vsA`])];
const lines = [header.join(",")];
cases.forEach((cs, k) => {
  const f = cs.cands[cs.fastIdx];
  lines.push([cs.id, cs.group, cs.mode, cs.kind, cs.cands.length, f.source, cs.prodPick, ...csvCells.flatMap((c) => { const r = R[c][k]; return [r.pick, Math.round(r.m0.dt), Math.round(r.m0.dRisk), Math.round(r.m0.dUnk), r.vsA.cls]; })].join(","));
});
await writeFile(new URL("scoring-cases.csv", OUT), lines.join("\n") + "\n");

// ---------- Model E: Pareto sets ----------
const OBJ6 = (c) => [c.dur, c.ex.L0.confirmed, c.ex.L0.probable, c.ex.L0.unknown, c.maneuvers, c.uturns];
const OBJ3 = (c) => [c.dur, c.ex.L0.risk, c.ex.L0.unknown];
const OBJ7 = (c) => [...OBJ6(c), c.ex.L0.ch.rail.tagged + c.ex.L0.ch.rail["mapped-adjacent"]];
function paretoStats(filter) {
  const o = { n: 0, pool: 0, poolDistinct: 0, size6: 0, size3: 0, prodOn6: 0, prodOn3: 0, prodOn7: 0, prodDominated6: 0, multiOption: 0, uturnOnPareto6: 0, uturnProd: 0, dominatedByProdOnlyBy: { maneuvers: 0, uturns: 0 }, shown: { 1: 0, 2: 0, 3: 0, "4+": 0 } };
  const examples = [];
  for (const cs of cases) {
    if (cs.kind === "shift" || !filter(cs)) continue;
    const idx = cs.cands.map((c, i) => ({ i }));
    const P6 = paretoIndices(idx, (c) => OBJ6(cs.cands[c.i]));
    const P3 = paretoIndices(idx, (c) => OBJ3(cs.cands[c.i]));
    const P7 = paretoIndices(idx, (c) => OBJ7(cs.cands[c.i]));
    o.n += 1; o.pool += cs.cands.length; o.size6 += P6.length; o.size3 += P3.length;
    // distinct corridors on the 6-objective Pareto set (what a UI could list): cluster by production distinctness
    const reps = []; for (const i of P6) if (!reps.some((j) => cs.eq[i][j])) reps.push(i);
    o.poolDistinct += (() => { const r = []; for (let i = 0; i < cs.cands.length; i += 1) if (!r.some((j) => cs.eq[i][j])) r.push(i); return r.length; })();
    const shown = reps.length; o.shown[shown >= 4 ? "4+" : shown] += 1; if (shown >= 2) o.multiOption += 1;
    if (P6.includes(cs.prodPick)) o.prodOn6 += 1; else { o.prodDominated6 += 1; if (examples.length < 12) { const dom = P6.find((j) => OBJ6(cs.cands[j]).every((x, k2) => x <= OBJ6(cs.cands[cs.prodPick])[k2])); const a = OBJ6(cs.cands[cs.prodPick]), b = OBJ6(cs.cands[dom]); examples.push({ case: cs.id, prod: cs.cands[cs.prodPick].source, dominatedBy: cs.cands[dom].source, dSeconds: Math.round(b[0] - a[0]), dConfirmed: b[1] - a[1], dProbable: b[2] - a[2], dUnknown: b[3] - a[3], dManeuvers: b[4] - a[4], dUturns: b[5] - a[5] }); } }
    if (P3.includes(cs.prodPick)) o.prodOn3 += 1;
    if (P7.includes(cs.prodPick)) o.prodOn7 += 1;
    if (cs.cands[cs.prodPick].uturns > 0) o.uturnProd += 1;
    if (P6.some((i) => cs.cands[i].uturns > 0)) o.uturnOnPareto6 += 1;
  }
  return { ...o, meanPool: +(o.pool / o.n).toFixed(2), meanDistinctPool: +(o.poolDistinct / o.n).toFixed(2), meanSize6: +(o.size6 / o.n).toFixed(2), meanSize3: +(o.size3 / o.n).toFixed(2), pool: undefined, poolDistinct: undefined, size6: undefined, size3: undefined, examples };
}
const pareto = { objectives6: ["seconds", "confirmed stone m", "probable stone m", "unknown m", "maneuver count", "U-turn count"], all: paretoStats(() => true) };
for (const g of GROUPS) pareto[g] = paretoStats((cs) => cs.group === g);
for (const m of ["car", "motorcycle", "bicycle"]) pareto[m] = paretoStats((cs) => cs.mode === m);

// ---------- stability: main vs shifted start/end (30 journeys x 3 modes) ----------
const byId = new Map(cases.map((cs, k) => [cs.id, k]));
function stabilityFor(cellId) {
  let pairs = 0, flip = 0, gapSum = 0, gapMax = 0, corridorChange = 0;
  cases.forEach((cs, k) => {
    if (cs.kind !== "shift") return;
    const baseK = byId.get(`${cs.baseId}-${cs.mode}`); if (baseK === undefined) return;
    const a = R[cellId][baseK].m0, b = R[cellId][k].m0;
    pairs += 1; if (a.isFast !== b.isFast) flip += 1;
    const gap = Math.abs((a.risk - a.riskFast) - (b.risk - b.riskFast)); gapSum += gap; gapMax = Math.max(gapMax, gap);
  });
  return { pairs, decisionFlips: flip, flipRate: +(flip / Math.max(pairs, 1)).toFixed(3), meanRiskDeltaGapM: +(gapSum / Math.max(pairs, 1)).toFixed(1), maxRiskDeltaGapM: Math.round(gapMax) };
}
const stability = { note: "30 journeys x 3 modes, start and end shifted by a few metres (tests/fixtures/phase425-milan-journeys.json `stability`); flip = alternative offered in one run only", cells: {} };
for (const c of CELLS) stability.cells[c.id] = stabilityFor(c.id);

// ---------- sensitivity (baseline data) ----------
const cell = (name, fn, filter = (cs) => cs.kind !== "shift") => {
  const rows = cases.filter(filter).map((cs) => { const pick = fn(cs); return { cs, pick, m: pickMetrics(cs, pick, "L0"), vsA: compareToProduction(cs, pick, cs.prodPick, "L0") }; });
  const off = rows.filter((r) => !r.m.isFast);
  return { name, n: rows.length, offered: off.length, avoidedRisk: Math.round(rows.reduce((a, r) => a + (r.m.riskFast - r.m.risk), 0)), avoidedConfirmed: Math.round(rows.reduce((a, r) => a + (r.m.confFast - r.m.conf), 0)),
    extraMinutes: +(off.reduce((a, r) => a + r.m.dt, 0) / 60).toFixed(1), dUnknown: Math.round(off.reduce((a, r) => a + r.m.dUnk, 0)), excessive: off.filter((r) => EXCESSIVE(r.m)).length,
    changedVsA: rows.filter((r) => r.vsA.changed).length, worse: rows.filter((r) => r.vsA.cls.startsWith("worse")).length, uturnPicks: rows.filter((r) => r.m.uturns > 0).length };
};
const sens = { exchangeRate: [], unknownPenaltyScale: [], priorScaleGlobal: [], priorScaleZoned: [], scenarioSets: [], avoidanceLevels: [], pavingWeightB: [], uturn: [] };
const car = (cs) => cs.mode === "car" && cs.kind !== "shift";
// time exchange: seconds per metre of stone = (production value) x k; the production strong value is 1.2 s/m for a car, 1.82 s/m for a motorcycle and 2.31 s/m for a bicycle
for (const k of [0.1, 0.25, 0.5, 1, 2, 4, 10]) {
  sens.exchangeRate.push({ multiplier: k, secondsPerMetreCar: +(1.2 * k).toFixed(2), ...cell(`x${k}`, (cs) => MODELS.A(cs, "L0", { secondsWeightMul: 1 / k })), car: cell(`x${k} car`, (cs) => MODELS.A(cs, "L0", { secondsWeightMul: 1 / k }), car),
    holdout: cell(`x${k} holdout`, (cs) => MODELS.A(cs, "L0", { secondsWeightMul: 1 / k }), (cs) => cs.group === "HOLDOUT" && cs.kind !== "shift"), corridor: cell(`x${k} corridor`, (cs) => MODELS.A(cs, "L0", { secondsWeightMul: 1 / k }), (cs) => cs.group === "CORRIDOR" && cs.kind !== "shift") });
}
for (const u of [0, 0.25, 0.5, 1, 2, 4]) sens.unknownPenaltyScale.push({ uScale: u, ...cell(`u=${u}`, (cs) => MODELS.A(cs, "L0", { uScale: u })) });
for (const s of [0, 0.5, 1, 2, 4, 8]) { sens.priorScaleGlobal.push({ scale: s, ...cell(`C-global x${s}`, (cs) => MODELS.C(cs, "L0", { prior: "global", scale: s })) }); sens.priorScaleZoned.push({ scale: s, ...cell(`C-zoned x${s}`, (cs) => MODELS.C(cs, "L0", { prior: "zoned", scale: s })) }); }
for (const P of [[0], [0, 0.1], [0, 0.1, 0.3], [0, 0.1, 0.3, 0.5], [0.3, 0.5], [0.5]]) sens.scenarioSets.push({ scenarios: P, regret: cell(`D regret ${P}`, (cs) => MODELS.D(cs, "L0", { scenarios: P, rule: "regret" })), maximin: cell(`D maximin ${P}`, (cs) => MODELS.D(cs, "L0", { scenarios: P, rule: "maximin" })) });
for (const lv of ["balanced", "strong", "maximum"]) sens.avoidanceLevels.push({ level: lv, ...cell(`A ${lv}`, (cs) => MODELS.A(cs, "L0", { avoidance: lv })), secondsPerMetreCar: +secondsPerMetre(POLICY.car, lv).toFixed(2) });
for (const [name, o] of [["reject U-turn candidates", { exclude: (c) => c.uturns > 0 }], ["penalise 60 s per U-turn", { extraUtility: (c) => c.uturns * 60 * (POLICY.car.div / 600) }], ["penalise 180 s per U-turn", { extraUtility: (c) => c.uturns * 180 * (POLICY.car.div / 600) }]]) sens.uturn.push(cell(name, (cs) => MODELS.A(cs, "L0", o)));
// model B paving weight: how much the 0.65 production assumption matters (B with paving_stones weight w, no other change)
const pavingCell = (w) => cell(`B paving=${w}`, (cs) => select(views(cs, "L0", (e) => e.risk - 0.65 * 0 + (w - 0.65) * (e.probable)), cs.fastIdx, cs.eq, cs.mode).pick);
for (const w of [0.3, 0.5, 0.65, 0.8, 1.0]) sens.pavingWeightB.push({ weight: w, ...pavingCell(w) });

// ---------- exposure inventory (descriptive): what unknown / rough / rails look like on production picks ----------
const inventory = { unknownByWhy: {}, unknownByClass: {}, roughByMaterial: {}, rail: {}, smoothnessSamples: 0, nonShiftPickedRoutes: 0 };
for (const [k, cs] of cases.entries()) {
  if (cs.kind === "shift") continue;
  const ch = cs.cands[cs.prodPick].ex.L0.ch; inventory.nonShiftPickedRoutes += 1;
  for (const [a, v] of Object.entries(ch.unk)) inventory.unknownByWhy[a] = (inventory.unknownByWhy[a] ?? 0) + v;
  for (const [a, v] of Object.entries(ch.unkClass)) inventory.unknownByClass[a] = (inventory.unknownByClass[a] ?? 0) + v;
  for (const [a, v] of Object.entries(ch.rough)) inventory.roughByMaterial[a] = (inventory.roughByMaterial[a] ?? 0) + v;
  for (const [a, v] of Object.entries(ch.rail)) inventory.rail[a] = (inventory.rail[a] ?? 0) + v;
}
for (const o of [inventory.unknownByWhy, inventory.unknownByClass, inventory.roughByMaterial, inventory.rail]) for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
// how many layer overlays touch the pool at all
const layerTouch = {};
for (const L of ["La", "Lb", "Lc"]) layerTouch[L] = { casesWithAnyDifferenceInRisk: cases.filter((cs) => cs.kind !== "shift" && cs.cands.some((c) => c.ex[L].risk !== c.ex.L0.risk || c.ex[L].unknown !== c.ex.L0.unknown || c.ex[L].confirmed !== c.ex.L0.confirmed || c.ex[L].probable !== c.ex.L0.probable)).length,
  meanAbsRiskChangeOnProdPick: +(cases.filter((cs) => cs.kind !== "shift").reduce((a, cs) => a + Math.abs(cs.cands[cs.prodPick].ex[L].risk - cs.cands[cs.prodPick].ex.L0.risk), 0) / cases.filter((cs) => cs.kind !== "shift").length).toFixed(1) };

// ---------- decision flips (details of every pick that differs from production) for the main sweeps ----------
const flipOf = (name, fn) => cases.filter((cs) => cs.kind !== "shift").flatMap((cs) => {
  const pick = fn(cs); if (pick === cs.prodPick) return [];
  const a = pickMetrics(cs, cs.prodPick, "L0"), m = pickMetrics(cs, pick, "L0");
  const f = cs.cands[cs.fastIdx], c = cs.cands[pick];
  const savedVsFast = f.ex.L0.risk - c.ex.L0.risk, dUvsFast = c.ex.L0.unknown - f.ex.L0.unknown;
  return [{ variant: name, case: cs.id, group: cs.group, mode: cs.mode, prodOffered: !a.isFast, newOffered: !m.isFast, dRiskVsProd: m.risk - a.risk, dUnknownVsProd: m.unk - a.unk, dSecondsVsProd: Math.round(m.dt - a.dt), newSource: c.source, prodSource: cs.cands[cs.prodPick].source,
    pStarVsFast: dUvsFast > 0 && savedVsFast > 0 ? +(savedVsFast / dUvsFast).toFixed(3) : null, cls: compareToProduction(cs, pick, cs.prodPick, "L0").cls }];
});
const flips = [
  ...flipOf("uScale=0 (no unknown burden)", (cs) => MODELS.A(cs, "L0", { uScale: 0 })), ...flipOf("uScale=2", (cs) => MODELS.A(cs, "L0", { uScale: 2 })), ...flipOf("uScale=4", (cs) => MODELS.A(cs, "L0", { uScale: 4 })),
  ...flipOf("B (material weights)", (cs) => MODELS.B(cs, "L0")), ...flipOf("C-global (expected value)", (cs) => MODELS.C(cs, "L0", { prior: "global" })), ...flipOf("C-zoned (expected value)", (cs) => MODELS.C(cs, "L0", { prior: "zoned" })),
  ...flipOf("D-regret", (cs) => MODELS.D(cs, "L0", { rule: "regret" })), ...flipOf("D-maximin", (cs) => MODELS.D(cs, "L0", { rule: "maximin" })),
];
const files = { "decision-flips.json": { count: flips.length, rows: flips }, "scoring-summary.json": summary, "scoring-regressions.json": { count: regressions.length, rows: regressions }, "pareto-summary.json": pareto, "stability.json": stability, "sensitivity.json": sens, "exposure-inventory.json": { inventory, layerTouch } };
const hashes = {};
for (const [name, obj] of Object.entries(files)) { const text = JSON.stringify(obj, null, 1) + "\n"; await writeFile(new URL(name, OUT), text); hashes[name] = sha256(text); }
hashes["scoring-cases.csv"] = sha256(lines.join("\n") + "\n");
await writeFile(new URL("scoring-hashes.json", OUT), JSON.stringify(hashes, null, 1) + "\n");
console.log(JSON.stringify({ assertion: summary.assertion, cellsAll: Object.fromEntries(Object.entries(summary.cells).map(([k, v]) => [k, v.all])), hashes }, null, 1));
