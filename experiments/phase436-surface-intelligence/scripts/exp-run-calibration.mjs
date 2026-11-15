/**
 * Phase 4.36 routing-experiments: (1) where the unknown metres come from, (2) break-even stone probability p* of unknown-adding
 * alternatives against the sourced prior (calibration of any unknown-surface penalty), (3) U-turn exposure of pooled and picked routes,
 * (4) trigger analysis of candidate-generation variants (slice minimum, early stop) on the whole corpus (exact, offline).
 *   node experiments/phase436-surface-intelligence/scripts/exp-run-calibration.mjs
 * Output: evidence/routing-experiments/calibration.json, uturn-analysis.json, generation-triggers.json
 */
import { writeFile } from "node:fs/promises";
import { OUT, ROOT, sha256 } from "./exp-harness.mjs";
import { POLICY } from "./exp-models.mjs";
import { loadAllCases } from "./exp-eval.mjs";
import { sampleTable } from "./exp-features.mjs";

const { extractRoughSlices } = await import(new URL("lib/surface-aware-routing.ts", ROOT).href);
const { cases, ctx, baseRates, departure } = await loadAllCases();
const main = cases.filter((c) => c.kind !== "shift");
const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
const rnd = (x, d = 0) => (x === null ? null : +x.toFixed(d));

// ---------- (1) unknown inventory ----------
const MILAN = { w: 9.04, s: 45.38, e: 9.31, n: 45.55 };
const unk = { picks: 0, totalMeters: 0, unknownMeters: 0, noMatchMeters: 0, noMatchInsideTileArea: 0, untaggedMeters: 0, otherMeters: 0, casesWithUnknownGt100: 0, casesWithNoMatchGt1000: [], medianUnknownShareFastPct: null };
const shares = [];
for (const cs of main) {
  const e = cs.cands[cs.prodPick].ex.L0; unk.picks += 1; unk.totalMeters += e.total; unk.unknownMeters += e.unknown;
  unk.noMatchMeters += e.ch.unk.nomatch; unk.untaggedMeters += e.ch.unk.untagged; unk.otherMeters += e.ch.unk.other;
  if (e.unknown > 100) unk.casesWithUnknownGt100 += 1;
  if (e.ch.unk.nomatch > 1000) unk.casesWithNoMatchGt1000.push({ case: cs.id, noMatchM: Math.round(e.ch.unk.nomatch), routeM: e.total });
  shares.push((100 * e.unknown) / Math.max(e.total, 1));
}
unk.medianUnknownSharePct = rnd(q(shares, 0.5), 1); unk.p90UnknownSharePct = rnd(q(shares, 0.9), 1);
for (const k of ["totalMeters", "unknownMeters", "noMatchMeters", "untaggedMeters", "otherMeters"]) unk[k] = Math.round(unk[k]);
unk.casesWithNoMatchGt1000.sort((a, b) => b.noMatchM - a.noMatchM); unk.casesWithNoMatchGt1000 = unk.casesWithNoMatchGt1000.slice(0, 10);
// how much of the no-match lies where no tile exists at all (outside the compiled box) is not knowable here: report by mode instead
unk.byMode = {};
for (const mode of ["car", "motorcycle", "bicycle"]) { const rows = main.filter((c) => c.mode === mode); unk.byMode[mode] = { medianUnknownSharePct: rnd(q(rows.map((cs) => (100 * cs.cands[cs.prodPick].ex.L0.unknown) / Math.max(cs.cands[cs.prodPick].ex.L0.total, 1)), 0.5), 1), noMatchMeters: Math.round(rows.reduce((a, cs) => a + cs.cands[cs.prodPick].ex.L0.ch.unk.nomatch, 0)), untaggedMeters: Math.round(rows.reduce((a, cs) => a + cs.cands[cs.prodPick].ex.L0.ch.unk.untagged, 0)) }; }

// ---------- (2) break-even stone probability ----------
const prior = { outerPooledUntagged: ctx.priors.pooledOuter.c + 0.65 * ctx.priors.pooledOuter.p, corePooledUntagged: ctx.priors.pooledCore.c + 0.65 * ctx.priors.pooledCore.p, pooledUntagged: ctx.priors.pooled.c + 0.65 * ctx.priors.pooled.p,
  residentialGlobal: ctx.priors.global("residential"), residentialCore: ctx.priors.zoned("residential", true), residentialOuter: ctx.priors.zoned("residential", false), serviceGlobal: ctx.priors.global("service"), unclassifiedGlobal: ctx.priors.global("unclassified") };
