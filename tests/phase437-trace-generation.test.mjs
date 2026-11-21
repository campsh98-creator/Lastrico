import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createGpsTraceRecorder,
  GPS_TRACE_VERSION,
  MAX_TRACE_GENERATION_CANDIDATES,
  MAX_TRACE_STORAGE_BYTES,
  parseGpsTrace,
  readGpsTrace,
  replayGpsTrace,
  storedTraceBytes,
  summarizeRouteGeneration,
  SUPPORTED_TRACE_VERSIONS,
  TRACE_GENERATION_STATUSES,
  TRACE_GENERATION_VERDICTS,
  validateTraceGeneration,
} from "../lib/gps-trace.ts";
import { createNavigationFixState, distanceMeters, processGpsFix } from "../lib/navigation-fix-processor.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";

/**
 * Phase 4.37 (package P0-3): trace v3 records, per route, HOW it was produced (the anti-pavé outcome,
 * whether the penalised search ran, and the candidates it was chosen among). Built only from fields
 * the routes API already returns; counts and fixed labels, never coordinates or street names.
 */
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const lf = (text) => text.replace(/\r\n/g, "\n");
const fixturePath = fileURLToPath(new URL("tests/fixtures/gps-traces/synthetic-parallel-return.json", root));
const replayScript = fileURLToPath(new URL("scripts/replay-gps-trace.mjs", root));

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

// An invented straight street in Milan, 1 km eastwards; real traces are never committed.
const LAT = 45.465, LON = 9.18;
const metersPerLon = 111_320 * Math.cos(LAT * Math.PI / 180);
const at = (x, y = 0) => [Math.round((LON + x / metersPerLon) * 1e7) / 1e7, Math.round((LAT + y / 110_540) * 1e7) / 1e7];
const coordinates = Array.from({ length: 21 }, (_, index) => at(index * 50));
const instructions = [
  { id: "depart", type: "depart", location: at(0) },
  { id: "turn-400", type: "turn", location: at(400) },
  { id: "arrive", type: "arrive", location: at(1000) },
];
const baseRoute = {
  progressMeters: 0, minutes: 3, distanceKm: 1, coordinates, instructions,
  objective: "safe",
  pave: { confirmedMeters: 0, probableMeters: 0, unknownMeters: 200 },
  roughSections: [],
};

/** A candidate as app/api/routes/route.ts lists it in candidateDiagnostics, with every other field it carries. */
const diagnostic = (overrides = {}) => ({
  eligibleModeAndAccess: true,
  confirmedRestrictionMeters: 0,
  blockingRestrictionMeters: 0,
  terminalPrivateAccessMeters: 0,
  terminalWalkMeters: 0,
  paretoOptimal: true,
  source: "base-1",
  provider: "valhalla",
  profile: "auto",
  distance: 4521.4,
  seconds: 812.2,
  paveMeters: 130,
  pavePercent: 2.9,
  weightedPaveMeters: 140.4,
  riskMeters: 150,
  surfaceConfidence: 0.8,
  unknownSurfaceMeters: 300.6,
  confirmedPaveMeters: 120.2,
  probablePaveMeters: 10,
  selectionVerdict: "fastest",
  selectionBurden: 160,
  selectionUtility: 12,
  detourPercent: 0,
  distinctFromFast: false,
  ...overrides,
});

