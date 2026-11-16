/**
 * Phase 4.36 — forensic summary of one recorded Lastrico GPS trace (return journey, 2026-11-13).
 *
 *   node experiments/phase436-surface-intelligence/scripts/gps-trace-forensics.mjs <trace.json> [--out=<summary.json>]
 *
 * The raw trace is read from the path given and never copied. The output is an aggregate, redacted
 * summary: relative times, counts, rounded coordinates (3 decimals ≈ 80–110 m) and road names that
 * come from the public road network. Origin and destination are reduced to rounded cells.
 * Nothing is sent over the network.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseGpsTrace } from "../../../lib/gps-trace.ts";

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith("--"));
const outPath = args.find((arg) => arg.startsWith("--out="))?.slice(6);
if (!path) {
  console.error("Usage: node gps-trace-forensics.mjs <trace.json> [--out=<summary.json>]");
  process.exit(2);
}

const raw = await readFile(path);
const sha256 = createHash("sha256").update(raw).digest("hex");
const trace = parseGpsTrace(raw.toString("utf8"));

// Local equirectangular frame around Milan; error is below 0.1% over a few kilometres.
const LAT0 = 45.44;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const toXY = ([lon, lat]) => [lon * KX, lat * KY];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r3 = (value) => Math.round(value * 1000) / 1000;
const r1 = (value) => Math.round(value * 10) / 10;
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    n: sorted.length, min: r1(sorted[0]), p25: r1(quantile(sorted, 0.25)), median: r1(quantile(sorted, 0.5)),
    p75: r1(quantile(sorted, 0.75)), p90: r1(quantile(sorted, 0.9)), p95: r1(quantile(sorted, 0.95)), max: r1(sorted.at(-1)),
    mean: r1(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
};

function buildPolyline(coordinates) {
  const points = coordinates.map(toXY);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  return { points, cumulative, length: cumulative.at(-1) };
}

/** Nearest point on a polyline: lateral offset in metres and distance along it. */
function project(polyline, xy) {
  let best = { offset: Infinity, along: 0, segment: 0 };
  for (let i = 0; i < polyline.points.length - 1; i += 1) {
    const [ax, ay] = polyline.points[i];
    const [bx, by] = polyline.points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((xy[0] - ax) * dx + (xy[1] - ay) * dy) / lengthSq));
    const offset = Math.hypot(xy[0] - (ax + t * dx), xy[1] - (ay + t * dy));
    if (offset < best.offset) best = { offset, along: polyline.cumulative[i] + t * Math.sqrt(lengthSq), segment: i };
  }
  return best;
}

const fixes = trace.fixes.map(([timestamp, lon, lat, accuracy, heading, speed, receivedAt, lastCalc, calculating, cooldown], index) => ({
  index, timestamp, lon, lat, accuracy, heading, speed, receivedAt, lastCalc, calculating, cooldown,
  xy: toXY([lon, lat]), decision: trace.decisions[index],
}));
const t0 = fixes[0].timestamp;
const rel = (fix) => Math.round((fix.timestamp - t0) / 100) / 10;

// ---- 1. Schema and integrity -------------------------------------------------------------
const decisionOutcomes = {};
for (const decision of trace.decisions) decisionOutcomes[decision.outcome + (decision.reason ? `:${decision.reason}` : "")] = (decisionOutcomes[decision.outcome + (decision.reason ? `:${decision.reason}` : "")] ?? 0) + 1;
const timestampDeltas = [];
const receivedDeltas = [];
let nonMonotonic = 0;
let duplicates = 0;
for (let i = 1; i < fixes.length; i += 1) {
  const delta = fixes[i].timestamp - fixes[i - 1].timestamp;
  timestampDeltas.push(delta / 1000);
  receivedDeltas.push((fixes[i].receivedAt - fixes[i - 1].receivedAt) / 1000);
  if (delta < 0) nonMonotonic += 1;
  if (delta === 0) duplicates += 1;
}
const latencies = fixes.map((fix) => (fix.receivedAt - fix.timestamp) / 1000);
const gaps = fixes.slice(1).map((fix, i) => ({ atFix: fix.index, gapSeconds: r1((fix.timestamp - fixes[i].timestamp) / 1000) })).filter((gap) => gap.gapSeconds > 2.5);