const be = { offeredAddingUnknown: [], rejectedAddingUnknown: [] };
for (const cs of main) {
  const f = cs.cands[cs.fastIdx], P = POLICY[cs.mode], lim = P.limits.strong, fe = f.ex.L0;
  for (const c of cs.cands) {
    if (c.i === cs.fastIdx || cs.eq[c.i][cs.fastIdx] || c.dur > f.dur * lim.factor + lim.seconds) continue;
    const e = c.ex.L0, saved = fe.risk - e.risk, dU = e.unknown - fe.unknown;
    if (saved < P.min || dU <= 0) continue; // known-stone gain of at least the production minimum, and strictly more unknown metres
    const row = { case: cs.id, group: cs.group, mode: cs.mode, saved, dU, pStar: saved / dU, dt: Math.round(c.dur - f.dur) };
    (c.i === cs.prodPick ? be.offeredAddingUnknown : be.rejectedAddingUnknown).push(row);
  }
}
const sumBE = (rows) => ({ n: rows.length, pStarQuantiles: { p10: rnd(q(rows.map((r) => r.pStar), 0.1), 3), median: rnd(q(rows.map((r) => r.pStar), 0.5), 3), p90: rnd(q(rows.map((r) => r.pStar), 0.9), 3) },
  belowOuterPrior: rows.filter((r) => r.pStar < prior.outerPooledUntagged).length, belowCorePrior: rows.filter((r) => r.pStar < prior.corePooledUntagged).length, below5pct: rows.filter((r) => r.pStar < 0.05).length,
  above50pct: rows.filter((r) => r.pStar >= 0.5).length, meanAddedUnknownM: rnd(rows.reduce((a, r) => a + r.dU, 0) / Math.max(rows.length, 1)), meanSavedKnownM: rnd(rows.reduce((a, r) => a + r.saved, 0) / Math.max(rows.length, 1)) });
const lowest = [...be.offeredAddingUnknown].sort((a, b) => a.pStar - b.pStar).slice(0, 8).map((r) => ({ ...r, pStar: rnd(r.pStar, 3) }));
const calibration = {
  note: "p* = (known weighted stone saved) / (unknown metres added) for an eligible, distinct alternative that adds unknown metres. If the share of rough metres among the unknown ones is below p*, the alternative is better than the fastest route in expectation. Priors are PROXIES from tagged ways (base-rates.json).",
  priorExpectedWeightedRoughPerUnknownMetre: Object.fromEntries(Object.entries(prior).map(([k, v]) => [k, rnd(v, 4)])),
  unknownInventoryOnProductionPicks: unk,
  breakEven: { offeredByProduction: sumBE(be.offeredAddingUnknown), rejectedByProduction: sumBE(be.rejectedAddingUnknown), lowestPStarAmongOffered: lowest },
  productionUnknownBurden: { note: "route-optimization.ts:104-118: each ADDED unknown metre costs 1.0 stone-metre when it replaces avoided stone without smooth gain, 0.35 up to 1.25x the stone saved, 1.0 beyond: equivalent to an assumed rough share of 35-100 %, versus 2-4 % outer / 17 % core among tagged residential ways", impliedShare: [0.35, 1.0] },
  baseRatesSource: "outputs/phase436-surface-intelligence/evidence/routing-experiments/base-rates.json",
};
// ---------- (3) U-turns ----------
const ut = { pooledCandidates: 0, withUturn: 0, bySource: {}, picks: { total: main.length, withUturn: 0, fastWithUturn: 0, altWithUturn: 0, altPicks: 0, bySource: {}, midRoute: 0, nearStartOrEnd: 0, unnamedStreet: 0 }, offeredAltAvoidingAUturnExistsInPool: 0 };
const srcType = (s) => (s.startsWith("base") ? "base/alternate" : s.startsWith("surface-aware") ? "penalised-search" : s.startsWith("detour") ? "via-waypoint-detour" : s.startsWith("access") ? "access-aware" : s);
for (const cs of main) {
  for (const c of cs.cands) { ut.pooledCandidates += 1; const t = srcType(c.source); ut.bySource[t] ??= { candidates: 0, withUturn: 0 }; ut.bySource[t].candidates += 1; if (c.uturns > 0) { ut.withUturn += 1; ut.bySource[t].withUturn += 1; } }
  const p = cs.cands[cs.prodPick];
  if (p.uturns > 0) {
    ut.picks.withUturn += 1; if (cs.prodPick === cs.fastIdx) ut.picks.fastWithUturn += 1; else ut.picks.altWithUturn += 1;
    const t = srcType(p.source); ut.picks.bySource[t] = (ut.picks.bySource[t] ?? 0) + 1;
    for (const u of p.uturnInfo) { if (u.alongPct > 3 && u.fromEndM > 150) ut.picks.midRoute += 1; else ut.picks.nearStartOrEnd += 1; if (!u.named) ut.picks.unnamedStreet += 1; }
  }
  if (cs.prodPick !== cs.fastIdx) ut.picks.altPicks += 1;
}
ut.share = { poolPct: rnd((100 * ut.withUturn) / ut.pooledCandidates, 1), picksPct: rnd((100 * ut.picks.withUturn) / ut.picks.total, 1), altPicksPct: rnd((100 * ut.picks.altWithUturn) / Math.max(ut.picks.altPicks, 1), 1) };
for (const v of Object.values(ut.bySource)) v.pct = rnd((100 * v.withUturn) / v.candidates, 1);

