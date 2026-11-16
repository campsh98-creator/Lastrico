/**
 * Phase 4.36 routing-experiments: case construction and metrics shared by the scoring runner and the union-pool runner.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ROOT, OUT, CACHE } from "./exp-harness.mjs";
import { sampleTable, accumulate, loadWayTags } from "./exp-features.mjs";
import { makeLayers, railState } from "./exp-layers.mjs";
import { POLICY } from "./exp-models.mjs";

const { routesShareCorridor } = await import(new URL("lib/route-candidates.ts", ROOT).href);

export const SAMPLE_STONE_B = { sett: 1.0, cobblestone: 1.2, unhewn_cobblestone: 1.3, paving_stones: 0.5 }; // model B hypotheses (explicit, not calibrated)
export const SMOOTH_B = { excellent: 0.6, good: 0.7, intermediate: 0.85, bad: 1.15, very_bad: 1.3, horrible: 1.3, very_horrible: 1.3, impassable: 1.3 };
const BADSM = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);

export const sha = (v) => createHash("sha256").update(v).digest("hex");

/** Priors for model C: p(unknown metre is stone) by highway class (global) and by class x zone, from base-rates.json (a PROXY). */
export function makePriors(baseRates) {
  const cls = baseRates.byHighwayClass, zone = baseRates.byZoneAndClass;
  const pool = (obj) => { let m = 0, c = 0, p = 0; for (const v of Object.values(obj)) { m += v.untaggedMetres; c += v.untaggedMetres * v.pStoneConfirmedAmongKnown; p += v.untaggedMetres * v.pStoneProbableAmongKnown; } return { c: c / Math.max(m, 1), p: p / Math.max(m, 1) }; };
  const pooled = pool(cls), pooledCore = pool(Object.fromEntries(Object.entries(zone).filter(([k]) => k.startsWith("core|")))), pooledOuter = pool(Object.fromEntries(Object.entries(zone).filter(([k]) => k.startsWith("outer|"))));
  const get = (table, key, fallback) => { const v = table[key]; return v ? { c: v.pStoneConfirmedAmongKnown, p: v.pStoneProbableAmongKnown } : fallback; };
  return {
    pooled, pooledCore, pooledOuter,
    // expected weighted rough metres per unknown metre (confirmed weight 1.0 + probable weight 0.65)
    global: (hw) => { const v = get(cls, hw, pooled); return v.c + 0.65 * v.p; },
    zoned: (hw, core) => { const v = get(zone, `${core ? "core" : "outer"}|${hw}`, core ? pooledCore : pooledOuter); return v.c + 0.65 * v.p; },
  };
}

/** One pass over a candidate's samples under one layer: production fields + the extra quantities models B and C need. */
export function analyse(samples, cls, ctx) {
  const { priors } = ctx;
  let riskB = 0, expG = 0, expZ = 0;
  const ch = { byMat: {}, unk: { untagged: 0, nomatch: 0, conflict: 0, other: 0 }, unkClass: {}, rail: { tagged: 0, "mapped-adjacent": 0, "none-in-covered-area": 0, "unknown-outside-coverage": 0 }, rough: {} };
  const ex = accumulate(samples, cls, (s, cat, w) => {
    const c = cls(s);
    if (cat === "confirmed_rough" || cat === "probable_rough") {
      let wb;
      if (c.tag && !c.tag.startsWith("stone-") && c.tag !== "paving-bad") wb = c.w;
      else {
        wb = SAMPLE_STONE_B[s.mat] ?? c.w;
        const sm = c.tag?.startsWith("stone-") ? c.tag.slice(6) : (s.sm ?? null);
        if (sm && SMOOTH_B[sm]) wb *= SMOOTH_B[sm]; // smoothness bad/very_bad (and good/excellent) as seen by model B
      }
      riskB += s.len * wb;
      const key = c.tag ?? s.mat ?? "other"; ch.rough[key] = (ch.rough[key] ?? 0) + s.len;
    } else if (cat === "unknown" || cat === "nomatch") {
      const raw = ctx.wayTags[s.way];
      const why = cat === "nomatch" ? "nomatch" : !raw || !raw[0] ? "untagged" : (BADSM.has(raw[2] ?? "") ? "conflict" : "other");
      ch.unk[why] += s.len;
      const hw = s.hw && s.hw !== "unknown" ? s.hw : null;
      ch.unkClass[hw ?? "?"] = (ch.unkClass[hw ?? "?"] ?? 0) + s.len;
      expG += s.len * (hw ? priors.global(hw) : priors.pooled.c + 0.65 * priors.pooled.p);
      const core = ctx.inCore(s.lon, s.lat);
      expZ += s.len * (hw ? priors.zoned(hw, core) : (core ? priors.pooledCore : priors.pooledOuter).c + 0.65 * (core ? priors.pooledCore : priors.pooledOuter).p);
    }
    if (ctx.rails) ch.rail[railState(s, ctx.wayTags)] += s.len;
  });
  const { channels: _unused, ...rest } = ex;
  return { ...rest, riskB: Math.round(riskB) + ex.weightedUnpaved, expG: Math.round(expG), expZ: Math.round(expZ), ch };
}

export async function makeContext(baseRates) {
  const wayTags = await loadWayTags();
  return { wayTags, layers: makeLayers(wayTags), priors: makePriors(baseRates), rails: true, inCore: (lon, lat) => lon >= 9.169 && lon <= 9.206 && lat >= 45.45 && lat <= 45.48 };
}

