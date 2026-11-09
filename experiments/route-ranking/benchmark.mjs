#!/usr/bin/env node
/**
 * Phase 4.20 benchmark: experimental ranker vs CURRENT production selection vs recorded choice.
 *
 * Reads corpus/scenarios.json (build-corpus.mjs), writes results.json and report.md.
 * Every number in report.md is computed here from the corpus; nothing is typed by hand.
 *
 * Usage (from the repository root): node experiments/route-ranking/benchmark.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROFILE_IDS, RANKER_VERSION, dominates, getProfile, legalityIssue, makeCustomProfile, rankRoutes, sumContributions,
} from "./ranker.mjs";
import { PRODUCTION_MODE_POLICY, productionSelect } from "./lib/production-baseline.mjs";
import { equivalenceById, knownPave, rankerEquivalent, requestedBudget } from "./lib/scenario-adapter.mjs";
import { renderReport } from "./lib/report.mjs";
import { prng, randomPool } from "./lib/synthetic.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const scenariosAll = JSON.parse(readFileSync(join(HERE, "corpus/scenarios.json"), "utf8")).scenarios;
const manifest = JSON.parse(readFileSync(join(HERE, "corpus/manifest.json"), "utf8"));

const scenarios = scenariosAll.filter((s) => !s.duplicateOf);
const view = (s) => (s.set === "G" ? "G" : s.codeEra === "dist-2026-11-05" ? "R-live" : "R-archived");
const VIEWS = ["R-live", "G", "R-archived"];
const PROFILES = [...PROFILE_IDS];
const round = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? value : Math.round(value * 10 ** digits) / 10 ** digits);

function budgetsFor(scenario) {
  const requested = requestedBudget(scenario);
  return requested === null ? [{ label: "requested", value: null }] : [{ label: "requested", value: requested }, { label: "none", value: null }];
}

function describe(candidate, fast) {
  return {
    id: candidate.id,
    source: candidate.source,
    extraSeconds: round(candidate.durationS - fast.durationS, 1),
    extraMeters: round(candidate.distanceM - fast.distanceM, 0),
    knownPaveAvoidedM: knownPave(fast) - knownPave(candidate),
    confirmedAvoidedM: fast.confirmedPaveM - candidate.confirmedPaveM,
    probableAvoidedM: fast.probablePaveM - candidate.probablePaveM,
    unknownAddedM: candidate.unknownM - fast.unknownM,
  };
}

/** Pareto check in the ranker's raw-criteria space among comparable candidates. */
function dominatedInRankerSpace(scenario, chosen, fast, budget, limit, equivalent) {
  return scenario.candidates.some((other) => other !== chosen && !legalityIssue(other, scenario.mode)
    && (other === fast || !equivalent(other.id, fast.id))
    && (budget === null || other.durationS <= fast.durationS + budget * 60)
    && other.durationS <= fast.durationS * limit.factor + limit.seconds
    && dominates(other, chosen));
}

/** Pareto check in production's space (duration, riskMeters, unknownMeters). */
function dominatedInProductionSpace(scenario, chosen, fast, budget, limit, equivalent) {
  const v = (c) => [c.durationS, c.riskM, c.unknownM];
  const vc = v(chosen);
  return scenario.candidates.some((other) => {
    if (other === chosen || legalityIssue(other, scenario.mode)) return false;
    if (other !== fast && equivalent(other.id, fast.id)) return false;
    if (budget !== null && other.durationS > fast.durationS + budget * 60) return false;
    if (other.durationS > fast.durationS * limit.factor + limit.seconds) return false;
    const vo = v(other);
    return vo.every((x, i) => x <= vc[i]) && vo.some((x, i) => x < vc[i]);
  });
}