// ---------- (4) generation triggers (exact, offline) ----------
const gen = { cases: 0, flagCounts: {}, nothingToTargetAt25: 0, wouldTargetAtMinimum: { 25: 0, 20: 0, 15: 0, 12: 0, 10: 0 }, earlyStopSkipped: 0, earlyStopSkippedWithStoneLeft: 0, earlyStopSkippedWithStoneLeftOver50m: 0, searchRanButNotAccepted: 0,
  sliceLengthsJustBelow25: [], byGroup: {}, byMode: {} };
const minima = [25, 20, 15, 12, 10];
const hitMin = (m, lens) => lens.some((x) => x >= m);
for (const cs of main) {
  if (!cs.flags) continue;
  const pre = cs.cands.find((c) => c.source === cs.flags.preliminaryFastSource); if (!pre) continue;
  const { samples } = await sampleTable(pre.route.coordinates, cs.mode, departure);
  const rough = new Set(samples.filter((s) => s.cat === "confirmed_rough" || s.cat === "probable_rough").map((s) => s.edge));
  const slicesAt = (min) => extractRoughSlices(pre.route.coordinates, (_a, _b, i) => rough.has(i), min).map((sl) => sl.reduce((a, p, k) => (k ? a + Math.hypot((p[0] - sl[k - 1][0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (p[1] - sl[k - 1][1]) * 110540) : 0), 0));
  gen.cases += 1;
  const f = cs.flags; const key = `canGenerate=${f.canGenerate},baseAlreadyImproves=${f.baseAlreadyImproves},attempted=${f.attempted},nothingToTarget=${f.nothingToTarget}`;
  gen.flagCounts[key] = (gen.flagCounts[key] ?? 0) + 1;
  const g = (gen.byGroup[cs.group] ??= { cases: 0, nothingToTarget: 0, wouldTarget20: 0, wouldTarget15: 0, earlyStopSkipped: 0 }); g.cases += 1;
  const m = (gen.byMode[cs.mode] ??= { cases: 0, nothingToTarget: 0, wouldTarget20: 0, wouldTarget15: 0, earlyStopSkipped: 0 }); m.cases += 1;
  if (f.nothingToTarget) {
    gen.nothingToTargetAt25 += 1; g.nothingToTarget += 1; m.nothingToTarget += 1;
    for (const min of minima) if (hitMin(min, slicesAt(min))) gen.wouldTargetAtMinimum[min] += 1;
    if (hitMin(20, slicesAt(20))) { g.wouldTarget20 += 1; m.wouldTarget20 += 1; }
    if (hitMin(15, slicesAt(15))) { g.wouldTarget15 += 1; m.wouldTarget15 += 1; }
    const lens = slicesAt(10).filter((x) => x < 25).map((x) => +x.toFixed(2)); gen.sliceLengthsJustBelow25.push(...lens.filter((x) => x >= 15));
  }
  const fastC = cs.cands[cs.fastIdx];
  if (f.baseAlreadyImproves && f.preliminaryFastSource) {
    gen.earlyStopSkipped += 1; g.earlyStopSkipped += 1; m.earlyStopSkipped += 1;
    const left = cs.cands[cs.prodPick].ex.L0.risk;
    if (left >= POLICY[cs.mode].min) gen.earlyStopSkippedWithStoneLeft += 1;
    if (left >= 50) gen.earlyStopSkippedWithStoneLeftOver50m += 1;
  }
  if (f.attempted && cs.antiPave === "no-better-route") gen.searchRanButNotAccepted += 1;
  void fastC;
}
gen.sliceLengthsJustBelow25.sort((a, b) => a - b);
gen.note = "Slices measured on the fastest base route exactly as route.ts:688 does (extractRoughSlices over the scorer's rough edge indices). The 25 m minimum skips the penalised search only when ALL stone slices are shorter than 25 m.";

const files = { "calibration.json": calibration, "uturn-analysis.json": ut, "generation-triggers.json": gen };
const hashes = {};
for (const [name, obj] of Object.entries(files)) { const text = JSON.stringify(obj, null, 1) + "\n"; await writeFile(new URL(name, OUT), text); hashes[name] = sha256(text); }
await writeFile(new URL("calibration-hashes.json", OUT), JSON.stringify(hashes, null, 1) + "\n");
console.log(JSON.stringify({ calibration: { prior: calibration.priorExpectedWeightedRoughPerUnknownMetre, unk: { ...unk, casesWithNoMatchGt1000: unk.casesWithNoMatchGt1000.slice(0, 4) }, breakEven: calibration.breakEven }, ut, gen, hashes }, null, 1));
void baseRates; void MILAN;