const integrity = {
  schema: trace.schema, version: trace.version, appVersion: trace.appVersion, area: trace.area, mode: trace.mode,
  synthetic: trace.synthetic === true,
  startedAtUtc: trace.startedAt,
  fileBytes: raw.length, sha256,
  fixes: fixes.length, decisions: trace.decisions.length, routes: trace.routes.length, events: trace.events.length,
  durationSeconds: r1((fixes.at(-1).timestamp - t0) / 1000),
  decisionOutcomes,
  timestampDeltaSeconds: stats(timestampDeltas),
  nonMonotonicTimestamps: nonMonotonic,
  duplicateTimestamps: duplicates,
  gapsOver2_5s: gaps,
  deliveryLatencySeconds: stats(latencies),
};

// ---- 2. GPS quality ------------------------------------------------------------------------
const accuracies = fixes.map((fix) => fix.accuracy);
const bucket = (lo, hi) => accuracies.filter((value) => value >= lo && value < hi).length;
const speeds = fixes.map((fix) => fix.speed).filter((value) => value !== null);
const headingsNull = fixes.filter((fix) => fix.heading === null).length;
const stationary = fixes.filter((fix) => (fix.speed ?? 0) < 0.5);
const quality = {
  accuracyMeters: stats(accuracies),
  accuracyBuckets: { "<10": bucket(0, 10), "10-20": bucket(10, 20), "20-30": bucket(20, 30), "30-50": bucket(30, 50), "50-100": bucket(50, 100), ">=100": bucket(100, Infinity) },
  fixesWorseThan30m: accuracies.filter((value) => value > 30).length,
  speedMetersPerSecond: stats(speeds),
  speedKmhMax: r1(Math.max(...speeds) * 3.6),
  nullSpeed: fixes.length - speeds.length,
  nullHeading: headingsNull,
  stationaryFixes: stationary.length,
  stationarySharePercent: r1((stationary.length / fixes.length) * 100),
};

// Longest runs of poor accuracy (>30 m), by relative time.
const poorRuns = [];
let run = null;
for (const fix of fixes) {
  if (fix.accuracy > 30) {
    run ??= { fromFix: fix.index, toFix: fix.index, worst: fix.accuracy };
    run.toFix = fix.index;
    run.worst = Math.max(run.worst, fix.accuracy);
  } else if (run) {
    poorRuns.push(run);
    run = null;
  }
}
if (run) poorRuns.push(run);
quality.poorAccuracyRuns = poorRuns.filter((item) => item.toFix - item.fromFix >= 2).map((item) => ({
  fromFix: item.fromFix, toFix: item.toFix, atSeconds: rel(fixes[item.fromFix]), fixes: item.toFix - item.fromFix + 1,
  worstMeters: r1(item.worst), cell: [r3(fixes[item.fromFix].lon), r3(fixes[item.fromFix].lat)],
}));

// ---- 3. Trajectory versus planned routes --------------------------------------------------
const routes = trace.routes.map((route, index) => ({ index, ...route, line: buildPolyline(route.coordinates) }));
const routeAt = (fixIndex) => {
  let active = routes[0];
  for (const route of routes) if (route.atFix <= fixIndex) active = route;
  return active;
};
const acceptedFixes = fixes.filter((fix) => fix.decision.outcome === "accepted");
const actualLength = acceptedFixes.reduce((total, fix, i, list) => (i === 0 ? 0 : total + dist(list[i - 1].xy, fix.xy)), 0);

const perFix = fixes.map((fix) => {
  const active = routeAt(fix.index);
  const onActive = project(active.line, fix.xy);
  const onFirst = project(routes[0].line, fix.xy);
  const onLast = project(routes.at(-1).line, fix.xy);
  return { fix, activeIndex: active.index, onActive, onFirst, onLast };
});

const offsetStats = (route) => {
  const selection = perFix.filter((item) => item.activeIndex === route && item.fix.accuracy <= 30).map((item) => item.onActive.offset);
  return stats(selection);
};

// Where did the driver leave route 0, in terms of distance along it?
const rerouteFix = trace.events.find((event) => event.type === "reroute-start")?.atFix ?? null;
const firstOffRoute = trace.events.find((event) => event.type === "off-route")?.atFix ?? null;
const lastOnFirst = perFix.filter((item) => item.fix.index < (rerouteFix ?? Infinity)).filter((item) => item.onFirst.offset <= 15).at(-1);