const rows = [];
const harness = [];
for (const scenario of scenarios) {
  const eq = equivalenceById(scenario);
  const rankerEq = rankerEquivalent(scenario);
  const byId = new Map(scenario.candidates.map((c) => [c.id, c]));
  for (const budget of budgetsFor(scenario)) {
    for (const profileId of PROFILES) {
      const ranked = rankRoutes(scenario.candidates, { mode: scenario.mode, profile: profileId, maxExtraMinutes: budget.value, equivalent: rankerEq });
      if (!ranked.winnerId) continue;
      const fast = byId.get(ranked.referenceId);
      const avoidance = profileId === "fastest" ? null : profileId;
      const production = avoidance
        ? productionSelect(scenario.candidates, { mode: scenario.mode, avoidance, maxExtraMinutes: budget.value, equivalentById: eq })
        : null;
      const productionId = production ? production.safeId : fast.id;
      const productionFastId = production ? production.fastId : fast.id;
      const winner = byId.get(ranked.winnerId);
      const prodChoice = byId.get(productionId);
      const limit = getProfile(profileId, scenario.mode).detourLimit;
      const prodLimit = PRODUCTION_MODE_POLICY[scenario.mode].limits[avoidance ?? "balanced"];
      const recordedComparable = scenario.set === "R" && scenario.requested.avoidance === profileId
        && (scenario.requested.maxExtraMinutes ?? null) === budget.value;
      const auditSum = Math.max(...ranked.ranking.map((entry) => Math.abs(sumContributions(entry.contributions) - entry.cost)));
      rows.push({
        scenarioId: scenario.id,
        view: view(scenario),
        area: scenario.area,
        mode: scenario.mode,
        codeEra: scenario.codeEra ?? "rescored-current",
        profile: profileId,
        budget: budget.value,
        budgetLabel: budget.label,
        candidates: scenario.candidates.length,
        paveTradeOff: scenario.stats.paveTradeOffAlternatives > 0,
        distinctAlternative: scenario.stats.distinctLegalAlternatives > 0,
        fastestId: fast.id,
        fastAgreesWithProduction: productionFastId === fast.id,
        ranker: { ...describe(winner, fast), cost: round(ranked.ranking[0].cost, 2) },
        production: describe(prodChoice, fast),
        recorded: recordedComparable ? scenario.recorded.choiceId : undefined,
        agree: ranked.winnerId === productionId,
        rankerDominatedRankerSpace: dominatedInRankerSpace(scenario, winner, fast, budget.value, limit, eq),
        productionDominatedRankerSpace: dominatedInRankerSpace(scenario, prodChoice, fast, budget.value, prodLimit, eq),
        rankerDominatedProductionSpace: dominatedInProductionSpace(scenario, winner, fast, budget.value, limit, eq),
        productionDominatedProductionSpace: dominatedInProductionSpace(scenario, prodChoice, fast, budget.value, prodLimit, eq),
        explanation: ranked.explanation,
        excluded: ranked.excluded,
        contributionAuditMaxError: auditSum,
      });
      if (recordedComparable) {
        harness.push({ scenarioId: scenario.id, view: view(scenario), codeEra: scenario.codeEra, recordedChoice: scenario.recorded.choiceId,
          recordedFast: scenario.recorded.fastId, replayFast: productionFastId, replayChoice: productionId,
          replayMatchesRecorded: productionId === scenario.recorded.choiceId, rankerChoice: ranked.winnerId });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------------------------
function aggregate(list) {
  const sum = (key, who) => list.reduce((total, row) => total + row[who][key], 0);
  const switched = (who) => list.filter((row) => row[who].id !== row.fastestId).length;
  return {
    comparisons: list.length,
    agreement: list.length ? round(list.filter((row) => row.agree).length / list.length, 3) : null,
    agreeCount: list.filter((row) => row.agree).length,
    ranker: {
      switchedFromFastest: switched("ranker"),
      knownPaveAvoidedM: sum("knownPaveAvoidedM", "ranker"),
      confirmedAvoidedM: sum("confirmedAvoidedM", "ranker"),
      extraMinutes: round(sum("extraSeconds", "ranker") / 60, 1),
      extraMeters: sum("extraMeters", "ranker"),
      unknownAddedM: sum("unknownAddedM", "ranker"),
      dominatedRankerSpace: list.filter((row) => row.rankerDominatedRankerSpace).length,
      dominatedProductionSpace: list.filter((row) => row.rankerDominatedProductionSpace).length,
    },
    production: {
      switchedFromFastest: switched("production"),
      knownPaveAvoidedM: sum("knownPaveAvoidedM", "production"),
      confirmedAvoidedM: sum("confirmedAvoidedM", "production"),
      extraMinutes: round(sum("extraSeconds", "production") / 60, 1),
      extraMeters: sum("extraMeters", "production"),
      unknownAddedM: sum("unknownAddedM", "production"),
      dominatedRankerSpace: list.filter((row) => row.productionDominatedRankerSpace).length,
      dominatedProductionSpace: list.filter((row) => row.productionDominatedProductionSpace).length,
    },
  };
}

const primaryRows = rows.filter((row) => row.budgetLabel === "requested");
const aggregates = {};
for (const v of VIEWS) {
  aggregates[v] = {};
  for (const profile of PROFILES) {
    const list = primaryRows.filter((row) => row.view === v && row.profile === profile);
    aggregates[v][profile] = { all: aggregate(list), paveTradeOff: aggregate(list.filter((row) => row.paveTradeOff)) };
  }
}
const noBudgetAggregates = {};
for (const v of VIEWS) {
  noBudgetAggregates[v] = {};
  for (const profile of PROFILES) {
    noBudgetAggregates[v][profile] = aggregate(rows.filter((row) => row.view === v && row.profile === profile && row.budget === null));
  }
}
const byMode = {};
for (const mode of ["car", "motorcycle", "bicycle"]) {
  byMode[mode] = Object.fromEntries(PROFILES.map((profile) => [profile,
    aggregate(primaryRows.filter((row) => row.view !== "R-archived" && row.mode === mode && row.profile === profile))]));
}
const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
const divergences = primaryRows.filter((row) => !row.agree).map((row) => {
  // Attribution: does the ranker agree once its two extra criteria (distance, switching threshold) are removed?
  const scenario = scenarioById.get(row.scenarioId);
  const profile = makeCustomProfile(scenario.mode, { base: row.profile, weights: { distance: 0 }, switchingCostEq: 0 });
  const stripped = rankRoutes(scenario.candidates, { mode: scenario.mode, profile, maxExtraMinutes: row.budget, equivalent: rankerEquivalent(scenario) });
  return {
    scenarioId: row.scenarioId, view: row.view, mode: row.mode, profile: row.profile, budget: row.budget,
    ranker: row.ranker, production: row.production, explanation: row.explanation,
    agreesWithoutDistanceAndSwitching: stripped.winnerId === row.production.id,
    bothNonDominated: !row.rankerDominatedRankerSpace && !row.productionDominatedRankerSpace
      && !row.rankerDominatedProductionSpace && !row.productionDominatedProductionSpace,
  };
});

// ---------------------------------------------------------------------------------------------
// Weight sensitivity / stability and break-even minute value
// ---------------------------------------------------------------------------------------------
const PERTURBATIONS = [
  { id: "time x0.5", change: (w) => ({ time: w.time * 0.5, distance: w.distance * 0.5 }) },
  { id: "time x0.8", change: (w) => ({ time: w.time * 0.8, distance: w.distance * 0.8 }) },
  { id: "time x1.25", change: (w) => ({ time: w.time * 1.25, distance: w.distance * 1.25 }) },
  { id: "time x2", change: (w) => ({ time: w.time * 2, distance: w.distance * 2 }) },
  { id: "probable 0.4", change: () => ({ probablePave: 0.4 }) },
  { id: "probable 0.9", change: () => ({ probablePave: 0.9 }) },
  { id: "unknown 0.2", change: (w) => ({ unknown: 0.2, unbackedUnknown: 1 - 0.2 + (w.unknown + w.unbackedUnknown - 1) }) },
  { id: "unknown 0.6", change: () => ({ unknown: 0.6, unbackedUnknown: Math.max(0, 1 - 0.6) }) },
];
const stability = {};
const breakEven = [];
for (const v of ["R-live", "G"]) {
  stability[v] = {};
  const pool = scenarios.filter((s) => view(s) === v && s.stats.distinctLegalAlternatives > 0);
  for (const profileId of ["balanced", "strong", "maximum"]) {
    const counts = {};
    let total = 0;
    for (const scenario of pool) {
      const options = { mode: scenario.mode, maxExtraMinutes: requestedBudget(scenario), equivalent: rankerEquivalent(scenario) };
      const base = rankRoutes(scenario.candidates, { ...options, profile: profileId }).winnerId;
      const weights = getProfile(profileId, scenario.mode).weights;
      total += 1;
      for (const perturbation of PERTURBATIONS) {
        const profile = makeCustomProfile(scenario.mode, { base: profileId, weights: perturbation.change(weights) });
        const changed = rankRoutes(scenario.candidates, { ...options, profile }).winnerId !== base;
        counts[perturbation.id] = (counts[perturbation.id] ?? 0) + (changed ? 1 : 0);
      }
    }
    stability[v][profileId] = { scenarios: total, winnerChanged: counts };
  }
  // Break-even: largest minute value (m-eq per minute, log grid) at which a non-fastest route wins
  // under the "maximum" detour limit and the requested budget, other weights as in "strong".
  const grid = [1, 2, 5, 10, 20, 33, 50, 75, 100, 150, 200, 260, 330, 500, 750, 1000, 2000, 5000];
  for (const scenario of pool) {
    const options = { mode: scenario.mode, maxExtraMinutes: requestedBudget(scenario), equivalent: rankerEquivalent(scenario) };
    let largest = null;
    for (const time of grid) {
      const profile = makeCustomProfile(scenario.mode, { base: "strong", detourLevel: "maximum", weights: { time, distance: time * 0.1 } });
      const result = rankRoutes(scenario.candidates, { ...options, profile });
      if (!result.winnerIsReference) largest = time;
    }
    breakEven.push({ scenarioId: scenario.id, view: v, mode: scenario.mode, paveTradeOff: scenario.stats.paveTradeOffAlternatives > 0,
      largestMinuteValueWithDetour: largest });
  }
}

// Effect of the unknown-credit option on GENUINE scenarios (requested budget).
const unknownCreditEffect = { comparisons: 0, changed: 0, changedNowAgreesWithProduction: 0, cases: [] };
for (const row of primaryRows.filter((r) => r.profile !== "fastest")) {
  const scenario = scenarioById.get(row.scenarioId);
  const profile = makeCustomProfile(scenario.mode, { base: row.profile, creditUnknownReduction: false });
  const alt = rankRoutes(scenario.candidates, { mode: scenario.mode, profile, maxExtraMinutes: row.budget, equivalent: rankerEquivalent(scenario) });
  unknownCreditEffect.comparisons += 1;
  if (alt.winnerId !== row.ranker.id) {
    unknownCreditEffect.changed += 1;
    if (alt.winnerId === row.production.id) unknownCreditEffect.changedNowAgreesWithProduction += 1;
    unknownCreditEffect.cases.push({ scenarioId: row.scenarioId, profile: row.profile, withCredit: row.ranker.id, withoutCredit: alt.winnerId, production: row.production.id });
  }
}

// ---------------------------------------------------------------------------------------------
// SYNTHETIC cross-check (labelled): where do the two decision rules differ outside the corpus?
// Seeded random pools, no corridor duplicates, budget +5 min. Not evidence about real routes.
// ---------------------------------------------------------------------------------------------
const synthetic = { label: "SYNTHETIC — seeded random candidate pools, not genuine routes", seed: 2026_11_05, poolsPerModeAndProfile: 2000, results: {} };
{
  const random = prng(synthetic.seed);
  const never = (a, b) => a === b;
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    for (const profileId of ["balanced", "strong", "maximum"]) {
      const tally = { pools: 0, agree: 0, onlyProductionSwitches: 0, onlyRankerSwitches: 0, bothSwitchDifferently: 0,
        explainedByDistanceOrSwitching: 0,
        explainedAlsoByUnknownCredit: 0,
        inDivergences: { rankerKnownPaveAvoidedM: 0, productionKnownPaveAvoidedM: 0, rankerExtraS: 0, productionExtraS: 0,
          rankerUnknownAddedM: 0, productionUnknownAddedM: 0 } };
      for (let i = 0; i < synthetic.poolsPerModeAndProfile; i += 1) {
        const pool = randomPool(random, mode);
        const ranked = rankRoutes(pool, { mode, profile: profileId, maxExtraMinutes: 5 });
        const production = productionSelect(pool, { mode, avoidance: profileId, maxExtraMinutes: 5, equivalentById: never });
        tally.pools += 1;
        if (ranked.winnerId === production.safeId) { tally.agree += 1; continue; }
        const rankerSwitched = ranked.winnerId !== ranked.referenceId;
        const productionSwitched = production.safeId !== production.fastId;
        if (productionSwitched && !rankerSwitched) tally.onlyProductionSwitches += 1;
        else if (rankerSwitched && !productionSwitched) tally.onlyRankerSwitches += 1;
        else tally.bothSwitchDifferently += 1;
        const stripped = rankRoutes(pool, { mode, maxExtraMinutes: 5,
          profile: makeCustomProfile(mode, { base: profileId, weights: { distance: 0 }, switchingCostEq: 0 }) });
        if (stripped.winnerId === production.safeId) tally.explainedByDistanceOrSwitching += 1;
        const asymmetric = rankRoutes(pool, { mode, maxExtraMinutes: 5,
          profile: makeCustomProfile(mode, { base: profileId, weights: { distance: 0 }, switchingCostEq: 0, creditUnknownReduction: false }) });
        if (asymmetric.winnerId === production.safeId) tally.explainedAlsoByUnknownCredit += 1;
        const fastC = pool.find((c) => c.id === ranked.referenceId);
        const rc = pool.find((c) => c.id === ranked.winnerId);
        const pc = pool.find((c) => c.id === production.safeId);
        const d = tally.inDivergences;
        d.rankerKnownPaveAvoidedM += knownPave(fastC) - knownPave(rc);
        d.productionKnownPaveAvoidedM += knownPave(fastC) - knownPave(pc);
        d.rankerExtraS += rc.durationS - fastC.durationS;
        d.productionExtraS += pc.durationS - fastC.durationS;
        d.rankerUnknownAddedM += rc.unknownM - fastC.unknownM;
        d.productionUnknownAddedM += pc.unknownM - fastC.unknownM;
      }
      tally.agreement = round(tally.agree / tally.pools, 3);
      synthetic.results[`${mode}/${profileId}`] = tally;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------------------------
function timeIt(fn, repetitions) {
  const samples = [];
  for (let i = 0; i < repetitions; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1000);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * 0.95)], max: samples.at(-1) };
}
const runtimeScenarios = scenarios.filter((s) => s.candidates.length > 0);
for (const scenario of runtimeScenarios) {
  rankRoutes(scenario.candidates, { mode: scenario.mode, profile: "strong", maxExtraMinutes: 5, equivalent: rankerEquivalent(scenario) });
}
const rankerTimes = [];
const productionTimes = [];
for (const scenario of runtimeScenarios) {
  const eqR = rankerEquivalent(scenario);
  const eq = equivalenceById(scenario);
  rankerTimes.push(timeIt(() => rankRoutes(scenario.candidates, { mode: scenario.mode, profile: "strong", maxExtraMinutes: 5, equivalent: eqR }), 200).median);
  productionTimes.push(timeIt(() => productionSelect(scenario.candidates, { mode: scenario.mode, avoidance: "strong", maxExtraMinutes: 5, equivalentById: eq }), 200).median);
}
const quantile = (list, q) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * q))];
const runtime = {
  unit: "microseconds per call (median of 200 repetitions per scenario, then distribution over scenarios)",
  note: "Excludes geometry, scoring and provider calls; equivalence answers are precomputed in both selectors.",
  scenarios: runtimeScenarios.length,
  maxCandidates: Math.max(...runtimeScenarios.map((s) => s.candidates.length)),
  ranker: { median: round(quantile(rankerTimes, 0.5), 1), p95: round(quantile(rankerTimes, 0.95), 1), max: round(Math.max(...rankerTimes), 1) },
  production: { median: round(quantile(productionTimes, 0.5), 1), p95: round(quantile(productionTimes, 0.95), 1), max: round(Math.max(...productionTimes), 1) },
  node: process.version,
};

