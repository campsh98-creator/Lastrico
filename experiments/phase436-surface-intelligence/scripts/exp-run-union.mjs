/**
 * Phase 4.36 routing-experiments, matrix cell (5): "expanded candidate generation + controlled scoring", offline.
 * The expanded pool of a journey is the union of EVERY provider route the Phase 4.25-4.31 runs ever archived for the same
 * start, end and costing (base + alternates, penalised searches of every generator version, via-waypoint detours, refinements),
 * added to the production pool, de-duplicated and legality-filtered with the production functions. It is an UPPER BOUND on what a
 * generator that issued all of those requests could reach, and its request count is the cost.
 *   node experiments/phase436-surface-intelligence/scripts/exp-run-union.mjs
 * Output: evidence/routing-experiments/union-summary.json, union-cases.csv
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, EXP, CACHE, OUT, sha256 } from "./exp-harness.mjs";
import { select, selectRobust, POLICY } from "./exp-models.mjs";
import { buildCase, makeContext, views } from "./exp-eval.mjs";

const read = async (u) => JSON.parse(await readFile(u, "utf8"));
const { normalizeValhallaResponse } = await import(new URL("lib/routing-providers.ts", ROOT).href);
const { deduplicateRoutes } = await import(new URL("lib/route-candidates.ts", ROOT).href);
const baseRates = await read(new URL("base-rates.json", OUT));
const split = await read(new URL("split.json", OUT));
const ctx = await makeContext(baseRates);
const index = await read(new URL("archive-index.json", CACHE));
const pb = await read(new URL("pools-baseline.json", CACHE));
const pf = await read(new URL("pools-field.json", CACHE));
const COSTING = { car: "auto", motorcycle: "motorcycle", bicycle: "bicycle" };
const EQ = { car: { equivalentDistanceMeters: 120, equivalentDurationSeconds: 90, equivalentAverageMeters: 32 }, motorcycle: { equivalentDistanceMeters: 110, equivalentDurationSeconds: 75, equivalentAverageMeters: 30 }, bicycle: { equivalentDistanceMeters: 85, equivalentDurationSeconds: 75, equivalentAverageMeters: 24 } };
const dirs = (r) => (r.instructions ?? []).map((i) => i.direction);
const uinfo = (r) => { const instr = r.instructions ?? []; const total = instr.reduce((a, i) => a + i.distance, 0) || r.distance; let acc = 0; return instr.flatMap((i) => { const at = acc; acc += i.distance; return i.direction === "uturn" ? [{ alongPct: Math.round((100 * at) / total), fromEndM: Math.round(total - at), named: Boolean(i.roadName), lengthM: Math.round(i.distance) }] : []; }); };
const loadArchived = async (key) => JSON.parse(await readFile(new URL(`data/archive/responses/${key}.json`, EXP), "utf8"));

const rows = [];
const kindsAdded = {};
let withExtra = 0;
for (const src of [pb, pf]) for (const c of src.cases) {
  if (!c.pool || c.status !== 200 || c.kind === "shift" || c.params?.navigation || c.params?.ztl || c.params?.departure) continue;
  const group = c.kind === "main" ? split.journeys[c.journey] : "FIELD";
  const gk = `${c.start[0]},${c.start[1]}|${c.end[0]},${c.end[1]}|${COSTING[c.mode]}`;
  const archived = index[gk] ?? [];
  const used = new Set(c.calls.map((k) => k.key));
  const extra = archived.filter((a) => !used.has(a.key.slice(0, 12)) && a.kind !== "exclude");
  // production pool routes
  const prodEntries = c.pool.map((p) => ({ source: p.source, route: { coordinates: p.coordinates, distance: p.distance, duration: p.duration, provider: p.provider, profile: p.profile, instructions: null }, maneuvers: p.maneuvers, uturns: p.uturns, uturnInfo: p.uturnInfo }));
  const extraEntries = [];
  for (const a of extra) {
    const e = await loadArchived(a.key);
    if (e.status !== 200) continue;
    let routes = [];
    try { routes = normalizeValhallaResponse(JSON.parse(e.body), c.mode); } catch { routes = []; }
    routes.forEach((r, k) => extraEntries.push({ source: `archived-${a.kind}${k ? `-alt${k}` : ""}`, route: r, maneuvers: dirs(r).length, uturns: dirs(r).filter((d) => d === "uturn").length, uturnInfo: uinfo(r), requestKey: a.key.slice(0, 12) }));
  }
  const all = [...prodEntries, ...extraEntries].filter((x) => x.route.provider === "valhalla-fossgis");
  const uniq = deduplicateRoutes(all.map((x) => ({ route: x.route, source: x.source, x })), EQ[c.mode]);
  const entries = uniq.map((u) => ({ source: u.source, coordinates: u.route.coordinates, duration: u.route.duration, distance: u.route.distance, maneuvers: u.x.maneuvers, uturns: u.x.uturns, uturnInfo: u.x.uturnInfo }));
  // production pool, for comparison, rebuilt in the same way (same de-dup) so both pools are scored identically
  const meta = { id: c.id, mode: c.mode, kind: c.kind, group, journey: c.journey, extraRequests: extra.length, extraKinds: extra.map((a) => a.kind) };
  const uCase = await buildCase(meta, entries, ctx, src.departure, 0, 0);
  // legality: the production filter (restrictions) on every union candidate
  const legal = uCase.cands.map((x) => x.blocking === 0);
  const fastIdx = uCase.cands.map((x, i) => ({ x, i })).filter(({ i }) => legal[i]).sort((a, b) => a.x.dur - b.x.dur || a.x.ex.L0.risk - b.x.ex.L0.risk || a.x.ex.L0.unknown - b.x.ex.L0.unknown)[0].i;
  uCase.fastIdx = fastIdx;
  uCase.legal = legal;
  rows.push({ c, group, uCase, extra, prodPoolSize: c.pool.length });
  if (extra.length) withExtra += 1;
  for (const a of extra) kindsAdded[a.kind] = (kindsAdded[a.kind] ?? 0) + 1;
}
console.error(`union cases ${rows.length}, with extra archived requests ${withExtra}`);

// ---------- evaluate: production pool (A) vs union pool (A, B, C, D, A+U-turn rule) ----------
function pickOn(uCase, model, o = {}) {
  // illegal candidates are removed from the view (they cannot be shown)
  const keep = uCase.cands.map((x, i) => ({ x, i })).filter(({ i }) => uCase.legal[i]);
  const remap = new Map(keep.map(({ i }, k) => [i, k]));
  const cs = { ...uCase, cands: keep.map(({ x }, k) => ({ ...x, i: k })), eq: keep.map(({ i }) => keep.map(({ i: j }) => uCase.eq[i][j])), fastIdx: remap.get(uCase.fastIdx) };
  const V = (risk) => views(cs, "L0", risk);
  let pick;
  if (model === "A") pick = select(V((e) => e.risk), cs.fastIdx, cs.eq, cs.mode, o).pick;
  else if (model === "B") pick = select(V((e) => e.riskB), cs.fastIdx, cs.eq, cs.mode, o).pick;
  else if (model === "C") pick = select(V((e) => e.risk + e.expG), cs.fastIdx, cs.eq, cs.mode, { ...o, burden: (c) => c.risk }).pick;
  else pick = selectRobust(V((e) => e.risk), cs.fastIdx, cs.eq, cs.mode, o).pick;
  const p = cs.cands[pick], f = cs.cands[cs.fastIdx];
  return { pick, source: p.source, isFast: pick === cs.fastIdx, dur: p.dur, fastDur: f.dur, dist: p.dist, risk: p.ex.L0.risk, fastRisk: f.ex.L0.risk, conf: p.ex.L0.confirmed, prob: p.ex.L0.probable, unk: p.ex.L0.unknown, uturns: p.uturns, maneuvers: p.maneuvers, pool: cs.cands.length };
}
// production pool: the cases' own pool under the same function (A) -> picks identical to the handler (asserted in exp-run-scoring)
async function prodPickOn(r) {
  const entries = r.c.pool.map((p) => ({ source: p.source, coordinates: p.coordinates, duration: p.duration, distance: p.distance, maneuvers: p.maneuvers, uturns: p.uturns, uturnInfo: p.uturnInfo }));
  const pc = await buildCase({ id: r.c.id, mode: r.c.mode, kind: r.c.kind, group: r.group }, entries, ctx, pb.departure, r.c.fastIndex, r.c.hasDistinctAlternative ? r.c.safeIndex : r.c.fastIndex);
  pc.legal = pc.cands.map(() => true);
  return pickOn(pc, "A");
}
const results = [];
for (const r of rows) {
  const prod = await prodPickOn(r);
  const u = { A: pickOn(r.uCase, "A"), B: pickOn(r.uCase, "B"), C: pickOn(r.uCase, "C"), D: pickOn(r.uCase, "D"), Anoturn: pickOn(r.uCase, "A", { exclude: (c) => c.uturns > 0 }) };
  results.push({ id: r.c.id, group: r.group, mode: r.c.mode, extra: r.extra.length, extraKinds: r.extra.map((e) => e.kind), unionPool: r.uCase.cands.length, prodPool: r.prodPoolSize, prod, u });
}
const agg = (filter, key) => {
  const rs = results.filter(filter); const o = { n: rs.length, casesWithExtraRequests: rs.filter((r) => r.extra > 0).length, extraRequests: rs.reduce((a, r) => a + r.extra, 0), unionPoolMean: +(rs.reduce((a, r) => a + r.unionPool, 0) / Math.max(rs.length, 1)).toFixed(2), prodPoolMean: +(rs.reduce((a, r) => a + r.prodPool, 0) / Math.max(rs.length, 1)).toFixed(2),
    changedPick: 0, lessRiskGt20: 0, moreRiskGt20: 0, lessRiskSavedM: 0, moreRiskM: 0, extraSecondsWhenChanged: 0, fasterWhenChangedSec: 0, unknownDelta: 0, uturnInProdPick: 0, uturnInUnionPick: 0, meanAbsRiskDiffM: 0 };
  for (const r of rs) {
    const a = r.prod, b = r.u[key];
    if (a.uturns > 0) o.uturnInProdPick += 1; if (b.uturns > 0) o.uturnInUnionPick += 1;
    const dRisk = b.risk - a.risk; o.meanAbsRiskDiffM += Math.abs(dRisk);
    if (b.risk !== a.risk || Math.abs(b.dur - a.dur) > 1 || b.unk !== a.unk) {
      o.changedPick += 1; o.extraSecondsWhenChanged += b.dur - a.dur; o.unknownDelta += b.unk - a.unk;
      if (dRisk <= -20) { o.lessRiskGt20 += 1; o.lessRiskSavedM += -dRisk; } else if (dRisk >= 20) { o.moreRiskGt20 += 1; o.moreRiskM += dRisk; }
    }
  }
  o.meanAbsRiskDiffM = +(o.meanAbsRiskDiffM / Math.max(rs.length, 1)).toFixed(1);
  return { ...o, extraSecondsWhenChanged: Math.round(o.extraSecondsWhenChanged), unknownDelta: Math.round(o.unknownDelta), lessRiskSavedM: Math.round(o.lessRiskSavedM), moreRiskM: Math.round(o.moreRiskM) };
};
const summary = { generatedBy: "exp-run-union.mjs", note: "Union of archived provider routes per journey/mode (see header). Cells compare the production pick on the production pool with the pick of each model on the union pool; metrics are absolute exposures of the pick, not deltas vs a changing fastest route.",
  cases: results.length, archivedRequestKindsNotUsedByProduction: kindsAdded, byModel: {} };
for (const key of ["A", "B", "C", "D", "Anoturn"]) {
  summary.byModel[key] = { all: agg(() => true, key), CORRIDOR: agg((r) => r.group === "CORRIDOR", key), DEV: agg((r) => r.group === "DEV", key), HOLDOUT: agg((r) => r.group === "HOLDOUT", key), FIELD: agg((r) => r.group === "FIELD", key),
    car: agg((r) => r.mode === "car", key), motorcycle: agg((r) => r.mode === "motorcycle", key), bicycle: agg((r) => r.mode === "bicycle", key) };
}
const csv = ["case,group,mode,extraRequests,prodPool,unionPool,prod.risk,prod.sec,prod.unk,prod.uturns,A.risk,A.sec,A.unk,A.uturns,A.source,Anoturn.risk,Anoturn.sec"];
for (const r of results) csv.push([r.id, r.group, r.mode, r.extra, r.prodPool, r.unionPool, r.prod.risk, Math.round(r.prod.dur), r.prod.unk, r.prod.uturns, r.u.A.risk, Math.round(r.u.A.dur), r.u.A.unk, r.u.A.uturns, r.u.A.source, r.u.Anoturn.risk, Math.round(r.u.Anoturn.dur)].join(","));
const sText = JSON.stringify(summary, null, 1) + "\n";
await writeFile(new URL("union-summary.json", OUT), sText);
await writeFile(new URL("union-cases.csv", OUT), csv.join("\n") + "\n");
await writeFile(new URL("union-hashes.json", OUT), JSON.stringify({ "union-summary.json": sha256(sText), "union-cases.csv": sha256(csv.join("\n") + "\n") }, null, 1) + "\n");
console.log(JSON.stringify({ cases: summary.cases, kindsAdded, A: summary.byModel.A.all, groupsA: { CORRIDOR: summary.byModel.A.CORRIDOR, HOLDOUT: summary.byModel.A.HOLDOUT }, Anoturn: summary.byModel.Anoturn.all, B: summary.byModel.B.all, C: summary.byModel.C.all, D: summary.byModel.D.all }, null, 1));