/** A typical planner response: three provider routes, two via-point detours, the search's output. */
function typicalResponse() {
  return {
    antiPave: {
      status: "alternative",
      standard: { source: "base-1", legal: true, seconds: 812, meters: 4521, paveMeters: 130, confirmedPaveMeters: 120 },
      avoidedVsStandardMeters: 120,
      search: { attempted: true, failed: false, generated: 2 },
    },
    candidateDiagnostics: [
      diagnostic({ source: "base-1", selectionVerdict: "fastest", uTurnCount: 0 }),
      diagnostic({ source: "base-2", distance: 4733, seconds: 861, weightedPaveMeters: 90, confirmedPaveMeters: 60, unknownSurfaceMeters: 410, selectionVerdict: "dominated", uTurnCount: 0 }),
      diagnostic({ source: "base-3", distance: 5120, seconds: 905, weightedPaveMeters: 150, confirmedPaveMeters: 120, unknownSurfaceMeters: 380, selectionVerdict: "more-known-pave", uTurnCount: 1 }),
      diagnostic({ source: "detour-1", distance: 4890, seconds: 884, weightedPaveMeters: 40, confirmedPaveMeters: 0, unknownSurfaceMeters: 520, selectionVerdict: "unknown-surface-burden", uTurnCount: 1 }),
      diagnostic({ source: "surface-aware-valhalla", distance: 4560, seconds: 826, weightedPaveMeters: 0, confirmedPaveMeters: 0, unknownSurfaceMeters: 310, selectionVerdict: "selected", uTurnCount: 0 }),
      diagnostic({ source: "surface-aware-valhalla-2", distance: 4612, seconds: 839, weightedPaveMeters: 12, confirmedPaveMeters: 0, unknownSurfaceMeters: 330, eligibleModeAndAccess: false, selectionVerdict: "illegal", uTurnCount: 0 }),
    ],
  };
}

function recordTrace({ routes = [baseRoute], id = "trace-1", steps = 12 } = {}) {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.start({ id, startedAt: "2026-11-10T09:00:00.000Z", area: "milan", mode: "car" });
  recorder.addRoute(routes[0]);
  const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);
  let state = createNavigationFixState();
  let time = Date.parse("2026-11-10T09:00:00.000Z");
  for (let step = 0; step < steps; step += 1) {
    time += 2000;
    const reading = { coordinate: at(step * 25), accuracy: 8, timestamp: time, heading: 90, speed: 12 };
    const context = { now: time, mode: "car", bounds: PILOT_AREAS.milan.bounds, route: { model, minutes: 3, distanceKm: 1 }, lastCalculationAt: 0, calculationInProgress: false };
    const decision = processGpsFix(state, reading, context);
    state = decision.state;
    recorder.recordFix(reading, context, decision);
  }
  // Later routes (a reroute, a route switch) are recorded after the drive, so replay keeps the first one.
  for (const later of routes.slice(1)) recorder.addRoute(later);
  recorder.stop();
  return { storage, trace: readGpsTrace(storage, id) };
}

const clone = (value) => structuredClone(value);

test("trace v3 is the written version, and v1, v2 and v3 are all accepted", () => {
  assert.equal(GPS_TRACE_VERSION, 3);
  assert.deepEqual([...SUPPORTED_TRACE_VERSIONS], [1, 2, 3]);
  const { trace } = recordTrace();
  assert.equal(trace.version, 3);
  for (const version of [1, 2, 3]) assert.equal(parseGpsTrace({ ...trace, version }).version, version);
  assert.throws(() => parseGpsTrace({ ...trace, version: 4 }), /Unsupported trace format/);
  assert.throws(() => parseGpsTrace({ ...trace, version: 0 }), /Unsupported trace format/);
});

test("the summary is built from fields the API already returns, with whole numbers and fixed labels", () => {
  const generation = summarizeRouteGeneration(typicalResponse());
  assert.deepEqual(Object.keys(generation), ["antiPave", "searchAttempted", "searchFailed", "searchGenerated", "candidates"]);
  assert.equal(generation.antiPave, "alternative");
  assert.equal(generation.searchAttempted, true);
  assert.equal(generation.searchFailed, false);
  assert.equal(generation.searchGenerated, 2);
  assert.equal(generation.candidates.length, 6);
  assert.deepEqual(generation.candidates[0], {
    source: "base-1", seconds: 812, meters: 4521, weightedPave: 140, confirmedPave: 120, unknown: 301,
    verdict: "fastest", legal: true, uTurns: 0,
  });
  assert.deepEqual(Object.keys(generation.candidates[0]), ["source", "seconds", "meters", "weightedPave", "confirmedPave", "unknown", "verdict", "legal", "uTurns"]);
  assert.equal(generation.candidates[4].source, "surface-aware-valhalla");
  assert.equal(generation.candidates[4].verdict, "selected");
  assert.equal(generation.candidates[5].legal, false);
  assert.equal(generation.candidates[5].verdict, "illegal");
  for (const candidate of generation.candidates) {
    for (const field of ["seconds", "meters", "weightedPave", "confirmedPave", "unknown", "uTurns"]) {
      assert.ok(Number.isInteger(candidate[field]), `${candidate.source} ${field}`);
    }
  }
  assert.equal(validateTraceGeneration(generation), null);
});

