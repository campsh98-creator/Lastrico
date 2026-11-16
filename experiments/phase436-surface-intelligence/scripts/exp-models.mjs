/**
 * Phase 4.36 routing-experiments: selection models. Pure functions over "views" of a candidate pool.
 *
 * A view V[i] = { i, dur (s), dist (m), risk, pave, confirmed, probable, unknown, smooth, maneuvers, uturns, ... } is one pooled candidate
 * seen through ONE data layer. eq[i][j] = routesShareCorridor(i, j) (production's distinctness test, same tolerance per mode).
 *
 * Model A is a line-by-line re-implementation of selectOptimizedRoute (lib/route-optimization.ts:83-155) plus the handler's
 * hasDistinctAlternative post-filter (app/api/routes/route.ts:831-834). exp-run-scoring.mjs asserts that it picks the same candidate
 * as the production handler in every one of the 354 corpus cases before any other model is trusted.
 */

// Copy of MODE_POLICY (app/api/routes/route.ts:83-132); the A-vs-handler assertion detects drift.
export const POLICY = {
  car: { min: 20, div: 500, eqTol: 32, limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } } },
  motorcycle: { min: 15, div: 330, eqTol: 30, limits: { balanced: { factor: 1.28, seconds: 240 }, strong: { factor: 1.55, seconds: 540 }, maximum: { factor: 1.9, seconds: 900 } } },
  bicycle: { min: 12, div: 260, eqTol: 24, limits: { balanced: { factor: 1.3, seconds: 300 }, strong: { factor: 1.6, seconds: 720 }, maximum: { factor: 2.1, seconds: 1200 } } },
};
export const secondsWeightOf = (policy, avoidance) => (avoidance === "maximum" ? 0 : policy.div / (avoidance === "balanced" ? 60 : 600));
/** Metres of stone one second is worth at an avoidance level: strong car = 500/600 m per s, i.e. 1 m of stone = 1.2 s. */
export const secondsPerMetre = (policy, avoidance) => { const w = secondsWeightOf(policy, avoidance); return w > 0 ? 1 / w : Infinity; };

const cmp = (a, b) => a.dur - b.dur || a.risk - b.risk || a.unknown - b.unknown || a.i - b.i;

function pareto(list) {
  const obj = (c) => [c.dur, c.risk, c.unknown];
  return list.filter((c) => { const v = obj(c); return !list.some((o) => { const w = obj(o); return w.every((x, k) => x <= v[k]) && w.some((x, k) => x < v[k]); }); }).sort(cmp);
}

/** Production burden (route-optimization.ts:104-118); `uScale` scales every unknown-surface term (1 = production). */
export function prodBurden(c, fast, uScale = 1) {
  const deltaUnk = Math.max(0, c.unknown - fast.unknown);
  if (deltaUnk === 0) return c.risk;
  const paveSaved = Math.max(0, fast.pave - c.pave);
  const smoothGained = Math.max(0, c.smooth - fast.smooth);
  const unbacked = Math.max(0, paveSaved - smoothGained);
  const high = Math.min(deltaUnk, unbacked);
  const remaining = deltaUnk - high;
  const cap = paveSaved > 0 ? paveSaved * 1.25 : 0;
  const discounted = Math.min(remaining, cap);
  const excess = remaining - discounted;
  return c.risk + uScale * (high + discounted * 0.35 + excess * 1.0);
}

const CONF_TOL = 10, SWAP_SHARE = 0.1, SWAP_MAX = 50;
const addsConfirmedOf = (c, fast) => c.confirmed > fast.confirmed + Math.max(CONF_TOL, Math.min(SWAP_MAX, Math.max(0, fast.probable - c.probable) * SWAP_SHARE));

/**
 * Generic production-shaped selection. Options:
 *   avoidance, burden(c, fast), secondsWeight (m per s), extraUtility(c) (metre-equivalents), exclude(c) (non-fast candidates only),
 *   frontierObjectives (default dur, risk, unknown).
 * Returns { pick, rawSafe, distinct, frontier, utilityOf }.
 */