// ---------------------------------------------------------------------------------------------
// Maintenance cost
// ---------------------------------------------------------------------------------------------
function loc(path) {
  const text = readFileSync(join(HERE, path), "utf8");
  let code = 0;
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (inBlock) { if (line.includes("*/")) inBlock = false; continue; }
    if (line.startsWith("/*")) { if (!line.includes("*/")) inBlock = true; continue; }
    if (line === "" || line.startsWith("//") || line.startsWith("*")) continue;
    code += 1;
  }
  return { path, totalLines: text.split("\n").length, codeLines: code };
}
const maintenance = {
  files: ["ranker.mjs", "lib/production-baseline.mjs", "lib/scenario-adapter.mjs", "lib/synthetic.mjs", "build-corpus.mjs", "benchmark.mjs", "lib/report.mjs",
    "collect-live.mjs", "test/ranker.test.mjs", "test/production-parity.test.mjs", "test/corpus.test.mjs", "test/helpers.mjs"].map(loc),
  rankerProductionImports: 0,
  rankerMirroredConstants: "MODE_SETTINGS (balancedPaveDivisor, minimumPaveReduction, limits) mirrored from app/api/routes/route.ts; drift guarded by test/production-parity.test.mjs",
  rankerInputContract: "normalised candidate metrics (durationS, distanceM, confirmedPaveM, probablePaveM, unknownM, smoothM, unpavedWeightedM, provider, profile, restriction metres); maps 1:1 from RoadIntelligenceScore + EngineRoute",
  harnessProductionImports: ["lib/route-optimization.ts", "lib/route-candidates.ts", "lib/routing-providers.ts", "lib/road-intelligence-scoring.ts", "lib/spatial-road-store.ts", "lib/pilot-areas.ts"],
};