test("a response from before U-turn counts, or before the search outcome, is summarised honestly", () => {
  const noUTurns = typicalResponse();
  for (const candidate of noUTurns.candidateDiagnostics) delete candidate.uTurnCount;
  const generation = summarizeRouteGeneration(noUTurns);
  assert.ok(generation.candidates.every((candidate) => !("uTurns" in candidate)), "no count is invented");
  assert.equal(validateTraceGeneration(generation), null);

  // No antiPave.search: whether the search ran is unknown, which is not the same as "no".
  assert.equal(summarizeRouteGeneration({ antiPave: { status: "no-pave" }, candidateDiagnostics: [] }), undefined);
  assert.equal(summarizeRouteGeneration({ candidateDiagnostics: [] }), undefined);
  assert.equal(summarizeRouteGeneration(null), undefined);
  assert.equal(summarizeRouteGeneration(undefined), undefined);

  const noCandidates = summarizeRouteGeneration({ antiPave: { status: "no-pave", search: { attempted: false, failed: false, generated: 0 } } });
  assert.deepEqual(noCandidates, { antiPave: "no-pave", searchAttempted: false, searchFailed: false, searchGenerated: 0, candidates: [] });
});

test("names, coordinates and free text in a response never reach the summary", () => {
  const response = typicalResponse();
  response.antiPave.status = "Via Privata 12, Milano";
  response.antiPave.standard.name = "Via Privata";
  response.candidateDiagnostics[0].source = "Via Privata 12";
  response.candidateDiagnostics[0].name = "Via Privata";
  response.candidateDiagnostics[0].coordinates = [[9.1812345, 45.4651234]];
  response.candidateDiagnostics[0].selectionVerdict = "Via Privata: troppo pavé";
  response.candidateDiagnostics[1].geometry = "9.1812345,45.4651234";
  const generation = summarizeRouteGeneration(response);
  const text = JSON.stringify(generation);
  for (const leaked of ["Privata", "Milano", "9.18", "45.46", "troppo"]) assert.ok(!text.includes(leaked), leaked);
  assert.equal(generation.antiPave, "other");
  assert.equal(generation.candidates[0].source, "other");
  assert.equal(generation.candidates[0].verdict, "other");
  assert.equal(validateTraceGeneration(generation), null);
});

test("with more than eight candidates the chosen, fastest and searched ones are kept, in the original order", () => {
  const response = typicalResponse();
  response.candidateDiagnostics = [
    ...Array.from({ length: 7 }, (_, index) => diagnostic({ source: `detour-${index + 1}`, selectionVerdict: "dominated" })),
    diagnostic({ source: "base-1", selectionVerdict: "fastest" }),
    diagnostic({ source: "base-2", selectionVerdict: "dominated" }),
    diagnostic({ source: "surface-aware-valhalla", selectionVerdict: "selected" }),
    diagnostic({ source: "surface-aware-valhalla-2", selectionVerdict: "a-better-alternative-was-chosen" }),
  ];
  const generation = summarizeRouteGeneration(response);
  assert.equal(MAX_TRACE_GENERATION_CANDIDATES, 8);
  assert.equal(generation.candidates.length, 8);
  assert.equal(generation.omitted, 3);
  const sources = generation.candidates.map((candidate) => candidate.source);
  for (const kept of ["base-1", "surface-aware-valhalla", "surface-aware-valhalla-2"]) assert.ok(sources.includes(kept), kept);
  const order = response.candidateDiagnostics.map((candidate) => candidate.source);
  assert.deepEqual(sources, order.filter((source) => sources.includes(source)), "original order");
  assert.equal(validateTraceGeneration(generation), null);

  // A candidate without complete numbers is left out and counted, never recorded as zero.
  const incomplete = typicalResponse();
  delete incomplete.candidateDiagnostics[2].unknownSurfaceMeters;
  const partial = summarizeRouteGeneration(incomplete);
  assert.equal(partial.candidates.length, 5);
  assert.equal(partial.omitted, 1);
  assert.ok(!partial.candidates.some((candidate) => candidate.source === "base-3"));
});