const sections = trace.routes[0].roughSections ?? [];
/** Sub-polyline of a route between two distances along it (vertices plus interpolated ends). */
function slicePolyline(polyline, fromMeters, toMeters) {
  const points = [];
  const at = (meters) => {
    const i = Math.max(0, polyline.cumulative.findLastIndex((value) => value <= meters));
    const next = Math.min(i + 1, polyline.points.length - 1);
    const span = polyline.cumulative[next] - polyline.cumulative[i] || 1;
    const t = Math.min(1, (meters - polyline.cumulative[i]) / span);
    return [polyline.points[i][0] + t * (polyline.points[next][0] - polyline.points[i][0]), polyline.points[i][1] + t * (polyline.points[next][1] - polyline.points[i][1])];
  };
  points.push(at(fromMeters));
  polyline.cumulative.forEach((value, i) => { if (value > fromMeters && value < toMeters) points.push(polyline.points[i]); });
  points.push(at(toMeters));
  return buildPolyline(points.map(([x, y]) => [x / KX, y / KY]));
}

const roughProximity = sections.map((section) => {
  // Approach distance from every fix to the physical rough stretch, not to route 0 as a whole
  // (route 0 and route 1 share the Viale Isonzo corridor, so "near route 0" proves nothing).
  const slice = slicePolyline(routes[0].line, section.startMeters, section.endMeters);
  const approaches = fixes.map((fix) => ({ index: fix.index, offset: project(slice, fix.xy).offset }));
  const nearest = approaches.reduce((best, item) => (item.offset < best.offset ? item : best));
  return {
    name: section.name, surface: section.surface, startMeters: section.startMeters, endMeters: section.endMeters,
    confirmedMeters: section.confirmedMeters,
    nearestFixDistanceToSectionMeters: r1(nearest.offset),
    nearestFixIndex: nearest.index,
    fixesWithin30mOfSection: approaches.filter((item) => item.offset <= 30).length,
    sectionTraversedByDriver: approaches.some((item) => item.offset <= 15),
  };
});

// Route 1 follow-through.
const second = routes[1] ?? null;
const followSecond = second
  ? perFix.filter((item) => item.fix.index >= second.atFix && item.fix.accuracy <= 30)
  : [];
const lastSecond = second ? perFix.filter((item) => item.fix.index >= second.atFix).at(-1) : null;

// Lateral offset bands for route 1 after the reroute.
const offsetBands = second ? {
  "<=15 m": followSecond.filter((item) => item.onActive.offset <= 15).length,
  "15-30 m": followSecond.filter((item) => item.onActive.offset > 15 && item.onActive.offset <= 30).length,
  "30-60 m": followSecond.filter((item) => item.onActive.offset > 30 && item.onActive.offset <= 60).length,
  ">60 m": followSecond.filter((item) => item.onActive.offset > 60).length,
} : null;

// Offsets over time on route 1: any excursions?
const excursions = [];
if (second) {
  let current = null;
  for (const item of followSecond) {
    if (item.onActive.offset > 40) {
      current ??= { fromFix: item.fix.index, toFix: item.fix.index, max: item.onActive.offset };
      current.toFix = item.fix.index;
      current.max = Math.max(current.max, item.onActive.offset);
    } else if (current) {
      excursions.push(current);
      current = null;
    }
  }
  if (current) excursions.push(current);
}

const finalFix = fixes.at(-1);
const destination = routes.at(-1).coordinates.at(-1);
const trajectory = {
  acceptedFixes: acceptedFixes.length,
  trajectoryLengthKm: r3(actualLength / 1000),
  plannedRouteLengthKm: routes.map((route) => ({ route: route.index, atFix: route.atFix, plannedKm: route.distanceKm, polylineKm: r3(route.line.length / 1000), plannedMinutes: r1(route.minutes) })),
  routeOffsetWhileActiveMeters: routes.map((route) => ({ route: route.index, ...offsetStats(route.index) })),
  routeOffsetsOnRoute1Bands: offsetBands,
  routeOffsetsOnRoute1ExcursionsOver40m: excursions.map((item) => ({ ...item, max: r1(item.max), atSeconds: rel(fixes[item.fromFix]) })),
  lastFixDistanceToDestinationMeters: r1(dist(finalFix.xy, toXY(destination))),
  lastFixAlongRoute1Meters: lastSecond ? r1(lastSecond.onActive.along) : null,
  route1LengthMeters: second ? r1(second.line.length) : null,
  routeCompletionPercent: lastSecond && second ? r1((lastSecond.onActive.along / second.line.length) * 100) : null,
  arrivedFlagInDecisions: trace.decisions.some((decision) => decision.arrived === true),
  elapsedFromRerouteSeconds: second ? r1((finalFix.timestamp - fixes[Math.min(second.atFix, fixes.length - 1)].timestamp) / 1000) : null,
};

