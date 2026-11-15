/**
 * sens-power.mjs - Phase 4.36 / Agent 6. SIMULATION and closed-form planning numbers for the field study.
 * All variance components and effect sizes are ASSUMED planning values (no field data exist); the point is to show how the
 * required number of SITES, PASSES and SHOCKS depends on them, not to predict the outcome.
 * Model: y(log roughness at the reference speed) = mu_class + b_site + e_pass,  b ~ N(0,tau^2), e ~ N(0,rho^2).
 *   tau = site-to-site SD within a class, rho = pass-to-pass SD at the same site/speed/device/placement (repeatability).
 * Run:  node experiments/phase436-surface-intelligence/scripts/sens-power.mjs
 * Output: evidence/smartphone-sensor-feasibility/study-power.json
 */
import { createRng, writeEvidence, round, Phi, PhiInv, quantile, ASOF } from "./sens-lib.mjs";

const SEED = 436_061;
const out = { asOf: ASOF, kind: "SIMULATION + closed-form planning numbers with ASSUMED variance components; not a prediction", seed: SEED };
const z = (p) => PhiInv(p);

/** One simulated study arm: list of sites, each a vector of pass values. */
function makeArm(rng, nSites, passes, mu, tau, rho) {
  return Array.from({ length: nSites }, () => { const b = tau * rng.normal(); return Array.from({ length: passes }, () => mu + b + rho * rng.normal()); });
}

// ---- A. separability power at SITE level (the independent unit is the site, not the pass) -------------------------------------
// Unit = site mean over P passes. d = standardised class difference of site means; AUC_site = Phi(d / sqrt 2).
// Success = point AUC >= 0.85 (d_hat >= sqrt2*PhiInv(0.85)) AND 95% lower bound of d (Hedges-Olkin SE, t critical value) gives
// AUC lower bound >= 0.75 (d_lcb >= sqrt2*PhiInv(0.75)).  Parametric, approximate, anti-conservative if the normality assumption fails.
const T975 = { 2: 4.303, 4: 2.776, 6: 2.447, 10: 2.228, 14: 2.145, 18: 2.101, 22: 2.074, 30: 2.042 };
const tCrit = (df) => { let best = 4.303; for (const k of Object.keys(T975).map(Number).sort((x, y) => x - y)) if (k <= df) best = T975[k]; return best; };
const D_POINT = Math.SQRT2 * PhiInv(0.85); const D_LCB = Math.SQRT2 * PhiInv(0.75);
const EFFECTS = [["x1.5", Math.log(1.5)], ["x1.9", Math.log(1.9)], ["x2.5", Math.log(2.5)]];
const SCENARIOS = [["optimistic", 0.20, 0.10], ["moderate", 0.25, 0.15], ["pessimistic", 0.35, 0.25]];
const SITES = [3, 4, 6, 8, 10, 12, 16];
const SIMS = 4000;
function sitePower(rng, ns, P, delta, tau, rho) {
  let ok = 0; const sdSite = Math.sqrt(tau * tau + (rho * rho) / P);
  for (let s = 0; s < SIMS; s += 1) {
    const A = Array.from({ length: ns }, () => sdSite * rng.normal());
    const B = Array.from({ length: ns }, () => delta + sdSite * rng.normal());
    const mA = A.reduce((x, y) => x + y, 0) / ns; const mB = B.reduce((x, y) => x + y, 0) / ns;
    const vA = A.reduce((x, y) => x + (y - mA) ** 2, 0) / (ns - 1); const vB = B.reduce((x, y) => x + (y - mB) ** 2, 0) / (ns - 1);
    const sp = Math.sqrt((vA + vB) / 2); const d = (mB - mA) / sp;
    const se = Math.sqrt(2 / ns + (d * d) / (4 * ns));
    if (d >= D_POINT && d - tCrit(2 * ns - 2) * se >= D_LCB) ok += 1;
  }
  return ok / SIMS;
}
out.siteLevelPower = { passesPerSite: 8, criterion: "AUC_site point >= 0.85 and 95% lower bound >= 0.75 (parametric d, t critical value)", sims: SIMS, rows: [] };
for (const [sn, tau, rho] of SCENARIOS) {
  for (const [en, delta] of EFFECTS) {
    const dTrue = delta / Math.sqrt(tau * tau + (rho * rho) / 8);
    const row = { scenario: sn, tau, rho, effect: en, deltaLog: round(delta, 3), dTrueSiteMeans: round(dTrue, 2), trueAucSiteMeans: round(Phi(dTrue / Math.SQRT2), 3), trueAucPassLevel: round(Phi(delta / Math.sqrt(2 * (tau * tau + rho * rho))), 3), powerBySitesPerClass: {} };
    for (const ns of SITES) row.powerBySitesPerClass[ns] = round(sitePower(createRng(SEED).fork(`sp-${sn}-${en}-${ns}`), ns, 8, delta, tau, rho), 2);
    out.siteLevelPower.rows.push(row);
  }
}
out.minSitesForSmallestRankTest = [3, 4, 5].map((n) => ({ sitesPerClass: n, smallestTwoSidedExactMannWhitneyP: round(2 / binom(2 * n, n), 4) }));
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return Math.round(r); }