// ---------------------------------------------------------------------------------------------
// Harness validation and corpus summary
// ---------------------------------------------------------------------------------------------
const harnessSummary = {};
for (const v of VIEWS) {
  const list = harness.filter((item) => item.view === v);
  harnessSummary[v] = {
    comparable: list.length,
    replayMatchesRecorded: list.filter((item) => item.replayMatchesRecorded).length,
    replayFastMatchesRecordedFast: list.filter((item) => item.replayFast === item.recordedFast).length,
    rankerMatchesRecorded: list.filter((item) => item.rankerChoice === item.recordedChoice).length,
    mismatches: list.filter((item) => !item.replayMatchesRecorded),
  };
}
const corpusSummary = Object.fromEntries(VIEWS.map((v) => {
  const list = scenarios.filter((s) => view(s) === v);
  return [v, {
    scenarios: list.length,
    withDistinctAlternative: list.filter((s) => s.stats.distinctLegalAlternatives > 0).length,
    withPaveTradeOff: list.filter((s) => s.stats.paveTradeOffAlternatives > 0).length,
    candidates: list.reduce((total, s) => total + s.candidates.length, 0),
    byMode: Object.fromEntries(["car", "motorcycle", "bicycle"].map((mode) => [mode, list.filter((s) => s.mode === mode).length])),
    byArea: Object.fromEntries(["milan", "roccella"].map((area) => [area, list.filter((s) => s.area === area).length])),
  }];
}));

