#!/usr/bin/env node
/**
 * Build the genuine route corpus for the Phase 4.20 ranking experiment.
 *
 * Outputs (deterministic for fixed inputs):
 *   corpus/manifest.json   inventory: SHA-256, size, provenance and role of every input file,
 *                          dedupe decisions and corpus counts
 *   corpus/scenarios.json  normalised candidate pools
 *     - set "R" (recorded): candidateDiagnostics of archived /api/routes responses, metrics as
 *       recorded by the code version of that time;
 *     - set "G" (geometry re-scored): every archived raw provider route (Valhalla bodies) plus
 *       recorded fast/safe geometries, decoded with production normalizeValhallaResponse and
 *       re-scored with the CURRENT production scorer and OSM archive; pools deduplicated and
 *       corridor equivalence computed with production route-candidates.ts.
 *
 * Usage (from the repository root): node experiments/route-ranking/build-corpus.mjs
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeValhallaResponse } from "../../lib/routing-providers.ts";
import { scoreRoadIntelligence } from "../../lib/road-intelligence-scoring.ts";
import { getSpatialRoadStore } from "../../lib/spatial-road-store.ts";
import { areaForCoordinate } from "../../lib/pilot-areas.ts";
import {
  PRODUCTION_MODE_POLICY, deduplicateRoutes, isLegalCandidate, routesShareCorridor,
} from "./lib/production-baseline.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CORPUS_DIR = join(HERE, "corpus");
const rel = (path) => relative(ROOT, path);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const COSTING_TO_MODE = { auto: "car", motorcycle: "motorcycle", bicycle: "bicycle" };
const MODES = ["car", "motorcycle", "bicycle"];

// ---------------------------------------------------------------------------------------------
// 1. Inventory
// ---------------------------------------------------------------------------------------------
const SOURCES = [
  { dir: "tests/e2e/fixtures", match: /\.json$/, kind: "api-response",
    provenance: "E2E UI fixtures: recorded /api/routes responses (committed 2026-11-02, 19d211a). Capture date and code version not recorded in-file." },
  { dir: "outputs/phase32-benchmark", match: /^before-.*-(car|motorcycle|bicycle)\.json$/, kind: "api-response",
    provenance: "Phase 3.2 benchmark BEFORE: Phase 3.1 handler (outputs/phase32-benchmark/baseline/) replayed on archived provider responses (2026-10-27/28). Older code: no eligibility/restriction fields, waypoint detours only." },
  { dir: "outputs/phase32-benchmark", match: /^after-.*-(car|motorcycle|bicycle)\.json$/, kind: "api-response",
    provenance: "Phase 3.2 benchmark AFTER: Phase 3.2 handler (surface-aware + Pareto) on archived provider responses (2026-10-27/28). Older surface archive (central Milan only)." },
  { dir: "outputs/phase42-validation", match: /-(car|motorcycle|bicycle)\.json$/, kind: "api-response-wrapped",
    provenance: "Phase 4.2 Roccella validation: real handler, captured provider responses 2026-10-29; wrapper with request/payload/calls." },
  { dir: "tests/fixtures", match: /^reproduced-porta-romana-route\.json$/, kind: "api-response",
    provenance: "Phase 4.12/4.13 reproduced Porta Romana -> Largo Promessi Sposi API response (committed 2026-11-04, 8b800df)." },
  { dir: "outputs/phase32-benchmark/responses", match: /\.json$/, kind: "provider-raw",
    provenance: "Phase 3.2 raw FOSSGIS Valhalla HTTP archive (request, retrievedAt, status, body, bodySha256), 2026-10-27." },
  { dir: "outputs/phase42-validation/responses", match: /\.json$/, kind: "provider-raw",
    provenance: "Phase 4.2 raw provider HTTP archive (Valhalla + failed OSRM attempts), 2026-10-29." },
  { dir: "tests/fixtures", match: /^valhalla-porta-romana-promessi-sposi\.json$/, kind: "provider-raw-trip",
    provenance: "Raw Valhalla trip for Porta Romana (committed 2026-11-04); request costing inferred from maneuver travel_type=car." },
  { dir: "outputs/phase417", match: /^results\.json$/, kind: "derived-reference",
    provenance: "Phase 4.17 results; routing section re-uses phase32-after/phase42 fast+safe only. Reference for the 2/24 count, not an independent route source." },
];

const LIVE_DIR = join(CORPUS_DIR, "live-2026-11-05");
if (existsSync(LIVE_DIR)) {
  SOURCES.push({ dir: rel(LIVE_DIR), match: /^resp-.*\.json$/, kind: "api-response-live",
    provenance: "Phase 4.20 live capture: local wrangler dev of an exact copy of the existing dist/ build (2026-11-05), coordinates only, <=1 request/10 s." });
  SOURCES.push({ dir: rel(LIVE_DIR), match: /^request-log\.json$/, kind: "live-request-log",
    provenance: "Phase 4.20 live capture request log (every attempt, including failures)." });
}

const inventory = [];
for (const source of SOURCES) {
  const dir = join(ROOT, source.dir);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((file) => source.match.test(file)).sort()) {
    const path = join(dir, name);
    const bytes = readFileSync(path);
    inventory.push({ path: rel(path), kind: source.kind, bytes: statSync(path).size, sha256: sha256(bytes), provenance: source.provenance });
  }
}
const contentGroups = new Map();
for (const item of inventory) {
  const list = contentGroups.get(item.sha256) ?? [];
  list.push(item.path);
  contentGroups.set(item.sha256, list);
}
for (const item of inventory) {
  const same = contentGroups.get(item.sha256);
  item.byteIdenticalTo = same.filter((path) => path !== item.path);
}

// ---------------------------------------------------------------------------------------------
// 2. Set R — recorded API responses
// ---------------------------------------------------------------------------------------------
const deriveSplit = (pave, weighted) => {
  // weightedPave = confirmed * 1.0 + probable * 0.65 (scripts/osm/config.mjs SURFACE_ROUGHNESS_WEIGHT)
  const probable = Math.min(pave, Math.max(0, Math.round((pave - weighted) / 0.35)));
  return { confirmed: pave - probable, probable };
};

function recordedScenario(item) {
  const raw = readJson(join(ROOT, item.path));
  const wrapped = item.kind === "api-response-wrapped" || item.kind === "api-response-live";
  const payload = wrapped ? raw.payload : raw;
  if (!payload || !Array.isArray(payload.candidateDiagnostics) || !payload.fast) return null;
  const request = wrapped ? (raw.request?.params ?? raw.request) : null;
  const mode = payload.mode;
  const fastPayload = payload.fast;
  const safePayload = payload.safe;
  const exactFor = (diag) => {
    for (const [role, route] of [["fast", fastPayload], ["safe", safePayload]]) {
      if (!route) continue;
      if (Math.round(route.minutes * 60) === diag.seconds && Math.round(route.distance * 1000) === diag.distance
        && route.paveMeters === diag.paveMeters && route.unknownSurfaceMeters === diag.unknownSurfaceMeters) {
        return { role, route };
      }
    }
    return null;
  };
  const splitChecks = [];
  const candidates = payload.candidateDiagnostics.map((diag) => {
    const exact = exactFor(diag);
    const derived = deriveSplit(diag.paveMeters, diag.weightedPaveMeters);
    let confirmed = derived.confirmed;
    let probable = derived.probable;
    let splitMethod = "derived-from-weightedPaveMeters";
    if (exact && Number.isFinite(exact.route.confirmedPaveMeters) && Number.isFinite(exact.route.probablePaveMeters)) {
      splitChecks.push({ role: exact.role, exactConfirmed: exact.route.confirmedPaveMeters, exactProbable: exact.route.probablePaveMeters,
        derivedConfirmed: derived.confirmed, derivedProbable: derived.probable });
      confirmed = exact.route.confirmedPaveMeters;
      probable = exact.route.probablePaveMeters;
      splitMethod = `exact-from-${exact.role}-payload`;
    }
    const unpavedWeighted = diag.riskMeters !== undefined ? Math.max(0, diag.riskMeters - diag.weightedPaveMeters) : 0;
    return {
      id: diag.source,
      source: diag.source,
      provider: diag.provider,
      profile: diag.profile,
      durationS: exact ? exact.route.minutes * 60 : diag.seconds,
      durationPrecision: exact ? "exact" : "rounded-1s",
      distanceM: diag.distance,
      confirmedPaveM: confirmed,
      probablePaveM: probable,
      splitMethod,
      weightedPaveM: diag.weightedPaveMeters,
      riskM: diag.riskMeters ?? diag.weightedPaveMeters,
      riskRecorded: diag.riskMeters !== undefined,
      unknownM: diag.unknownSurfaceMeters,
      smoothM: diag.smoothSurfaceMeters ?? 0,
      unpavedM: diag.unpavedSurfaceMeters ?? 0,
      unpavedWeightedM: unpavedWeighted,
      totalM: diag.surfaceTotalMeters,
      ...(diag.confirmedRestrictionMeters !== undefined ? { confirmedRestrictionM: diag.confirmedRestrictionMeters } : {}),
      ...(diag.blockingRestrictionMeters !== undefined ? { blockingRestrictionM: diag.blockingRestrictionMeters } : {}),
      restrictionEvidence: diag.confirmedRestrictionMeters !== undefined ? "recorded" : "absent-in-older-code",
      recordedEligible: diag.eligibleModeAndAccess ?? null,
      recordedParetoOptimal: diag.paretoOptimal ?? null,
      distinctFromRecordedFast: diag.distinctFromFast,
    };
  });
  const recordedFast = candidates.find((candidate) => exactFor(payload.candidateDiagnostics.find((d) => d.source === candidate.id))?.role === "fast");
  const recordedSafeExact = candidates.find((candidate) => {
    const diag = payload.candidateDiagnostics.find((d) => d.source === candidate.id);
    return safePayload && Math.round(safePayload.minutes * 60) === diag.seconds && Math.round(safePayload.distance * 1000) === diag.distance
      && safePayload.paveMeters === diag.paveMeters;
  });
  const recordedChoice = payload.hasDistinctAlternative ? recordedSafeExact?.id ?? null : recordedFast?.id ?? null;
  const fastCoordinates = fastPayload.coordinates;
  const start = request?.start ? request.start.split(",").map(Number) : fastCoordinates[0];
  const end = request?.end ? request.end.split(",").map(Number) : fastCoordinates.at(-1);
  return {
    set: "R",
    id: `R:${item.path.replace(/^.*\//, "").replace(/\.json$/, "")}:${item.path.split("/").slice(-2, -1)[0]}`,
    file: item.path,
    fileSha256: item.sha256,
    area: payload.area ?? areaForCoordinate(fastCoordinates[0])?.id ?? null,
    mode,
    calculationMode: payload.calculationMode,
    requested: {
      avoidance: payload.appliedPreferences?.avoidance ?? null,
      maxExtraMinutes: payload.appliedPreferences?.maximumExtraMinutes ?? null,
      coordinatesSource: request?.start ? "request" : "fast-route-endpoints",
      start, end,
    },
    codeEra: item.path.includes("before-") ? "phase3.1" : item.path.includes("after-") ? "phase3.2"
      : item.path.includes("phase42") ? "phase4.2" : item.path.includes("live-") ? "dist-2026-11-05" : "fixture-unknown-version",
    recorded: {
      fastId: recordedFast?.id ?? null,
      choiceId: recordedChoice,
      hasDistinctAlternative: payload.hasDistinctAlternative,
      strategy: payload.optimization?.strategy ?? null,
      alternativesAnalyzed: payload.alternativesAnalyzed,
    },
    equivalence: { method: "recorded distinctFromFast flag (relative to recorded fast only)" },
    splitChecks,
    candidates,
  };
}

const recordedScenarios = inventory
  .filter((item) => ["api-response", "api-response-wrapped", "api-response-live"].includes(item.kind))
  .map(recordedScenario)
  .filter(Boolean);

// Dedupe Set R by candidate content (ignoring provider profile labels and code era tags).
const metricKey = (scenario, includeProfile) => JSON.stringify([
  scenario.mode, scenario.requested.avoidance, scenario.requested.maxExtraMinutes,
  scenario.candidates.map((c) => [includeProfile ? c.profile : "", c.durationS, c.distanceM, c.confirmedPaveM, c.probablePaveM, c.unknownM, c.smoothM])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
]);
const seenStrict = new Map();
const seenLoose = new Map();
for (const scenario of recordedScenarios) {
  const loose = JSON.stringify(scenario.candidates.map((c) => [c.durationS, c.distanceM, c.confirmedPaveM, c.probablePaveM, c.unknownM, c.smoothM])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const strict = metricKey(scenario, true);
  if (seenStrict.has(strict)) {
    scenario.duplicateOf = seenStrict.get(strict);
    scenario.duplicateReason = "same mode, preferences and candidate metrics (e.g. navigation replay of the same provider responses): excluded";
  } else if (seenLoose.has(loose)) {
    scenario.sameCandidatesAs = seenLoose.get(loose);
    scenario.sameCandidatesReason = "candidate metrics identical to another mode's file (Valhalla auto and motorcycle costing often coincide on urban streets; "
      + "the e2e motorcycle fixture cannot be told apart from a copy). Kept: the mode policy differs; not counted as an independent candidate set.";
  }
  if (!seenStrict.has(strict)) seenStrict.set(strict, scenario.id);
  if (!seenLoose.has(loose)) seenLoose.set(loose, scenario.id);
}

// ---------------------------------------------------------------------------------------------
// 3. Set G — raw provider geometries re-scored with the CURRENT production scorer and archive
// ---------------------------------------------------------------------------------------------
const rawRoutes = []; // { groupKey, area, mode, route, origin }
const rawLog = [];
const keyFor = (mode, start, end) => `${mode}|${start.map((v) => v.toFixed(5)).join(",")}|${end.map((v) => v.toFixed(5)).join(",")}`;
for (const item of inventory.filter((entry) => entry.kind === "provider-raw")) {
  const record = readJson(join(ROOT, item.path));
  let body = null;
  try { body = record.request?.body ? JSON.parse(record.request.body) : null; } catch { body = null; }
  const responseText = typeof record.body === "string" ? record.body : null;
  if (!body || record.status !== 200 || !responseText) {
    rawLog.push({ path: item.path, used: false, reason: record.error ? `provider error: ${record.error}` : `status ${record.status ?? "n/a"} or non-Valhalla request` });
    continue;
  }
  if (record.bodySha256 && sha256(responseText) !== record.bodySha256) {
    rawLog.push({ path: item.path, used: false, reason: "bodySha256 mismatch" });
    continue;
  }
  const mode = COSTING_TO_MODE[body.costing];
  const locations = body.locations.map((location) => [location.lon, location.lat]);
  const start = locations[0];
  const end = locations.at(-1);
  const routes = normalizeValhallaResponse(JSON.parse(responseText), mode);
  const kind = body.linear_cost_factors ? "surface-aware" : locations.length > 2 ? "waypoint-detour" : "base";
  routes.forEach((route, index) => rawRoutes.push({
    groupKey: keyFor(mode, start, end), area: areaForCoordinate(start)?.id, mode, start, end, route,
    origin: { path: item.path, retrievedAt: record.retrievedAt, requestKind: kind, index },
  }));
  rawLog.push({ path: item.path, used: true, mode, requestKind: kind, routes: routes.length, retrievedAt: record.retrievedAt });
}
{
  const item = inventory.find((entry) => entry.kind === "provider-raw-trip");
  if (item) {
    const trip = readJson(join(ROOT, item.path)).trip;
    const mode = trip.legs[0].maneuvers[0].travel_type === "car" ? "car" : null;
    if (mode) {
      const start = [trip.locations[0].lon, trip.locations[0].lat];
      const end = [trip.locations.at(-1).lon, trip.locations.at(-1).lat];
      normalizeValhallaResponse({ trip }, mode).forEach((route, index) => rawRoutes.push({
        groupKey: keyFor(mode, start, end), area: areaForCoordinate(start)?.id, mode, start, end, route,
        origin: { path: item.path, retrievedAt: null, requestKind: "base", index },
      }));
      rawLog.push({ path: item.path, used: true, mode, requestKind: "base", routes: 1, retrievedAt: null });
    }
  }
}
// Recorded fast/safe geometries of API responses (the only geometry for fixtures without raw bodies).
const distanceM = (a, b) => Math.hypot((a[0] - b[0]) * 111_320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110_540);
const groupEndpoints = new Map();
for (const entry of rawRoutes) groupEndpoints.set(entry.groupKey, { mode: entry.mode, start: entry.start, end: entry.end });
for (const scenario of recordedScenarios) {
  // Live responses are already scored by the current code and archive (set R-live); adding their
  // two geometries here would double count them as thin pools.
  if (scenario.codeEra === "dist-2026-11-05") continue;
  const payload = (() => {
    const raw = readJson(join(ROOT, scenario.file));
    return raw.payload ?? raw;
  })();
  const provider = payload.routingProfile?.provider;
  const profile = payload.routingProfile?.profile;
  if (!provider || provider === "mixed") continue;
  const fastCoords = payload.fast.coordinates;
  let groupKey = null;
  for (const [key, group] of groupEndpoints) {
    if (group.mode === scenario.mode && distanceM(group.start, fastCoords[0]) <= 80 && distanceM(group.end, fastCoords.at(-1)) <= 80) groupKey = key;
  }
  groupKey ??= keyFor(scenario.mode, fastCoords[0], fastCoords.at(-1));
  if (!groupEndpoints.has(groupKey)) groupEndpoints.set(groupKey, { mode: scenario.mode, start: fastCoords[0], end: fastCoords.at(-1) });
  const roles = [["fast", payload.fast], ...(payload.hasDistinctAlternative ? [["safe", payload.safe]] : [])];
  for (const [role, routePayload] of roles) {
    rawRoutes.push({
      groupKey, area: payload.area ?? areaForCoordinate(fastCoords[0])?.id, mode: scenario.mode,
      start: groupEndpoints.get(groupKey).start, end: groupEndpoints.get(groupKey).end,
      route: { coordinates: routePayload.coordinates, distance: routePayload.distance * 1000, duration: routePayload.minutes * 60,
        instructions: [], provider, profile },
      origin: { path: scenario.file, retrievedAt: null, requestKind: `recorded-${role}-geometry`, index: 0 },
    });
  }
}

const geometryHash = (coordinates) => sha256(JSON.stringify(coordinates));
const groups = new Map();
for (const entry of rawRoutes) {
  const list = groups.get(entry.groupKey) ?? [];
  list.push(entry);
  groups.set(entry.groupKey, list);
}

const geometryScenarios = [];
for (const [groupKey, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const { mode, area, start, end } = entries[0];
  const policy = PRODUCTION_MODE_POLICY[mode];
  const store = await getSpatialRoadStore(area);
  const allCoords = entries.flatMap((entry) => entry.route.coordinates);
  const tileKeys = store.getTileKeysForCoordinates(allCoords, 50);
  await store.preloadTiles(tileKeys);
  const scoped = store.getScopedIntelligence(allCoords, 50);
  // Exact-geometry duplicates (same route archived by several sources) collapse first, keeping provenance.
  const byGeometry = new Map();
  for (const entry of entries) {
    const hash = geometryHash(entry.route.coordinates);
    const existing = byGeometry.get(hash);
    if (existing) existing.origins.push(entry.origin);
    else byGeometry.set(hash, { hash, route: entry.route, origins: [entry.origin] });
  }
  const scored = [...byGeometry.values()].map((item) => {
    const s = scoreRoadIntelligence(item.route.coordinates, scoped.surfaceIndex, policy.surfaceMatchMeters, mode);
    return {
      route: item.route,
      hash: item.hash,
      origins: item.origins,
      source: item.origins[0].requestKind,
      paveMeters: s.paveMeters,
      riskMeters: s.weightedPaveMeters + s.weightedUnpavedMeters,
      surfaceScore: s,
    };
  });
  const legal = scored.filter((candidate) => isLegalCandidate(candidate, mode));
  const pool = deduplicateRoutes(legal, policy);
  const ids = new Map(pool.map((candidate, index) => [candidate, `g${index + 1}-${candidate.hash.slice(0, 8)}`]));
  const candidates = pool.map((candidate) => {
    const s = candidate.surfaceScore;
    return {
      id: ids.get(candidate),
      source: candidate.source,
      provider: candidate.route.provider,
      profile: candidate.route.profile,
      durationS: candidate.route.duration,
      durationPrecision: "exact",
      distanceM: candidate.route.distance,
      confirmedPaveM: s.confirmedMeters,
      probablePaveM: s.probableMeters,
      splitMethod: "exact-rescored",
      weightedPaveM: s.weightedPaveMeters,
      riskM: candidate.riskMeters,
      unknownM: s.unknownMeters,
      smoothM: s.smoothMeters,
      unpavedM: s.unpavedMeters,
      unpavedWeightedM: s.weightedUnpavedMeters,
      totalM: s.totalMeters,
      confirmedRestrictionM: s.confirmedRestrictionMeters,
      blockingRestrictionM: s.blockingRestrictionMeters,
      terminalPrivateAccessM: s.terminalPrivateAccessMeters,
      matchedFeatures: s.matchedFeatures,
      geometrySha256: candidate.hash,
      geometryPoints: candidate.route.coordinates.length,
      origins: candidate.origins,
    };
  });
  const equivalentPairs = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      if (routesShareCorridor(pool[i].route, pool[j].route, policy.equivalentAverageMeters)) {
        equivalentPairs.push([ids.get(pool[i]), ids.get(pool[j])]);
      }
    }
  }
  geometryScenarios.push({
    set: "G",
    id: `G:${area}:${groupKey}`,
    area,
    mode,
    requested: { start, end, coordinatesSource: entries.some((e) => !e.origin.requestKind.startsWith("recorded")) ? "provider-request" : "fast-route-endpoints" },
    sources: [...new Set(entries.map((entry) => entry.origin.path))].sort(),
    archivedRoutes: entries.length,
    uniqueGeometries: scored.length,
    illegalDropped: scored.length - legal.length,
    deduplicatedAway: legal.length - pool.length,
    equivalence: { method: "routesShareCorridor(a, b, MODE_POLICY.equivalentAverageMeters) on decoded geometry", pairs: equivalentPairs },
    candidates,
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Counts
// ---------------------------------------------------------------------------------------------
const MIN_REDUCTION = { car: 20, motorcycle: 15, bicycle: 12 };
function scenarioStats(scenario) {
  const legal = scenario.candidates.filter((c) => {
    const restricted = c.blockingRestrictionM ?? c.confirmedRestrictionM ?? 0;
    const okProfile = scenario.mode === "car"
      ? (c.provider === "valhalla-fossgis" && c.profile === "auto") || (c.provider === "osrm-public-fallback" && c.profile === "driving")
      : c.provider === "valhalla-fossgis" && c.profile === scenario.mode;
    return okProfile && restricted === 0;
  });
  const fastest = [...legal].sort((a, b) => a.durationS - b.durationS)[0];
  const pairs = scenario.equivalence.pairs;
  const equivalentToFast = (c) => {
    if (!fastest || c === fastest) return true;
    if (scenario.set === "R") return scenario.recorded.fastId === fastest.id ? c.distinctFromRecordedFast === false : false;
    return pairs.some(([a, b]) => (a === c.id && b === fastest.id) || (b === c.id && a === fastest.id));
  };
  const distinct = legal.filter((c) => !equivalentToFast(c));
  const known = (c) => c.confirmedPaveM + c.probablePaveM;
  const tradeOff = fastest ? distinct.filter((c) => known(fastest) - known(c) >= MIN_REDUCTION[scenario.mode]) : [];
  return {
    candidates: scenario.candidates.length,
    legal: legal.length,
    distinctLegalAlternatives: distinct.length,
    paveTradeOffAlternatives: tradeOff.length,
    fastestKnownPaveM: fastest ? known(fastest) : null,
  };
}
for (const scenario of [...recordedScenarios, ...geometryScenarios]) scenario.stats = scenarioStats(scenario);

const primaryR = recordedScenarios.filter((s) => !s.duplicateOf);
const count = (list) => ({
  scenarios: list.length,
  withDistinctAlternative: list.filter((s) => s.stats.distinctLegalAlternatives > 0).length,
  withPaveTradeOff: list.filter((s) => s.stats.paveTradeOffAlternatives > 0).length,
  byMode: Object.fromEntries(MODES.map((mode) => [mode, list.filter((s) => s.mode === mode).length])),
  byArea: Object.fromEntries(["milan", "roccella"].map((area) => [area, list.filter((s) => s.area === area).length])),
  candidates: list.reduce((sum, s) => sum + s.candidates.length, 0),
});
const splitErrors = recordedScenarios.flatMap((s) => s.splitChecks)
  .map((check) => Math.max(Math.abs(check.exactConfirmed - check.derivedConfirmed), Math.abs(check.exactProbable - check.derivedProbable)));

const manifest = {
  schema: "lastrico-phase420-route-ranking-corpus/1",
  note: "Generated by experiments/route-ranking/build-corpus.mjs. Inputs are read-only; hashes are of the bytes on disk.",
  currentCode: {
    selector: { path: "lib/route-optimization.ts", sha256: sha256(readFileSync(join(ROOT, "lib/route-optimization.ts"))) },
    routeHandler: { path: "app/api/routes/route.ts", sha256: sha256(readFileSync(join(ROOT, "app/api/routes/route.ts"))) },
    scorer: { path: "lib/road-intelligence-scoring.ts", sha256: sha256(readFileSync(join(ROOT, "lib/road-intelligence-scoring.ts"))) },
    candidates: { path: "lib/route-candidates.ts", sha256: sha256(readFileSync(join(ROOT, "lib/route-candidates.ts"))) },
    milanTilesMetadata: { path: "data/surfaces/milan-tiles/metadata.json", sha256: sha256(readFileSync(join(ROOT, "data/surfaces/milan-tiles/metadata.json"))) },
    roccellaTilesMetadata: { path: "data/surfaces/roccella-tiles/metadata.json", sha256: sha256(readFileSync(join(ROOT, "data/surfaces/roccella-tiles/metadata.json"))) },
  },
  inventory,
  rawProviderLog: rawLog,
  setR: {
    description: "Recorded candidateDiagnostics (metrics as computed by the code of that time). Fair baseline = current selectOptimizedRoute re-run on these candidates.",
    files: recordedScenarios.length,
    duplicates: recordedScenarios.filter((s) => s.duplicateOf).map((s) => ({ id: s.id, duplicateOf: s.duplicateOf, reason: s.duplicateReason })),
    sameCandidatesAcrossModes: recordedScenarios.filter((s) => s.sameCandidatesAs).map((s) => ({ id: s.id, sameCandidatesAs: s.sameCandidatesAs })),
    independentCandidateSets: primaryR.filter((s) => !s.sameCandidatesAs).length,
    archived: count(primaryR.filter((s) => s.codeEra !== "dist-2026-11-05")),
    live: count(primaryR.filter((s) => s.codeEra === "dist-2026-11-05")),
    all: count(recordedScenarios),
    primary: count(primaryR),
    uniqueOdMode: new Set(primaryR.map((s) => `${s.mode}|${s.requested.start.map((v) => v.toFixed(3))}|${s.requested.end.map((v) => v.toFixed(3))}`)).size,
    splitDerivation: {
      method: "probable = round((paveMeters - weightedPaveMeters) / 0.35); confirmed = paveMeters - probable; exact payload values used for fast/safe",
      checkedAgainstExactPayloads: splitErrors.length,
      maxAbsErrorM: splitErrors.length ? Math.max(...splitErrors) : null,
      exactMatches: splitErrors.filter((error) => error === 0).length,
    },
  },
  setG: {
    description: "Union of archived genuine provider geometries per OD x mode, re-scored with the current scorer and archive; deduplicated with production rules.",
    all: count(geometryScenarios),
  },
  phase417Reference: "Phase 4.17 counted fast != safe among 24 recorded scenarios (2/24). This corpus counts legal alternatives distinct from the fastest corridor in candidateDiagnostics, a broader notion.",
};

mkdirSync(CORPUS_DIR, { recursive: true });
writeFileSync(join(CORPUS_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(CORPUS_DIR, "scenarios.json"), `${JSON.stringify({
  schema: "lastrico-phase420-route-ranking-scenarios/1",
  scenarios: [...recordedScenarios, ...geometryScenarios],
}, null, 1)}\n`);
console.log(JSON.stringify({ files: inventory.length, setR: manifest.setR.all, setRPrimary: manifest.setR.primary, uniqueOdMode: manifest.setR.uniqueOdMode,
  setG: manifest.setG.all, split: manifest.setR.splitDerivation }, null, 1));
