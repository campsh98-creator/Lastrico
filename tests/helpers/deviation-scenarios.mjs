/**
 * Phase 4.31 — synthetic wrong-turn, missed-junction and parallel-street drives built on a real
 * route and, where possible, on the real OSM road leaving the junction (Lastrico's own compact
 * road tiles). They are SYNTHETIC traces for replaying the navigation logic; they are never a
 * substitute for a physical-device test.
 */
import { buildTrace, cumulativeMeters, distance, bearing, pointAlong } from "./synthetic-gps.mjs";

const EARTH = 6371000;
const rad = (x) => x * Math.PI / 180;
export function destination([lon, lat], meters, degrees) {
  const d = meters / EARTH, b = rad(degrees), p = rad(lat);
  const q = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const l = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(q));
  return [l * 180 / Math.PI, q * 180 / Math.PI];
}
export const signedTurn = (from, to) => ((to - from + 540) % 360) - 180;
const angleGap = (a, b) => Math.abs(signedTurn(a, b));

/** Route turns of at least `minAngle` degrees, measured on the geometry around each instruction. */
export function routeTurns(coordinates, instructionMeters, { minAngle = 45, before = 380, after = 330 } = {}) {
  const cumulative = cumulativeMeters(coordinates);
  const total = cumulative[cumulative.length - 1];
  const turns = [];
  for (const meters of instructionMeters) {
    if (meters < before || meters > total - after) continue;
    const inBearing = bearing(pointAlong(coordinates, cumulative, meters - 25).coordinate, pointAlong(coordinates, cumulative, meters).coordinate);
    const outBearing = bearing(pointAlong(coordinates, cumulative, meters).coordinate, pointAlong(coordinates, cumulative, meters + 25).coordinate);
    const turn = signedTurn(inBearing, outBearing);
    if (Math.abs(turn) < minAngle || Math.abs(turn) > 150) continue;
    if (turns.some((t) => Math.abs(t.meters - meters) < 150)) continue;
    turns.push({ meters, inBearing, outBearing, turn, junction: pointAlong(coordinates, cumulative, meters).coordinate });
  }
  return turns;
}

function allowedOrientations(segment, mode) {
  const access = segment.modeAccess ? segment.modeAccess[mode] : mode === "bicycle" ? segment.isBicycleAllowed : segment.isMotorAllowed;
  if (!access) return [];
  const direction = segment.modeDirections?.[mode] ?? (segment.isOneway ? "forward" : "both");
  const [a, b] = segment.coordinates;
  const out = [];
  if (direction !== "backward") out.push([a, b]);
  if (direction !== "forward") out.push([b, a]);
  return out;
}

/**
 * Walks the real road network from a junction in a wanted direction: the legal segment leaving the
 * junction closest to that bearing, then the straightest continuation at each node. Falls back to
 * a straight line (reported) when the tiles have no such road.
 */
export async function roadWalk(store, junction, wantBearing, mode, meters, avoid = []) {
  const keys = store.getTileKeysForCoordinates([junction], Math.max(450, meters + 150));
  await store.preloadTiles(keys);
  const edges = keys.flatMap((key) => store.getTileSegments(key)).flatMap((segment) => allowedOrientations(segment, mode));
  const nearAvoid = (point) => avoid.some((other) => distance(point, other) < 6);
  let best = null;
  for (const [a, b] of edges) {
    if (distance(a, junction) > 14 || distance(a, b) < 1) continue;
    const gap = angleGap(bearing(a, b), wantBearing);
    if (gap > 35 || nearAvoid(b)) continue;
    if (!best || gap < best.gap) best = { a, b, gap };
  }
  if (!best) return { points: [junction, destination(junction, meters, wantBearing)], onRoad: false };
  const points = [junction, best.a, best.b];
  let length = distance(best.a, best.b);
  let [from, to] = [best.a, best.b];
  while (length < meters) {
    const course = bearing(from, to);
    let next = null;
    for (const [a, b] of edges) {
      if (distance(a, to) > 2 || distance(b, from) < 1 || distance(a, b) < 0.5) continue;
      const gap = angleGap(bearing(a, b), course);
      if (gap > 60) continue;
      if (!next || gap < next.gap) next = { b, gap };
    }
    if (!next) break;
    points.push(next.b);
    length += distance(to, next.b);
    [from, to] = [to, next.b];
  }
  if (length < meters) points.push(destination(to, meters - length, bearing(from, to)));
  return { points, onRoad: true };
}

/** The route `fromMeters`..`toMeters` as a polyline. */
export function routeSlice(coordinates, fromMeters, toMeters, step = 10) {
  const cumulative = cumulativeMeters(coordinates);
  const out = [];
  for (let m = fromMeters; m < toMeters; m += step) out.push(pointAlong(coordinates, cumulative, m).coordinate);
  out.push(pointAlong(coordinates, cumulative, toMeters).coordinate);
  return out;
}

/** The route from `fromMeters` shifted sideways, reaching `offset` metres after `ramp` metres. */
function shiftedSlice(coordinates, fromMeters, length, offset, ramp = 40) {
  const cumulative = cumulativeMeters(coordinates);
  const out = [];
  for (let d = 0; d <= length; d += 10) {
    const { coordinate, course } = pointAlong(coordinates, cumulative, fromMeters + d);
    out.push(destination(coordinate, Math.min(1, d / ramp) * offset, course + 90));
  }
  return out;
}

const GOOD = { accuracy: 8, error: 4 };
const CANYON = { accuracy: 15, error: 9 };