test("a missing verdict is recorded as none", () => {
  const response = typicalResponse();
  response.candidateDiagnostics[1].selectionVerdict = null;
  assert.equal(summarizeRouteGeneration(response).candidates[1].verdict, "none");
});

test("v3 round trip: the initial plan, a reroute and a route switch each keep their generation", () => {
  const plan = summarizeRouteGeneration(typicalResponse());
  const noPave = summarizeRouteGeneration({
    antiPave: { status: "no-pave", search: { attempted: true, failed: false, generated: 1 } },
    candidateDiagnostics: [diagnostic({ source: "base-1", weightedPaveMeters: 0, confirmedPaveMeters: 0, unknownSurfaceMeters: 90, uTurnCount: 0 })],
  });
  const { trace } = recordTrace({
    routes: [{ ...baseRoute, generation: plan }, { ...baseRoute, objective: "fast", generation: noPave }, { ...baseRoute, objective: "safe", generation: noPave }],
  });
  assert.equal(trace.version, 3);
  assert.deepEqual(trace.routes.map((route) => route.generation), [plan, noPave, noPave]);
  assert.deepEqual(parseGpsTrace(JSON.stringify(trace)), trace);
  assert.equal(replayGpsTrace(parseGpsTrace(JSON.stringify(trace))).differences.length, 0);
  // A route recorded without a summary (older server, stored plan) simply has none.
  const { trace: without } = recordTrace({ routes: [baseRoute] });
  assert.ok(!("generation" in without.routes[0]));
});

test("the recorder never writes a summary that parseGpsTrace would refuse", () => {
  const poisoned = { ...summarizeRouteGeneration(typicalResponse()), street: "Via Privata 12" };
  const { trace } = recordTrace({ routes: [baseRoute, { ...baseRoute, generation: poisoned }] });
  assert.equal(trace.routes.length, 2);
  assert.ok(!("generation" in trace.routes[1]), "the poisoned summary was dropped, the route kept");
  assert.equal(parseGpsTrace(JSON.stringify(trace)).routes.length, 2);
});