const LAYER_NAMES = ["L0", "La", "Lb", "Lc", "Lc_half", "Lac"];

/** Builds the analysis object of one case from its pool entries ({ coordinates, duration, distance, maneuvers, uturns, source, ... }). */
export async function buildCase(meta, entries, ctx, departure, fastIdx, prodPick) {
  const cands = [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const { production, samples } = await sampleTable(e.coordinates, meta.mode, departure);
    const ex = {};
    for (const L of LAYER_NAMES) ex[L] = analyse(samples, ctx.layers[L], ctx);
    cands.push({ i, source: e.source, dur: e.duration, dist: e.distance, maneuvers: e.maneuvers, uturns: e.uturns, uturnInfo: e.uturnInfo ?? [], blocking: production.blockingRestrictionMeters ?? 0, ex, route: { coordinates: e.coordinates, distance: e.distance, duration: e.duration }, n: samples.length });
  }
  const tol = POLICY[meta.mode].eqTol;
  const eq = cands.map((a) => cands.map((b) => (a === b ? true : routesShareCorridor(a.route, b.route, tol))));
  return { ...meta, fastIdx, prodPick, cands, eq };
}

/** The view of a pool through one layer; `riskKey` selects which risk (production, B, or C-expected). */
export function views(cs, layer, riskFn = (e) => e.risk) {
  return cs.cands.map((c) => { const e = c.ex[layer]; return { i: c.i, dur: c.dur, dist: c.dist, risk: riskFn(e), pave: e.pave, confirmed: e.confirmed, probable: e.probable, unknown: e.unknown, smooth: e.smooth, maneuvers: c.maneuvers, uturns: c.uturns }; });
}

/** What a pick means for the person, relative to the fastest route, under one yardstick layer. */
export function pickMetrics(cs, pick, yardstick = "L0") {
  const f = cs.cands[cs.fastIdx], p = cs.cands[pick];
  const ef = f.ex[yardstick], ep = p.ex[yardstick];
  return {
    pick, isFast: pick === cs.fastIdx, dt: p.dur - f.dur, dd: p.dist - f.dist, ddPct: f.dist ? (p.dist - f.dist) / f.dist : 0,
    risk: ep.risk, riskFast: ef.risk, dRisk: ep.risk - ef.risk, conf: ep.confirmed, confFast: ef.confirmed, prob: ep.probable, probFast: ef.probable,
    unk: ep.unknown, unkFast: ef.unknown, dUnk: ep.unknown - ef.unknown, maneuvers: p.maneuvers, dManeuvers: p.maneuvers - f.maneuvers, uturns: p.uturns, uturnsFast: f.uturns,
    railTram: p.ex[yardstick].ch.rail.tagged + p.ex[yardstick].ch.rail["mapped-adjacent"], railTramFast: f.ex[yardstick].ch.rail.tagged + f.ex[yardstick].ch.rail["mapped-adjacent"],
  };
}

/** Change of a pick relative to the production decision, under one yardstick. */
export function compareToProduction(cs, pickM, pickA, yardstick = "L0") {
  if (pickM === pickA) return { changed: false, cls: "same" };
  const m = pickMetrics(cs, pickM, yardstick), a = pickMetrics(cs, pickA, yardstick);
  const dRisk = m.risk - a.risk, dUnk = m.unk - a.unk, dt = m.dt - a.dt;
  let cls;
  if (m.uturns > a.uturns) cls = "worse-new-uturn";
  else if (dRisk >= 20) cls = "worse-rough";
  else if (dRisk <= -20 && dUnk <= 50 && dt <= 120) cls = "better";
  else if (dRisk <= -20) cls = "trade";
  else if (dUnk > 50) cls = "worse-unknown";
  else if (dt > 60 && dRisk > -20) cls = "worse-time";
  else if (dUnk < -50 && dt <= 120) cls = "better-unknown";
  else cls = "neutral";
  return { changed: true, cls, dRisk, dUnk, dt, dDist: m.dd - a.dd };
}

/** Loads every corpus case (baseline 354 + FIELD set) with its analysis; the split file must already exist (exp-split.mjs). */
export async function loadAllCases() {
  const read = async (u) => JSON.parse(await readFile(u, "utf8"));
  const baseRates = await read(new URL("base-rates.json", OUT));
  const split = await read(new URL("split.json", OUT));
  const ctx = await makeContext(baseRates);
  const pb = await read(new URL("pools-baseline.json", CACHE));
  const pf = await read(new URL("pools-field.json", CACHE));
  const cases = [];
  for (const src of [pb, pf]) {
    for (const c of src.cases) {
      if (!c.pool || c.status !== 200) continue;
      const group = c.kind === "main" ? split.journeys[c.journey] : c.kind === "shift" ? split.journeys[c.baseId] : "FIELD";
      const meta = { id: c.id, mode: c.mode, kind: c.kind, group, journey: c.journey, baseId: c.baseId, antiPave: c.antiPave, calls: c.calls.length, params: c.params, start: c.start, end: c.end, flags: c.flags };
      const prodPick = c.hasDistinctAlternative ? c.safeIndex : c.fastIndex;
      cases.push(await buildCase(meta, c.pool, ctx, src.departure, c.fastIndex, prodPick));
    }
  }
  return { cases, ctx, split, baseRates, departure: pb.departure };
}