/**
 * Scenario kinds. `deviates` says whether a reroute is the right answer. Each returns the driven
 * polyline and the GPS phases after the junction (before it, GPS is good).
 */
export const DEVIATION_SCENARIOS = {
  "correct-good": { deviates: false },
  "correct-canyon-multipath": { deviates: false },
  "correct-poor-at-junction": { deviates: false },
  "wrong-turn-mirrored": { deviates: true },
  "wrong-turn-mirrored-canyon": { deviates: true },
  "wrong-turn-poor-fix-after-turn": { deviates: true },
  "wrong-turn-gps-gap": { deviates: true },
  "missed-junction-straight": { deviates: true },
  "parallel-street-60m": { deviates: true },
  "parallel-street-45m": { deviates: true },
};

export async function buildDeviationDrive({ store, route, turn, mode, kind, seed, reportHeading = true }) {
  const before = 380, after = 320;
  const speed = mode === "bicycle" ? 4.5 : 8;
  const prefix = routeSlice(route, turn.meters - before, turn.meters);
  let tail;
  let onRoad = true;
  if (kind.startsWith("correct")) tail = routeSlice(route, turn.meters, turn.meters + after).slice(1);
  else if (kind.startsWith("parallel-street-")) {
    const offset = Number(kind.match(/(\d+)m$/)[1]);
    tail = shiftedSlice(route, turn.meters, after, turn.turn > 0 ? -offset : offset).slice(1);
  }
  else {
    const want = kind === "missed-junction-straight" ? turn.inBearing : (turn.inBearing - turn.turn + 360) % 360;
    const walk = await roadWalk(store, turn.junction, want, mode, after, routeSlice(route, turn.meters + 8, turn.meters + 60, 4));
    tail = walk.points.slice(1);
    onRoad = walk.onRoad;
  }
  const path = [...prefix, ...tail];
  const preSeconds = Math.round(before / speed);
  const postSeconds = Math.round(after / speed);
  const heading = { reportHeading, reportSpeed: reportHeading };
  const pre = { seconds: preSeconds, speed, ...GOOD, ...heading };
  let post;
  switch (kind) {
    case "correct-canyon-multipath":
    case "wrong-turn-mirrored-canyon": {
      // Multipath bursts: five fixes 35 m to one side while claiming ±15 m.
      post = [];
      for (let t = 0; t < postSeconds; t += 12) {
        post.push({ seconds: Math.min(7, postSeconds - t), speed, ...CANYON, ...heading });
        if (t + 7 < postSeconds) post.push({ seconds: Math.min(5, postSeconds - t - 7), speed, ...CANYON, lateralBias: (t / 12) % 2 ? -35 : 35, ...heading });
      }
      break;
    }
    case "correct-poor-at-junction":
      post = [{ seconds: 10, speed, accuracy: 45, error: 22, ...heading }, { seconds: postSeconds - 10, speed, ...GOOD, ...heading }];
      break;
    case "wrong-turn-poor-fix-after-turn":
      post = [{ seconds: 8, speed, accuracy: 55, error: 22, ...heading }, { seconds: postSeconds - 8, speed, ...GOOD, ...heading }];
      break;
    case "wrong-turn-gps-gap":
      post = [{ seconds: 3, speed, ...GOOD, ...heading }, { seconds: 10, speed, ...GOOD, gap: true }, { seconds: postSeconds - 13, speed, ...GOOD, ...heading }];
      break;
    default:
      post = [{ seconds: postSeconds, speed, ...GOOD, ...heading }];
  }
  if (kind === "correct-poor-at-junction") {
    // The poor stretch starts 4 s before the junction.
    pre.seconds -= 4;
    post = [{ seconds: 4, speed, accuracy: 45, error: 22, ...heading }, ...post];
  }
  const trace = buildTrace({ coordinates: path, seed, phases: [pre, ...post] });
  return { path, trace, junctionTime: preSeconds, junctionPathMeters: before, onRoad, speed };
}

/**
 * Replays a drive through a navigation processor module. The reroute cooldown and the
 * in-progress lock behave as in the app: a request is "sent" at a reroute and lasts `requestMs`.
 */
export function replayDrive(processor, buildModel, route, instructions, drive, mode, { requestMs = 2_500 } = {}) {
  const model = buildModel(route, instructions, processor.distanceMeters);
  const bounds = { west: 9, east: 9.4, south: 45.3, north: 45.6 };
  let state = processor.createNavigationFixState();
  const first = drive.trace.samples[0]?.receivedAt ?? 0;
  let lastCalculationAt = first - 600_000;
  let inProgressUntil = 0;
  const reroutes = [];
  for (const sample of drive.trace.samples) {
    const decision = processor.processGpsFix(state, sample.fix, {
      now: sample.receivedAt,
      mode,
      bounds,
      route: { model, minutes: model.totalMeters / 400, distanceKm: model.totalMeters / 1000 },
      lastCalculationAt,
      calculationInProgress: sample.receivedAt < inProgressUntil,
    });
    state = decision.state;
    if (decision.outcome === "accepted" && decision.shouldRecalculate) {
      reroutes.push({ seconds: (sample.fix.timestamp - drive.trace.samples[0].fix.timestamp) / 1000 + 1, truthMeters: sample.truthMeters });
      lastCalculationAt = sample.receivedAt;
      inProgressUntil = sample.receivedAt + requestMs;
    }
  }
  return reroutes;
}