export function select(V, fastIdx, eq, mode, o = {}) {
  const policy = POLICY[mode], avoidance = o.avoidance ?? "strong", limit = policy.limits[avoidance];
  const fast = V[fastIdx];
  const eligible = V.filter((c) => (c.i === fastIdx || (!eq[c.i][fastIdx] && !(o.exclude?.(c))))
    && c.dur <= fast.dur * limit.factor + limit.seconds);
  const frontier = pareto(eligible);
  const burden = o.burden ?? ((c, f) => prodBurden(c, f, o.uScale ?? 1));
  const sw = o.secondsWeight ?? secondsWeightOf(policy, avoidance) * (o.secondsWeightMul ?? 1);
  const utility = (c) => burden(c, fast) + (c.dur - fast.dur) * sw + (o.extraUtility?.(c) ?? 0);
  const reducing = frontier.filter((c) => !eq[c.i][fastIdx] && !addsConfirmedOf(c, fast)
    && c.pave <= fast.pave && c.risk + policy.min <= fast.risk
    && burden(c, fast) + policy.min <= burden(fast, fast) && utility(c) < utility(fast));
  reducing.sort((a, b) => utility(a) - utility(b) || cmp(a, b));
  const safe = reducing[0] ?? fast;
  const distinct = !eq[fastIdx][safe.i] && safe.pave < fast.pave && safe.risk + policy.min <= fast.risk;
  return { pick: distinct ? safe.i : fastIdx, rawSafe: safe.i, distinct, frontier: frontier.map((c) => c.i), utilityOf: utility };
}

/**
 * Model D: robust optimisation over scenarios for the share p of unknown metres that is rough.
 *   utility_s(c) = knownRisk(c) + p_s * unknown(c) * wUnknown + (dur - dur_fast) * secondsWeight
 *   rule "regret": minimise the maximum regret over scenarios; rule "maximin": minimise the worst-case utility.
 * Production guards stay (no added confirmed stone beyond tolerance, known risk reduced by the minimum, raw pave not increased).
 */
export function selectRobust(V, fastIdx, eq, mode, o = {}) {
  const policy = POLICY[mode], avoidance = o.avoidance ?? "strong", limit = policy.limits[avoidance];
  const P = o.scenarios ?? [0, 0.1, 0.3, 0.5];
  const fast = V[fastIdx];
  const sw = o.secondsWeight ?? secondsWeightOf(policy, avoidance);
  const eligible = V.filter((c) => (c.i === fastIdx || !eq[c.i][fastIdx]) && c.dur <= fast.dur * limit.factor + limit.seconds);
  const U = (c, p) => c.risk + p * (o.wUnknown ?? 1) * c.unknown + (c.dur - fast.dur) * sw;
  const best = P.map((p) => Math.min(...eligible.map((c) => U(c, p))));
  const score = (c) => (o.rule === "maximin" ? Math.max(...P.map((p) => U(c, p))) : Math.max(...P.map((p, k) => U(c, p) - best[k])));
  const ok = (c) => c.i === fastIdx || (!addsConfirmedOf(c, fast) && c.pave <= fast.pave && c.risk + policy.min <= fast.risk);
  const ranked = eligible.filter(ok).sort((a, b) => score(a) - score(b) || U(a, P[1] ?? 0) - U(b, P[1] ?? 0) || cmp(a, b));
  const winner = ranked[0] ?? fast;
  // a non-fast winner must also beat fast in the robust score (ties keep the fast route)
  const safe = winner.i !== fastIdx && score(winner) < score(fast) ? winner : fast;
  const distinct = !eq[fastIdx][safe.i] && safe.pave < fast.pave && safe.risk + policy.min <= fast.risk;
  return { pick: distinct ? safe.i : fastIdx, rawSafe: safe.i, distinct, regretOf: (c) => score(c) };
}

/** Pareto set on any objective vector function (minimisation); returns indices. Ties (equal vectors) all stay. */
export function paretoIndices(V, objectives) {
  const O = V.map((c) => objectives(c));
  return V.filter((_, a) => !V.some((_, b) => b !== a && O[b].every((x, k) => x <= O[a][k]) && O[b].some((x, k) => x < O[a][k]))).map((c) => c.i);
}