// Independent recomputation of the R-live "strong" headline straight from the raw live files
// (the server answered with avoid=strong and no budget), bypassing corpus normalisation.
const rawLiveCheck = (() => {
  const dir = join(HERE, "corpus/live-2026-11-05");
  let names = [];
  try { names = readdirSync(dir).filter((name) => name.startsWith("resp-")).sort(); } catch { return null; }
  const out = { responses: 0, switched: 0, knownPaveAvoidedM: 0, extraSeconds: 0, unknownAddedM: 0 };
  for (const name of names) {
    const record = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (record.status !== 200) continue;
    out.responses += 1;
    const p = record.payload;
    if (!p.hasDistinctAlternative) continue;
    out.switched += 1;
    out.knownPaveAvoidedM += p.fast.paveMeters - p.safe.paveMeters;
    out.extraSeconds += (p.safe.minutes - p.fast.minutes) * 60;
    out.unknownAddedM += p.safe.unknownSurfaceMeters - p.fast.unknownSurfaceMeters;
  }
  const a = aggregates["R-live"].strong.all;
  out.extraMinutes = round(out.extraSeconds / 60, 1);
  out.matchesBenchmark = out.switched === a.production.switchedFromFastest && out.knownPaveAvoidedM === a.production.knownPaveAvoidedM
    && out.extraMinutes === a.production.extraMinutes && out.unknownAddedM === a.production.unknownAddedM;
  return out;
})();

