/**
 * Phase 4.29 — smooth vehicle-marker motion between GPS updates, free of browser APIs.
 *
 * iOS delivers about one fix per second. Teleporting the marker on each fix was the visible jump.
 * A motion plan moves the marker from where it is drawn now to the new target over the interval
 * the fixes actually arrive at, along the route when the target is on it, so the arrow follows
 * the road through bends. It never goes beyond the target (no extrapolation when GPS stops), and a
 * relocation or a very large step is shown at once rather than slid across the map.
 */
export type MotionCoordinate = [number, number];

export type MarkerMotionPlan = {
  path: MotionCoordinate[];
  /** Cumulative metres along `path`, same length as `path`. */
  cumulative: number[];
  fromHeading: number;
  toHeading: number;
  startedAt: number;
  durationMs: number;
};

export const MOTION_LIMITS = {
  minDurationMs: 250,
  maxDurationMs: 1_200,
  /** Above this the step is not plausible movement between two fixes: show it at once. */
  teleportMeters: 90,
};

const EARTH = 6_371_000;
const toRadians = (value: number) => value * Math.PI / 180;

export function motionDistance(a: MotionCoordinate, b: MotionCoordinate) {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/** Shortest signed turn from `from` to `to`, in degrees (−180, 180]. */
export function headingDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Plans the next motion. `routeSlice` is the route geometry between the drawn position's progress
 * and the target's progress, when both are on the route; otherwise the motion is a straight line.
 */
export function planMarkerMotion(input: {
  from: MotionCoordinate | null;
  fromHeading: number;
  to: MotionCoordinate;
  toHeading: number;
  now: number;
  /** Time since the previous target arrived: the pace at which fixes really come. */
  intervalMs: number | null;
  routeSlice?: MotionCoordinate[] | null;
  reducedMotion?: boolean;
}): MarkerMotionPlan {
  const straight = input.from ? [input.from, input.to] : [input.to];
  const usable = input.routeSlice && input.routeSlice.length >= 2 && input.from
    && motionDistance(input.routeSlice[0], input.from) < 6
    && motionDistance(input.routeSlice[input.routeSlice.length - 1], input.to) < 6
    ? input.routeSlice
    : straight;
  const cumulative = [0];
  for (let index = 1; index < usable.length; index += 1) cumulative.push(cumulative[index - 1] + motionDistance(usable[index - 1], usable[index]));
  const length = cumulative[cumulative.length - 1] ?? 0;
  const instant = !input.from || input.reducedMotion || length > MOTION_LIMITS.teleportMeters || input.intervalMs === null;
  const durationMs = instant
    ? 0
    : Math.max(MOTION_LIMITS.minDurationMs, Math.min(MOTION_LIMITS.maxDurationMs, input.intervalMs! * 0.95));
  return { path: usable, cumulative, fromHeading: input.fromHeading, toHeading: input.toHeading, startedAt: input.now, durationMs };
}

/** Where the marker is drawn at `now`. Linear in time, so a linear camera ease stays in step. */
export function motionAt(plan: MarkerMotionPlan, now: number): { position: MotionCoordinate; heading: number; done: boolean } {
  const target = plan.path[plan.path.length - 1];
  if (plan.durationMs <= 0 || now >= plan.startedAt + plan.durationMs || plan.path.length < 2) {
    return { position: target, heading: ((plan.toHeading % 360) + 360) % 360, done: true };
  }
  const t = Math.max(0, (now - plan.startedAt) / plan.durationMs);
  const total = plan.cumulative[plan.cumulative.length - 1];
  const along = total * t;
  let index = 1;
  while (index < plan.cumulative.length - 1 && plan.cumulative[index] < along) index += 1;
  const a = plan.path[index - 1];
  const b = plan.path[index];
  const span = plan.cumulative[index] - plan.cumulative[index - 1];
  const r = span > 0 ? (along - plan.cumulative[index - 1]) / span : 1;
  const heading = plan.fromHeading + headingDelta(plan.fromHeading, plan.toHeading) * t;
  return { position: [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r], heading: ((heading % 360) + 360) % 360, done: false };
}

/** Route vertices strictly between two progress values, with both end points, for a motion path. */
export function routeSliceBetween(
  coordinates: MotionCoordinate[],
  cumulativeMeters: number[],
  fromMeters: number,
  toMeters: number,
  pointAt: (meters: number) => MotionCoordinate,
): MotionCoordinate[] | null {
  if (!(toMeters > fromMeters) || toMeters - fromMeters > MOTION_LIMITS.teleportMeters) return null;
  const slice: MotionCoordinate[] = [pointAt(fromMeters)];
  for (let index = 0; index < coordinates.length; index += 1) {
    if (cumulativeMeters[index] > fromMeters && cumulativeMeters[index] < toMeters) slice.push(coordinates[index]);
  }
  slice.push(pointAt(toMeters));
  return slice;
}