test("parseGpsTrace validates the generation strictly", () => {
  const valid = summarizeRouteGeneration(typicalResponse());
  const { trace } = recordTrace({ routes: [{ ...baseRoute, generation: valid }] });
  const refuse = (edit, pattern) => {
    const copy = clone(trace);
    edit(copy.routes[0].generation, copy);
    assert.throws(() => parseGpsTrace(copy), pattern);
  };
  const generation = /Malformed route 0: generation /;

  // Unknown keys, at either level: names, coordinates, anything not written by Lastrico.
  refuse((g) => { g.street = "Via Roma"; }, /Malformed route 0: generation has unexpected keys: street/);
  refuse((g) => { g.coordinates = [[9.18, 45.465]]; }, /unexpected keys: coordinates/);
  refuse((g) => { g.candidates[0].name = "Via Roma"; }, /candidate 0 has unexpected keys: name/);
  refuse((g) => { g.candidates[2].coordinates = [[9.18, 45.465]]; }, /candidate 2 has unexpected keys: coordinates/);
  refuse((g) => { g.candidates[0].latitude = 45.465; }, /unexpected keys: latitude/);

  // Free text, long strings, and labels outside the closed sets.
  refuse((g) => { g.antiPave = "Via Roma"; }, /unknown antiPave status/);
  refuse((g) => { g.antiPave = "x".repeat(41); }, /unknown antiPave status/);
  refuse((g) => { g.candidates[0].source = "Via Roma 12"; }, /candidate 0 has an unknown source/);
  refuse((g) => { g.candidates[0].source = "base-1".padEnd(200, "x"); }, /unknown source/);
  refuse((g) => { g.candidates[0].source = "base-1 Via Roma"; }, /unknown source/);
  refuse((g) => { g.candidates[0].verdict = "troppo pavé qui"; }, /unknown verdict/);
  refuse((g) => { g.candidates[0].verdict = "x".repeat(300); }, /unknown verdict/);
  refuse((g) => { g.candidates[0].verdict = 4; }, /unknown verdict/);

  // Numbers: whole, finite, bounded.
  for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e12, "812", null]) {
    refuse((g) => { g.candidates[1].seconds = bad; }, /candidate 1 has an invalid seconds/);
  }
  refuse((g) => { g.candidates[0].meters = 12.5; }, /invalid meters/);
  refuse((g) => { g.candidates[0].weightedPave = -3; }, /invalid weightedPave/);
  refuse((g) => { g.candidates[0].confirmedPave = "7"; }, /invalid confirmedPave/);
  refuse((g) => { delete g.candidates[0].unknown; }, /invalid unknown/);
  refuse((g) => { g.candidates[0].uTurns = 0.5; }, /invalid uTurns/);
  refuse((g) => { g.candidates[0].uTurns = -1; }, /invalid uTurns/);
  refuse((g) => { g.candidates[0].uTurns = 5000; }, /invalid uTurns/);
  refuse((g) => { g.searchGenerated = 2.5; }, /invalid searchGenerated/);
  refuse((g) => { g.omitted = -1; }, /invalid omitted/);

  // Types and sizes.
  refuse((g) => { g.candidates[0].legal = "yes"; }, /boolean legal/);
  refuse((g) => { g.searchAttempted = 1; }, /boolean search flags/);
  refuse((g) => { g.searchFailed = "false"; }, /boolean search flags/);
  refuse((g) => { g.candidates = {}; }, /invalid candidate list/);
  refuse((g) => { g.candidates = Array.from({ length: 9 }, () => clone(g.candidates[0])); }, /invalid candidate list/);
  refuse((g) => { g.candidates[3] = "Via Roma"; }, /candidate 3 must be an object/);
  refuse((g) => { g.candidates[3] = null; }, /candidate 3 must be an object/);
  for (const bad of [null, "Via Roma", [], 5, true]) {
    refuse((_, copy) => { copy.routes[0].generation = bad; }, /generation must be an object/);
  }

  // The summary is checked whatever version the file claims, and the top-level whitelist still holds.
  refuse((g, copy) => { copy.version = 2; g.candidates[0].name = "Via Roma"; }, generation);
  refuse((g, copy) => { copy.email = "someone@example.com"; }, /Unexpected trace fields: email/);

  // The error names the problem, never the value it refused.
  const secret = clone(trace);
  secret.routes[0].generation.candidates[0].source = "Via Privata 12";
  assert.throws(() => parseGpsTrace(secret), (error) => !/Privata/.test(error.message));

  assert.deepEqual(parseGpsTrace(clone(trace)), trace, "the valid trace is untouched");
});