let liveLog = null;
try {
  liveLog = JSON.parse(readFileSync(join(HERE, "corpus/live-2026-11-05/request-log.json"), "utf8"));
} catch { liveLog = null; }

const results = {
  schema: "lastrico-phase420-route-ranking-results/1",
  rankerVersion: RANKER_VERSION,
  corpusManifestSha: manifest.currentCode,
  disclaimer: "No ground truth of user satisfaction or physical road roughness exists for these routes. Agreement and trade-off totals describe selector behaviour on recorded candidates, not route quality.",
  corpus: {
    inputFiles: manifest.inventory.length,
    setR: { files: manifest.setR.files, strictDuplicatesExcluded: manifest.setR.duplicates.length, sameCandidatesAcrossModes: manifest.setR.sameCandidatesAcrossModes.length,
      independentCandidateSets: manifest.setR.independentCandidateSets, splitDerivation: manifest.setR.splitDerivation },
    views: corpusSummary,
    liveRequests: liveLog ? { total: liveLog.requests.length, ok: liveLog.requests.filter((r) => r.status === 200).length,
      failed: liveLog.requests.filter((r) => r.status !== 200).length, stoppedReason: liveLog.stoppedReason ?? null } : null,
  },
  profiles: Object.fromEntries(["car", "motorcycle", "bicycle"].map((mode) => [mode, Object.fromEntries(PROFILES.map((id) => [id, getProfile(id, mode)]))])),
  harnessValidation: harnessSummary,
  rawLiveHeadlineCheck: rawLiveCheck,
  aggregates,
  aggregatesWithoutBudget: noBudgetAggregates,
  currentDataByMode: byMode,
  divergences,
  stability,
  breakEven,
  syntheticCrossCheck: synthetic,
  unknownCreditEffectOnGenuine: unknownCreditEffect,
  tradeOffScenarioAreas: Object.fromEntries(["milan", "roccella"].map((area) => [area,
    scenarios.filter((s) => view(s) !== "R-archived" && s.stats.paveTradeOffAlternatives > 0 && s.area === area).length])),
  runtime,
  maintenance,
  rows,
};
writeFileSync(join(HERE, "results.json"), `${JSON.stringify(results, null, 1)}\n`);
writeFileSync(join(HERE, "report.md"), renderReport(results));
const headline = (v, p) => aggregates[v][p];
console.log(JSON.stringify({
  corpus: corpusSummary,
  harness: Object.fromEntries(VIEWS.map((v) => [v, { comparable: harnessSummary[v].comparable, match: harnessSummary[v].replayMatchesRecorded }])),
  strongLive: headline("R-live", "strong").all, strongG: headline("G", "strong").all, runtime,
}, null, 1));
void ROOT;