// ---- 4. Reroute explanation -----------------------------------------------------------------
const decisionWindow = (center, before, after) => fixes
  .slice(Math.max(0, center - before), Math.min(fixes.length, center + after + 1))
  .map((fix) => ({
    fix: fix.index, t: rel(fix), accuracy: r1(fix.accuracy), speedMs: fix.speed === null ? null : r1(fix.speed), heading: fix.heading === null ? null : Math.round(fix.heading),
    outcome: fix.decision.outcome === "accepted" ? undefined : fix.decision.outcome + (fix.decision.reason ? `:${fix.decision.reason}` : ""),
    progressMeters: fix.decision.progressMeters ?? null, offRouteMeters: fix.decision.offRouteMeters ?? null,
    pendingJump: fix.decision.pendingJump ? fix.decision.pendingJump : undefined,
    offRouteReadings: fix.decision.offRouteReadings, shouldRecalculate: fix.decision.shouldRecalculate || undefined,
    instruction: fix.decision.instructionId ? fix.decision.instructionId.split("-").slice(0, 2).join("-") : null,
    offsetFromRoute0: r1(project(routes[0].line, fix.xy).offset), alongRoute0: r1(project(routes[0].line, fix.xy).along),
  }));
const reroute = rerouteFix === null ? null : {
  firstOffRouteEventAtFix: firstOffRoute,
  rerouteStartFix: rerouteFix,
  rerouteStartAtSeconds: rel(fixes[rerouteFix]),
  lastFixWithin15mOfRoute0: lastOnFirst ? { fix: lastOnFirst.fix.index, atSeconds: rel(lastOnFirst.fix), alongRoute0Meters: r1(lastOnFirst.onFirst.along) } : null,
  firstInstructionAfterDepartAlongMeters: routes[0].instructions[1] ? r1(routes[0].line.cumulative[routes[0].line.points.findIndex((_, i) => dist(routes[0].line.points[i], toXY(routes[0].instructions[1].location)) < 3)] ?? NaN) : null,
  events: trace.events.map((event) => ({ ...event, atSeconds: rel(fixes[Math.min(event.atFix, fixes.length - 1)]) })),
  fixesAroundDecision: decisionWindow(rerouteFix, 4, 3),
  route0FirstTurnDistanceMeters: routes[0].instructions[0].distance,
  route1StartFixDistanceFromRoute0Meters: second ? r1(project(routes[0].line, second.line.points[0]).offset) : null,
};

// ---- 5. Surface warning analysis -----------------------------------------------------------
const warningEvents = trace.events.filter((event) => event.type.startsWith("pave-warning"));
const surface = {
  routes: trace.routes.map((route, index) => ({
    route: index, objective: route.objective, pave: route.pave, roughSections: route.roughSections,
    totalMeters: r1(routes[index].line.length),
    unknownSharePercent: r1((route.pave.unknownMeters / routes[index].line.length) * 100),
    confirmedSharePercent: r1((route.pave.confirmedMeters / routes[index].line.length) * 100),
  })),
  warningEvents,
  voiceEvents: trace.events.filter((event) => event.type === "voice-spoken").length,
  roughSectionProximity: roughProximity,
};

// ---- 6. Instruction following ---------------------------------------------------------------
// Street names within the endpoint neighbourhoods identify where the person lives or went: they are
// redacted (first manoeuvre of a route that starts at the origin, and the last two manoeuvres before arrival).
const redactedRoad = (route, index, instruction) => {
  const total = route.instructions.length;
  if (!instruction.roadName) return undefined;
  if (route.atFix === 0 && index === 0) return "[origin street]";
  if (index >= total - 3 && index < total - 1) return `[destination area street ${total - 1 - index}]`;
  return instruction.roadName;
};
const instructionPasses = routes.map((route) => ({
  route: route.index,
  instructions: route.instructions.map((instruction, index) => {
    const position = project(route.line, toXY(instruction.location));
    return { id: instruction.id.split("-").slice(0, 2).join("-"), type: instruction.type, modifier: instruction.modifier, road: redactedRoad(route, index, instruction), distance: instruction.distance, alongMeters: r1(position.along) };
  }),
}));