// ---- B. passes versus sites (moderate scenario, effect x1.9) ---------------------------------------------------------------------
out.passesVsSites = [];
{
  const [, tau, rho] = SCENARIOS[1]; const delta = Math.log(1.9);
  for (const [ns, P] of [[8, 1], [8, 3], [8, 8], [8, 16], [8, 32], [4, 8], [12, 8], [16, 8]]) {
    out.passesVsSites.push({ sitesPerClass: ns, passesPerSite: P, siteMeanSd: round(Math.sqrt(tau * tau + (rho * rho) / P), 4), power: round(sitePower(createRng(SEED).fork(`pvs-${ns}-${P}`), ns, P, delta, tau, rho), 2) });
  }
}

// ---- C. repeatability and ICC precision ------------------------------------------------------------------------------------
function icc1(arm) { // one-way ANOVA ICC(1,1), balanced
  const n = arm.length; const k = arm[0].length; const means = arm.map((a) => a.reduce((s, v) => s + v, 0) / k);
  const grand = means.reduce((s, v) => s + v, 0) / n;
  const msb = (k * means.reduce((s, m) => s + (m - grand) ** 2, 0)) / (n - 1);
  const msw = arm.reduce((s, a, i) => s + a.reduce((t, v) => t + (v - means[i]) ** 2, 0), 0) / (n * (k - 1));
  return (msb - msw) / (msb + (k - 1) * msw);
}
out.iccPrecision = [];
for (const [label, sigmaB, rho, nSites, k] of [
  ["all sites pooled (class effect inflates ICC)", 0.5, 0.15, 11, 8],
  ["within one class", 0.25, 0.15, 4, 8], ["within one class", 0.25, 0.15, 8, 8], ["within one class", 0.25, 0.25, 8, 8],
]) {
  const rng = createRng(SEED).fork(`icc-${label}-${sigmaB}-${rho}-${nSites}`); const est = [];
  for (let s = 0; s < 2000; s += 1) est.push(icc1(makeArm(rng, nSites, k, 0, sigmaB, rho)));
  est.sort((a, b) => a - b);
  out.iccPrecision.push({ label, sitesN: nSites, passesK: k, trueIcc: round(sigmaB ** 2 / (sigmaB ** 2 + rho ** 2), 3), estimateMedian: round(quantile(est, 0.5), 3), ci95: [round(quantile(est, 0.025), 2), round(quantile(est, 0.975), 2)] });
}
out.repeatability = {
  note: "relative SE of an SD estimate ~ 1/sqrt(2 df), df = sites*(passes-1)",
  rows: [[11, 8], [11, 6], [6, 8], [4, 8]].map(([n, k]) => ({ sites: n, passes: k, df: n * (k - 1), relSePct: round(100 / Math.sqrt(2 * n * (k - 1)), 1) })),
  passesForSiteMeanSe: [0.1, 0.15, 0.25].map((rho) => ({ rho, passesForSe0p05: Math.ceil((rho / 0.05) ** 2), passesForSe0p10: Math.ceil((rho / 0.10) ** 2) })),
};

// ---- D. speed-normalisation residual: paired passes per site-speed to detect a residual of delta (log) ---------------------
const zA = z(0.975); const zB = z(0.8);
out.speedResidualPasses = [0.10, 0.15, 0.25].flatMap((rho) => [0.10, 0.18, 0.30].map((delta) => ({
  rho, residualLog: delta, approxPct: round((Math.exp(delta) - 1) * 100, 0),
  passesPerSpeedIndependent: Math.ceil(((zA + zB) ** 2 * 2 * rho * rho) / (delta * delta)),
  passesPerSpeedWhen3SitesPooled: Math.ceil(((zA + zB) ** 2 * 2 * rho * rho) / (delta * delta) / 3),
})));

// ---- E. cross-device agreement (Bland-Altman limits of agreement precision) --------------------------------------------------
out.blandAltman = [0.10, 0.15, 0.25].flatMap((sd) => [30, 60, 120].map((n) => ({
  sdOfLogDifference: sd, pairs: n,
  limitsOfAgreementLog: round(1.96 * sd, 3), seOfLimitLog: round(sd * Math.sqrt(1 / n + (1.96 ** 2) / (2 * (n - 1))), 3),
})));

// ---- F. shock-rejection rate: Wilson 95% lower bound ----------------------------------------------------------------------------
const wilsonLo = (x, n) => { const p = x / n; const zz = 1.96; const d = 1 + (zz * zz) / n; return (p + (zz * zz) / (2 * n) - zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / d; };
out.shockRejection = [30, 60, 120].flatMap((n) => [0.9, 0.95, 0.98].map((p) => ({ shocks: n, observedRate: p, wilsonLower95: round(wilsonLo(Math.round(p * n), n), 3) })));

const sha = writeEvidence("study-power.json", out);
console.log("sha256", sha);
for (const r of out.siteLevelPower.rows) console.log(r.scenario.padEnd(12), r.effect, "dSite", r.dTrueSiteMeans, "AUCsite", r.trueAucSiteMeans, "AUCpass", r.trueAucPassLevel, JSON.stringify(r.powerBySitesPerClass));
console.log("passesVsSites", JSON.stringify(out.passesVsSites));
console.log("icc", JSON.stringify(out.iccPrecision));
console.log("repeat", JSON.stringify(out.repeatability));
console.log("speedResidual", JSON.stringify(out.speedResidualPasses.filter((r) => r.rho === 0.15)));
console.log("BA", JSON.stringify(out.blandAltman.filter((r) => r.sdOfLogDifference === 0.15)));
console.log("shock", JSON.stringify(out.shockRejection));