test("every label the API can produce is in the closed sets", async () => {
  // The verdicts come from lib/route-optimization.ts and the statuses from lib/route-tradeoff.ts.
  const optimization = lf(await read("lib/route-optimization.ts"));
  const verdictType = optimization.match(/export type SelectionVerdict =([^;]+);/)[1];
  const verdicts = [...verdictType.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(verdicts.length >= 13);
  for (const verdict of verdicts) assert.ok(TRACE_GENERATION_VERDICTS.includes(verdict), `verdict ${verdict}`);
  const tradeoff = lf(await read("lib/route-tradeoff.ts"));
  const statusType = tradeoff.match(/export type AntiPaveOutcome = \{\n\s+status:([^;]+);/)[1];
  const statuses = [...statusType.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(statuses.length >= 8);
  for (const status of statuses) assert.ok(TRACE_GENERATION_STATUSES.includes(status), `status ${status}`);
  // And the sources the handler names are accepted.
  for (const source of ["base-1", "base-3", "detour-1", "detour-4", "surface-aware-valhalla", "surface-aware-valhalla-2", "other"]) {
    const generation = summarizeRouteGeneration({
      antiPave: { status: "alternative", search: { attempted: true, failed: false, generated: 1 } },
      candidateDiagnostics: [diagnostic({ source })],
    });
    assert.equal(generation.candidates[0].source, source);
  }
});

test("v1 and v2 traces still parse and replay with zero decision differences", async () => {
  const v1 = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(v1.version, 1);
  assert.equal(parseGpsTrace(v1).version, 1);
  assert.equal(replayGpsTrace(v1).differences.length, 0);

  const asV2 = { ...clone(v1), version: 2 };
  assert.equal(parseGpsTrace(asV2).version, 2);
  assert.equal(replayGpsTrace(asV2).differences.length, 0);

  // A recorded trace relabelled as v2, as the 4.34 app wrote it: no generation anywhere.
  const { trace } = recordTrace({ routes: [{ ...baseRoute, generation: summarizeRouteGeneration(typicalResponse()) }] });
  const v2 = clone(trace);
  v2.version = 2;
  for (const route of v2.routes) delete route.generation;
  assert.equal(parseGpsTrace(JSON.stringify(v2)).version, 2);
  assert.equal(replayGpsTrace(v2).differences.length, 0);
});

test("the generation never takes part in replay: the same decisions with or without it", () => {
  const generation = summarizeRouteGeneration(typicalResponse());
  const { trace: withGeneration } = recordTrace({ routes: [{ ...baseRoute, generation }] });
  const { trace: without } = recordTrace({ routes: [baseRoute] });
  assert.deepEqual(withGeneration.decisions, without.decisions);
  assert.deepEqual(replayGpsTrace(withGeneration), replayGpsTrace(without));
});

test("a typical generation is small next to the route it describes and the shared storage budget", () => {
  const typical = summarizeRouteGeneration(typicalResponse());
  const typicalChars = JSON.stringify(typical).length;
  const eight = summarizeRouteGeneration({
    antiPave: { status: "alternative", search: { attempted: true, failed: false, generated: 4 } },
    candidateDiagnostics: Array.from({ length: 8 }, (_, index) => diagnostic({
      source: index < 3 ? `base-${index + 1}` : index < 5 ? `detour-${index - 2}` : `surface-aware-valhalla-${index - 3}`,
      distance: 12_345 + index, seconds: 1_234 + index, weightedPaveMeters: 120 + index, confirmedPaveMeters: 100 + index,
      unknownSurfaceMeters: 1_050 + index, selectionVerdict: "a-better-alternative-was-chosen", uTurnCount: 1,
    })),
  });
  const maxChars = JSON.stringify(eight).length;
  const entryBytes = (route) => {
    const storage = memoryStorage();
    const recorder = createGpsTraceRecorder(storage);
    recorder.start({ id: "size", startedAt: "2026-11-10T09:00:00.000Z", area: "milan", mode: "car" });
    const before = storedTraceBytes(storage, "size");
    recorder.addRoute(route);
    return storedTraceBytes(storage, "size") - before;
  };
  const without = entryBytes(baseRoute);
  const withTypical = entryBytes({ ...baseRoute, generation: typical });
  const withEight = entryBytes({ ...baseRoute, generation: eight });
  console.log(`# generation size: typical 6 candidates ${typicalChars} chars = ${typicalChars * 2} B stored; 8 candidates ${maxChars} chars = ${maxChars * 2} B; route entry cost +${withTypical - without} B (typical), +${withEight - without} B (max)`);
  assert.ok(typicalChars < 1_100, `typical summary is ${typicalChars} characters`);
  assert.ok(maxChars < 1_600, `largest summary is ${maxChars} characters`);
  assert.ok(withTypical - without < 2_200, "typical: under 2.2 kB of storage per route entry");
  assert.ok(withEight - without < 3_300, "maximum: under 3.3 kB of storage per route entry");
  // Even a long, reroute-heavy drive (40 reroutes) spends a small share of the shared budget on it.
  assert.ok(40 * (withEight - without) < MAX_TRACE_STORAGE_BYTES * 0.06);
});

test("the page records the generation with the initial plan, every reroute and every route switch", async () => {
  const page = lf(await read("app/page.tsx"));
  assert.match(page, /summarizeRouteGeneration,/, "imported");
  assert.match(page, /routeGenerationRef\.current = summarizeRouteGeneration\(data\);/, "set for every response and restored plan");
  assert.match(page, /\.\.\.traceRouteDetails\(nextSelectedRoute, routeKind, routeGenerationRef\.current\)/, "route switch");
  assert.match(page, /\.\.\.traceRouteDetails\(nextSelectedRoute, objective, routeGenerationRef\.current\)/, "reroute");
  assert.match(page, /\.\.\.traceRouteDetails\(routeForJourney, journeyObjectiveRef\.current, routeGenerationRef\.current\)/, "initial plan");
  assert.equal([...page.matchAll(/\.\.\.traceRouteDetails\(/g)].length, 3, "every addRoute call carries it");
  const trace = lf(await read("lib/gps-trace.ts"));
  assert.doesNotMatch(trace, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/, "still no network code");
});

test("the replay script prints how each v3 route was produced, and nothing for older traces", async () => {
  const run = (path, ...args) => promisify(execFile)(process.execPath, [replayScript, path, ...args]);
  const directory = await mkdtemp(join(tmpdir(), "lastrico-p437-"));
  try {
    const { trace } = recordTrace({ routes: [{ ...baseRoute, generation: summarizeRouteGeneration(typicalResponse()) }] });
    const path = join(directory, "v3.json");
    await writeFile(path, JSON.stringify(trace));
    const text = (await run(path, "--text")).stdout;
    assert.match(text, /Percorso 1 \(dalla rilevazione 0\) · esito anti-pavé alternative · ricerca eseguita, 2 percorsi · 6 candidati/);
    assert.match(text, /surface-aware-valhalla · 826 s · 4560 m · pavé pesato 0 m · confermato 0 m · sconosciuto 310 m · selected · ammesso · inversioni 0/);
    assert.match(text, /0 decisioni diverse/);
    const summary = JSON.parse((await run(path)).stdout);
    assert.equal(summary.decisionDifferences, 0);

    const older = (await run(fixturePath, "--text")).stdout;
    assert.doesNotMatch(older, /Percorso 1/);
    assert.match(older, /Nessuna anomalia rilevata dalla traccia\./);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// The owner's field trace is private and never committed: its path comes from the environment.
const privateTracePath = process.env.LASTRICO_PRIVATE_TRACE;
test("the private field trace still parses and replays with zero decision differences", { skip: privateTracePath ? false : "LASTRICO_PRIVATE_TRACE is not set" }, async () => {
  const trace = parseGpsTrace(await readFile(privateTracePath, "utf8"));
  assert.ok(SUPPORTED_TRACE_VERSIONS.includes(trace.version));
  const report = replayGpsTrace(trace);
  assert.ok(report.fixes > 0);
  // Counts only: the failure message must not carry anything from the trace.
  assert.equal(report.differences.length, 0, `${report.differences.length} decision difference(s)`);
});