// ---- 7. Corridor comparison: Viale Isonzo vs Via Friuli corridor (return) -------------------
const corridorSplit = (() => {
  // Where do route 0 and route 1 geometries part and rejoin? (offset of route 1 vertices from route 0)
  if (!second) return null;
  const offsets = second.line.points.map((point, i) => ({ i, offset: project(routes[0].line, point).offset }));
  const parted = offsets.filter((item) => item.offset > 30);
  if (!parted.length) return null;
  const first = parted[0].i;
  const last = parted.at(-1).i;
  return {
    route1VertexFirstOver30mFromRoute0: first, route1VertexLastOver30mFromRoute0: last,
    route1AlongAtDivergenceMeters: r1(second.line.cumulative[first]), route1AlongAtRejoinMeters: r1(second.line.cumulative[last]),
    maxSeparationMeters: r1(Math.max(...offsets.map((item) => item.offset))),
    divergedCell: [r3(second.coordinates[first][0]), r3(second.coordinates[first][1])],
    rejoinedCell: [r3(second.coordinates[last][0]), r3(second.coordinates[last][1])],
    route1VerticesWithin30mOfRoute0AfterDivergence: offsets.slice(first).filter((item) => item.offset <= 30).length,
  };
})();

// Motion phases: when did the car first move, and how long was it stopped in total?
const firstMoving = fixes.find((fix) => (fix.speed ?? 0) > 1.5);
const stops = [];
{
  let current = null;
  for (const fix of fixes) {
    const still = (fix.speed ?? 0) < 0.5;
    if (still) { current ??= { fromFix: fix.index, toFix: fix.index }; current.toFix = fix.index; }
    else if (current) { stops.push(current); current = null; }
  }
  if (current) stops.push(current);
}
const longStops = stops.filter((stop) => fixes[stop.toFix].timestamp - fixes[stop.fromFix].timestamp >= 15000).map((stop) => ({
  fromFix: stop.fromFix, atSeconds: rel(fixes[stop.fromFix]), durationSeconds: r1((fixes[stop.toFix].timestamp - fixes[stop.fromFix].timestamp) / 1000),
  activeRoute: routeAt(stop.fromFix).index, alongActiveRouteMeters: r1(perFix[stop.fromFix].onActive.along),
}));
const motion = {
  firstFixAbove1_5ms: firstMoving ? { fix: firstMoving.index, atSeconds: rel(firstMoving) } : null,
  stopsOver15s: longStops,
  totalStoppedSeconds: r1(stops.reduce((total, stop) => total + (fixes[stop.toFix].timestamp - fixes[stop.fromFix].timestamp) / 1000, 0)),
  movingAverageKmh: r1((actualLength / Math.max(1, (fixes.at(-1).timestamp - t0) / 1000 - stops.reduce((total, stop) => total + (fixes[stop.toFix].timestamp - fixes[stop.fromFix].timestamp) / 1000, 0))) * 3.6),
  overallAverageKmh: r1((actualLength / ((fixes.at(-1).timestamp - t0) / 1000)) * 3.6),
};
for (const run of quality.poorAccuracyRuns) {
  run.activeRoute = routeAt(run.fromFix).index;
  run.alongActiveRouteMeters = r1(perFix[run.fromFix].onActive.along);
  run.meanSpeedMs = r1(fixes.slice(run.fromFix, run.toFix + 1).reduce((total, fix) => total + (fix.speed ?? 0), 0) / (run.toFix - run.fromFix + 1));
}

const report = {
  _note: "Redacted summary. Raw trace is not stored in the repository. Coordinates rounded to 3 decimals.",
  integrity, quality, motion, trajectory, reroute, surface, instructionPasses, corridorSplit,
  origin: { cell: [r3(fixes[0].lon), r3(fixes[0].lat)], redacted: true },
  destination: { cell: [r3(destination[0]), r3(destination[1])], redacted: true },
};
const text = JSON.stringify(report, null, 2);
if (outPath) await writeFile(outPath, text);
else console.log(text);
