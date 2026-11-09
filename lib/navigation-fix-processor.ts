/**
 * Per-fix navigation decisions, free of React and browser APIs so recorded GPS traces can be
 * replayed through the same logic the app runs. Side effects stay with the caller.
 */
import {
  evaluateOffRouteReading,
  evaluateTimedGpsReading,
  gpsCoordinateMoved,
  smoothHeading,
  type Coordinate,
  type MilanBounds,
} from "./navigation-state.ts";
import {
  calculateRouteProgress,
  pointAtProgress,
  type PendingForwardJump,
  type ProgressInstruction,
  type RouteProgressModel,
} from "./route-progress.ts";
import { evaluateArrivalConfirmation } from "./voice-guidance.ts";

export type NavigationTransportMode = "car" | "motorcycle" | "bicycle";

export type NavigationPolicy = {
  offRouteMeters: number;
  readings: number;
  arrivalMeters: number;
  simulationSteps: number;
};

export const NAVIGATION_POLICY: Record<NavigationTransportMode, NavigationPolicy> = {
  car: { offRouteMeters: 55, readings: 2, arrivalMeters: 35, simulationSteps: 80 },
  motorcycle: { offRouteMeters: 50, readings: 2, arrivalMeters: 30, simulationSteps: 90 },
  bicycle: { offRouteMeters: 38, readings: 3, arrivalMeters: 24, simulationSteps: 110 },
};

export const REROUTE_COOLDOWN_MS = 15_000;
const MAX_REROUTE_COOLDOWN_MS = 120_000;
// Readings count consecutive evidence, so a long silence means they no longer describe now.
const READINGS_EXPIRE_SECONDS = 20;
const RELOCATION_CONFIRMATIONS = 3;
const DWELL_ARRIVAL_SECONDS = 30;
const DWELL_ARRIVAL_ROUTE_METERS = 120;
const DWELL_MAX_ACCURACY_METERS = 65;
// Averaging across a gap would place the vehicle far behind its fix and then race to catch up.
const MAX_SMOOTHED_GAP_SECONDS = 5;

/**
 * Phase 4.29 acquisition. A fix at or under this accuracy is "accurate"; above it the position is
 * shown as approximate, never snapped to the road and never used to leave the route.
 */
export const ACCURATE_FIX_METERS: Record<NavigationTransportMode, number> = { car: 30, motorcycle: 30, bicycle: 25 };
// Three accurate fixes that agree with the route make the start trustworthy. Until then (or until
// the grace ends) no reroute is decided: tower reflections can claim ±20 m while sitting 80 m away.
const CONFIDENT_STREAK = 3;
const STARTUP_GRACE_SECONDS = 20;
const STARTUP_GRACE_MAX_ACCURACY = 65;
// A silence this long followed by a fix means tracking resumed rather than continued.
const RESUMED_AFTER_SECONDS = 8;
// The marker follows the road only when the fix is this close to it.
const SNAP_MIN_METERS = 10;
const SNAP_MAX_METERS = 25;
/**
 * Phase 4.31: the arrow takes about one fix interval to glide to a fix, so it was always drawn
 * one interval behind (≈9 m at 29 km/h, measured). On a confident match it aims where the vehicle
 * will be by then: at most 0.8 s and 10 m ahead along the route, never past the next manoeuvre or
 * the route end. Without a new fix it stops there; it never keeps moving through an outage.
 */
const DISPLAY_LEAD_SECONDS = 0.8;
const DISPLAY_LEAD_MAX_METERS = 10;

/**
 * Phase 4.31 wrong-turn evidence. Distance alone needed 55 m (car) plus the fix accuracy on two
 * fixes, so a wrong turn was recognised only ~80 m later and a parallel street 40–60 m away never.
 * Travelling away from the route's own course while clearly beside it, on several accurate fixes,
 * confirms a wrong turn sooner; a steady offset over a long stretch confirms a parallel street.
 * Neither can come from a single fix, and both respect the cooldown and the in-progress lock.
 */
export const DEVIATION_POLICY: Record<NavigationTransportMode, {
  maxAccuracy: number;
  awayDegrees: number;
  wrongTurnMeters: number;
  wrongTurnFixes: number;
  parallelMaxAccuracy: number;
  parallelMinOffset: number;
  parallelMeters: number;
}> = {
  car: { maxAccuracy: 25, awayDegrees: 55, wrongTurnMeters: 35, wrongTurnFixes: 3, parallelMaxAccuracy: 20, parallelMinOffset: 35, parallelMeters: 120 },
  motorcycle: { maxAccuracy: 25, awayDegrees: 55, wrongTurnMeters: 35, wrongTurnFixes: 3, parallelMaxAccuracy: 20, parallelMinOffset: 35, parallelMeters: 120 },
  bicycle: { maxAccuracy: 20, awayDegrees: 55, wrongTurnMeters: 24, wrongTurnFixes: 4, parallelMaxAccuracy: 16, parallelMinOffset: 30, parallelMeters: 80 },
};

export type DeviationReason = "distance" | "wrong-turn" | "parallel";

function angularGap(a: number, b: number) {
  const difference = Math.abs(((a - b) % 360 + 360) % 360);
  return difference > 180 ? 360 - difference : difference;
}

export type GpsQuality = "approximate" | "accurate" | "resumed";

function localMeters(origin: Coordinate) {
  const perLon = 111_320 * Math.cos(origin[1] * Math.PI / 180);
  const perLat = 110_540;
  return {
    toXY: ([lon, lat]: Coordinate): [number, number] => [(lon - origin[0]) * perLon, (lat - origin[1]) * perLat],
    toCoordinate: ([x, y]: [number, number]): Coordinate => [origin[0] + x / perLon, origin[1] + y / perLat],
  };
}

/**
 * Accuracy-weighted fusion with a constant-velocity prediction (a scalar Kalman step). A precise
 * fix after a poor estimate takes over almost entirely; similar fixes are averaged without lag.
 */
export function fuseGpsPosition(input: {
  previous: Coordinate | null;
  previousUncertainty: number | null;
  velocity: [number, number] | null;
  measurement: Coordinate;
  accuracy: number;
  elapsedSeconds: number;
  reportedSpeed: number | null;
  reportedHeading: number | null;
  maximumSpeed: number;
}): { position: Coordinate; uncertainty: number; velocity: [number, number] | null } {
  const accuracy = Math.max(3, Math.min(150, input.accuracy));
  const reportedVelocity = Number.isFinite(input.reportedSpeed) && Number.isFinite(input.reportedHeading) && input.reportedSpeed! > 1
    ? [Math.sin(input.reportedHeading! * Math.PI / 180) * input.reportedSpeed!, Math.cos(input.reportedHeading! * Math.PI / 180) * input.reportedSpeed!] as [number, number]
    : null;
  if (!input.previous || input.previousUncertainty === null || input.elapsedSeconds > MAX_SMOOTHED_GAP_SECONDS || input.elapsedSeconds <= 0) {
    return { position: input.measurement, uncertainty: accuracy, velocity: reportedVelocity };
  }
  const frame = localMeters(input.previous);
  const dt = input.elapsedSeconds;
  // A device that reports standing still is believed: predicting the last speed would drift a stop.
  const reportedStopped = Number.isFinite(input.reportedSpeed) && input.reportedSpeed! >= 0 && input.reportedSpeed! < 0.5;
  const velocity = reportedStopped ? null : reportedVelocity ?? input.velocity;
  const predictedXY: [number, number] = velocity ? [velocity[0] * dt, velocity[1] * dt] : [0, 0];
  const speed = velocity ? Math.hypot(velocity[0], velocity[1]) : 0;
  const processNoise = (3 + 0.6 * speed) ** 2 * dt;
  const predictedVariance = input.previousUncertainty ** 2 + processNoise;
  const gain = Math.max(0.35, Math.min(1, predictedVariance / (predictedVariance + accuracy ** 2)));
  const measured = frame.toXY(input.measurement);
  const fusedXY: [number, number] = [
    predictedXY[0] + (measured[0] - predictedXY[0]) * gain,
    predictedXY[1] + (measured[1] - predictedXY[1]) * gain,
  ];
  let nextVelocity: [number, number] | null = reportedStopped ? [0, 0] : reportedVelocity;
  if (!nextVelocity) {
    const derived: [number, number] = [fusedXY[0] / dt, fusedXY[1] / dt];
    const derivedSpeed = Math.hypot(derived[0], derived[1]);
    const blended: [number, number] = input.velocity
      ? [(input.velocity[0] + derived[0]) / 2, (input.velocity[1] + derived[1]) / 2]
      : derived;
    const blendedSpeed = Math.hypot(blended[0], blended[1]);
    // Below walking pace the "velocity" is noise; decay it so a stop does not drift.
    const scale = derivedSpeed < 0.7 ? 0.4 : blendedSpeed > input.maximumSpeed ? input.maximumSpeed / blendedSpeed : 1;
    nextVelocity = [blended[0] * scale, blended[1] * scale];
  }
  return {
    position: frame.toCoordinate(fusedXY),
    uncertainty: Math.max(3, Math.sqrt((1 - gain) * predictedVariance)),
    velocity: nextVelocity,
  };
}

export function distanceMeters(a: Coordinate, b: Coordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function bearingBetween(a: Coordinate, b: Coordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const toDegrees = (value: number) => value * 180 / Math.PI;
  const longitude = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const y = Math.sin(longitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Failed reroutes back off so a provider outage does not become a steady stream of requests. */
export function rerouteCooldownMs(consecutiveFailures: number) {
  return Math.min(MAX_REROUTE_COOLDOWN_MS, REROUTE_COOLDOWN_MS * 2 ** Math.max(0, consecutiveFailures));
}

export type GpsFix = {
  coordinate: Coordinate;
  accuracy: number;
  timestamp: number;
  heading: number | null;
  speed: number | null;
};

export type NavigationFixState = {
  position: Coordinate | null;
  accuracy: number | null;
  timestamp: number | null;
  heading: number;
  progressMeters: number;
  pendingJump: PendingForwardJump | null;
  travelledMeters: number;
  offRouteReadings: number;
  arrivalReadings: number;
  /** Smallest gap seen between the device clock and fix timestamps, so skew is not mistaken for staleness. */
  clockOffsetMs: number | null;
  /** Consecutive implausible fixes that agree with each other, which means a real relocation. */
  relocation: { coordinate: Coordinate; accuracy: number; timestamp: number; count: number } | null;
  /** Where and when the vehicle stopped near the destination. */
  dwell: { coordinate: Coordinate; startedAt: number } | null;
  /** Uncertainty in metres of the fused position, so a precise fix can replace a poor estimate. */
  uncertainty: number | null;
  /** Velocity of the fused estimate (m/s east, north), used to predict between fixes. */
  velocity: [number, number] | null;
  /** Start-up confidence: no reroute is decided before the position is trustworthy. */
  acquisition: { firstAcceptedAt: number | null; accurateStreak: number; confident: boolean };
  /** Course of the drawn arrow, kept while stationary. */
  displayHeading: number;
  /** Phase 4.31: accurate travel away from the route's course while beside it. */
  divergence: { origin: Coordinate; startedAt: number; fixes: number; startOffRoute: number; deviceCourse: boolean } | null;
  /** Phase 4.31: metres driven steadily beside the route, as on a parallel street. */
  besideMeters: number;
};

export function createNavigationFixState(): NavigationFixState {
  return {
    clockOffsetMs: null,
    relocation: null,
    dwell: null,
    position: null,
    accuracy: null,
    timestamp: null,
    heading: 0,
    progressMeters: 0,
    pendingJump: null,
    travelledMeters: 0,
    offRouteReadings: 0,
    arrivalReadings: 0,
    uncertainty: null,
    velocity: null,
    acquisition: { firstAcceptedAt: null, accurateStreak: 0, confident: false },
    displayHeading: 0,
    divergence: null,
    besideMeters: 0,
  };
}

/** A replacement route has its own distances, so nothing measured on the old one carries over. */
export function withReplacementRoute(state: NavigationFixState, progressMeters: number): NavigationFixState {
  return { ...state, progressMeters, pendingJump: null, offRouteReadings: 0, arrivalReadings: 0, dwell: null, divergence: null, besideMeters: 0 };
}

export function withClearedReadings(state: NavigationFixState): NavigationFixState {
  return { ...state, offRouteReadings: 0, arrivalReadings: 0, dwell: null, divergence: null, besideMeters: 0 };
}

export type NavigationFixContext<T extends ProgressInstruction> = {
  now: number;
  mode: NavigationTransportMode;
  bounds: MilanBounds;
  route: {
    model: RouteProgressModel<T>;
    minutes: number;
    distanceKm: number;
  } | null;
  lastCalculationAt: number;
  calculationInProgress: boolean;
  rerouteCooldownMs?: number;
};

export type NavigationFixDecision<T extends ProgressInstruction> =
  | { outcome: "outside"; state: NavigationFixState }
  | {
      outcome: "rejected";
      reason: "invalid" | "stale" | "duplicate" | "implausible";
      state: NavigationFixState;
    }
  | {
      outcome: "accepted";
      state: NavigationFixState;
      position: Coordinate;
      markerMoved: boolean;
      heading: number;
      elapsedSeconds: number;
      /** What the app should draw: on the road when the match is confident, else the fused fix. */
      display: { position: Coordinate; heading: number; snapped: boolean; progressMeters?: number };
      quality: GpsQuality;
      /** False during start-up while the position is not yet trustworthy enough to leave the route. */
      confident: boolean;
      progress: ReturnType<typeof calculateRouteProgress<T>> | null;
      arrived: boolean;
      offRouteStarted: boolean;
      shouldRecalculate: boolean;
      /** Phase 4.31: which evidence asked for the reroute (set only with shouldRecalculate). */
      deviationReason?: DeviationReason;
    };

function coordinateInBounds([longitude, latitude]: Coordinate, bounds: MilanBounds) {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= bounds.west && longitude <= bounds.east
    && latitude >= bounds.south && latitude <= bounds.north;
}

export function processGpsFix<T extends ProgressInstruction>(
  state: NavigationFixState,
  fix: GpsFix,
  context: NavigationFixContext<T>,
): NavigationFixDecision<T> {
  const { coordinate, accuracy, timestamp, heading: reportedHeading, speed: reportedSpeed } = fix;
  if (!coordinateInBounds(coordinate, context.bounds)) {
    return { outcome: "outside", state: withClearedReadings(state) };
  }
  // A device clock that disagrees with the GPS by a constant offset must not reject every fix.
  const clockGapMs = context.now - timestamp;
  const clockOffsetMs = Number.isFinite(timestamp)
    ? Math.min(state.clockOffsetMs ?? clockGapMs, clockGapMs)
    : state.clockOffsetMs;
  const maximumSpeed = context.mode === "bicycle" ? 22 : 70;
  const reading = evaluateTimedGpsReading({
    coordinate,
    accuracy,
    timestamp,
    now: context.now - (clockOffsetMs ?? 0),
    previousCoordinate: state.position,
    previousAccuracy: state.accuracy,
    previousTimestamp: state.timestamp,
    bounds: context.bounds,
    distanceMeters,
    maximumSpeedMetersPerSecond: maximumSpeed,
  });
  let current: NavigationFixState = { ...state, clockOffsetMs };
  if (!reading.accepted) {
    // A rejected reading says nothing about the route, so it must not erase evidence
    // already gathered towards a reroute or arrival.
    if (reading.reason !== "implausible") return { outcome: "rejected", reason: reading.reason, state: current };
    const candidate = current.relocation;
    const agrees = candidate !== null && timestamp > candidate.timestamp
      && distanceMeters(candidate.coordinate, coordinate) <= Math.max(8, accuracy * 1.5 + candidate.accuracy * 1.25)
        + ((timestamp - candidate.timestamp) / 1_000) * maximumSpeed;
    const count = agrees ? candidate.count + 1 : 1;
    if (count < RELOCATION_CONFIRMATIONS) {
      return {
        outcome: "rejected",
        reason: reading.reason,
        state: { ...current, relocation: { coordinate, accuracy, timestamp, count } },
      };
    }
    // Several fixes agree on a new place: treat it like a first fix there.
    current = {
      ...current,
      position: null,
      accuracy: null,
      timestamp: null,
      uncertainty: null,
      velocity: null,
      pendingJump: null,
      offRouteReadings: 0,
      arrivalReadings: 0,
      dwell: null,
      divergence: null,
      besideMeters: 0,
    };
  }
  current.relocation = null;

  const elapsedSeconds = current.timestamp !== null ? (timestamp - current.timestamp) / 1_000 : 1;
  if (elapsedSeconds > READINGS_EXPIRE_SECONDS) current = withClearedReadings(current);
  const previous = current.position;
  const previousAccuracy = current.accuracy ?? accuracy;
  const headingMovementThreshold = Math.max(6, Math.min(25, Math.max(previousAccuracy, accuracy) * 0.75));
  const inferredHeading = previous && gpsCoordinateMoved(previous, coordinate, distanceMeters, headingMovementThreshold)
    ? bearingBetween(previous, coordinate)
    : current.heading;
  const movingWithReportedHeading = Number.isFinite(reportedHeading)
    && Number.isFinite(reportedSpeed)
    && reportedSpeed! > 1;
  const heading = smoothHeading(
    current.heading,
    movingWithReportedHeading ? reportedHeading! : inferredHeading,
    movingWithReportedHeading ? 0.46 : 0.32,
  );
  const fused = fuseGpsPosition({
    previous,
    previousUncertainty: current.uncertainty,
    velocity: current.velocity,
    measurement: coordinate,
    accuracy,
    elapsedSeconds,
    reportedSpeed,
    reportedHeading,
    maximumSpeed,
  });
  const position = fused.position;
  const estimatedSpeed = fused.velocity ? Math.hypot(fused.velocity[0], fused.velocity[1]) : 0;
  const moving = estimatedSpeed >= 1.2 || movingWithReportedHeading;
  // Stationary jitter stays held; a moving vehicle is followed fix by fix (Phase 4.29: holding
  // 4–15 m and then releasing it at once was the visible jump).
  const markerMovementThreshold = moving ? 1 : Math.max(4, Math.min(15, Math.max(previousAccuracy, accuracy) * 0.35));
  const markerMoved = previous === null
    || gpsCoordinateMoved(previous, position, distanceMeters, markerMovementThreshold);
  const accurateLimit = ACCURATE_FIX_METERS[context.mode];
  const accurateFix = accuracy <= accurateLimit;
  const quality: GpsQuality = !accurateFix ? "approximate" : current.timestamp !== null && elapsedSeconds >= RESUMED_AFTER_SECONDS ? "resumed" : "accurate";
  const firstAcceptedAt = current.acquisition.firstAcceptedAt ?? timestamp;
  const next: NavigationFixState = {
    ...current,
    position: markerMoved ? position : previous,
    accuracy,
    timestamp,
    heading,
    uncertainty: fused.uncertainty,
    velocity: fused.velocity,
    acquisition: { ...current.acquisition, firstAcceptedAt },
    travelledMeters: markerMoved && previous
      ? current.travelledMeters + Math.min(250, distanceMeters(previous, position))
      : current.travelledMeters,
  };
  const unsnapped = { position: markerMoved ? position : previous ?? position, heading, snapped: false };
  const accepted = { outcome: "accepted" as const, position, markerMoved, heading, elapsedSeconds, quality };

  if (!context.route) {
    next.displayHeading = heading;
    return {
      ...accepted,
      state: next,
      display: unsnapped,
      confident: current.acquisition.confident,
      progress: null,
      arrived: false,
      offRouteStarted: false,
      shouldRecalculate: false,
    };
  }

  const { model, minutes, distanceKm } = context.route;
  const policy = NAVIGATION_POLICY[context.mode];
  // Before the start is trustworthy, early fixes must not anchor progress: one reflected fix would
  // otherwise lock it on a later part of the route. Each fix is located afresh until then.
  const anchored = current.acquisition.confident ? current.progressMeters : null;
  let progress = calculateRouteProgress(model, position, minutes, anchored, {
    accuracy,
    elapsedSeconds,
    maxSpeedMps: context.mode === "bicycle" ? 22 : 45,
    headingDegrees: movingWithReportedHeading ? reportedHeading : null,
    pendingJump: current.pendingJump,
    // Located afresh until confident, but on the pass of the route nearest the last fix (the
    // start, at first): a loop round a square must not put the start on its later pass.
    preferProgressMeters: anchored === null ? current.progressMeters : null,
  });
  // The first fix has no earlier progress to contradict: someone who starts part way along the
  // route is located there, not held back or sent to a reroute.
  if (current.timestamp === null && progress.offRouteMeters > Math.max(45, accuracy * 1.8)) {
    progress = calculateRouteProgress(model, position, minutes, null);
  }
  next.progressMeters = progress.routeProgressMeters;
  next.pendingJump = progress.pendingJump;

  // Start-up confidence: accurate fixes that agree with the route, or the end of a bounded grace.
  // Agreement means within the fix's own claimed accuracy, not merely inside the reroute threshold.
  const onRoute = progress.offRouteMeters <= Math.max(25, accuracy * 1.5);
  const accurateStreak = accurateFix && onRoute ? current.acquisition.accurateStreak + 1 : 0;
  const graceOver = (timestamp - firstAcceptedAt) / 1_000 >= STARTUP_GRACE_SECONDS && accuracy <= STARTUP_GRACE_MAX_ACCURACY;
  const confident = current.acquisition.confident || accurateStreak >= CONFIDENT_STREAK || graceOver;
  next.acquisition = { firstAcceptedAt, accurateStreak, confident };

  // Draw the vehicle on the road only for an accurate fix close to it; never invent precision.
  const snapTolerance = Math.max(SNAP_MIN_METERS, Math.min(SNAP_MAX_METERS, accuracy * 1.2));
  const along = accurateFix && progress.offRouteMeters <= snapTolerance ? pointAtProgress(model, progress.routeProgressMeters) : null;
  const displayHeading = along
    ? (current.timestamp === null ? along.bearing : moving ? smoothHeading(current.displayHeading, along.bearing, 0.6) : current.displayHeading)
    : (moving ? heading : current.displayHeading);
  next.displayHeading = displayHeading;
  const leadSpeed = movingWithReportedHeading ? reportedSpeed! : estimatedSpeed;
  const leadMeters = along && moving
    ? Math.max(0, Math.min(DISPLAY_LEAD_MAX_METERS, leadSpeed * DISPLAY_LEAD_SECONDS, progress.instructionDistance - 3, progress.remainingMeters - 3))
    : 0;
  const ahead = along && leadMeters >= 0.5 ? pointAtProgress(model, progress.routeProgressMeters + leadMeters) : null;
  const display = along
    ? { position: (ahead ?? along).coordinate, heading: displayHeading, snapped: true, progressMeters: progress.routeProgressMeters + (ahead ? leadMeters : 0) }
    : { ...unsnapped, heading: displayHeading };

  const routeEnd = model.coordinates[model.coordinates.length - 1] ?? null;
  const arrival = evaluateArrivalConfirmation({
    routeEnd,
    currentPosition: position,
    accuracy,
    distanceToEnd: routeEnd ? distanceMeters(position, routeEnd) : 9999,
    remainingRouteMeters: progress.remainingMeters,
    journeyTravelledMeters: next.travelledMeters,
    minimumTravelBeforeArrival: Math.min(80, distanceKm * 100),
    arrivalToleranceMeters: policy.arrivalMeters + Math.min(accuracy, 25),
    currentArrivalReadings: current.arrivalReadings,
    journeyMode: "gps",
    maxArrivalAccuracyMeters: 65,
  });
  next.arrivalReadings = arrival.consecutiveArrivalReadings;

  // Parking short of the destination never satisfies the arrival radius, so waiting close by
  // for long enough also counts as having arrived.
  const nearEnd = progress.remainingMeters <= DWELL_ARRIVAL_ROUTE_METERS
    && accuracy <= DWELL_MAX_ACCURACY_METERS
    && next.travelledMeters >= Math.min(80, distanceKm * 100);
  const stayedPut = nearEnd && current.dwell !== null
    && distanceMeters(current.dwell.coordinate, position) <= Math.max(15, accuracy);
  next.dwell = !nearEnd ? null : stayedPut ? current.dwell : { coordinate: position, startedAt: timestamp };
  const dwelled = next.dwell !== null && (timestamp - next.dwell.startedAt) / 1_000 >= DWELL_ARRIVAL_SECONDS;

  if (arrival.isConfirmedArrival || next.arrivalReadings >= 2 || dwelled) {
    return {
      ...accepted,
      display,
      confident,
      state: next,
      progress,
      arrived: true,
      offRouteStarted: false,
      shouldRecalculate: false,
    };
  }

  if (!confident) {
    next.offRouteReadings = 0;
    next.divergence = null;
    next.besideMeters = 0;
    return {
      ...accepted,
      display,
      confident,
      state: next,
      progress,
      arrived: false,
      offRouteStarted: false,
      shouldRecalculate: false,
    };
  }
  // Phase 4.31: course and offset evidence of a wrong turn or a parallel street.
  const deviation = DEVIATION_POLICY[context.mode];
  const step = previous ? Math.min(40, distanceMeters(previous, position)) : 0;
  const routeCourse = pointAtProgress(model, progress.routeProgressMeters)?.bearing ?? null;
  // The reported course when the device gives one, else the smoothed course of the fixes.
  const travelCourse = movingWithReportedHeading ? reportedHeading! : moving ? heading : null;
  const courseGap = travelCourse !== null && routeCourse !== null ? angularGap(travelCourse, routeCourse) : null;
  // Beside the route, not behind on it: driving back along the route is judged by the distance
  // rule alone, as before (a short U-turn on the route must not reroute).
  const offRouteMeters = progress.lateralOffRouteMeters;
  if (moving && accuracy <= deviation.maxAccuracy && courseGap !== null && courseGap >= deviation.awayDegrees
    && offRouteMeters >= Math.max(18, accuracy)) {
    next.divergence = {
      origin: current.divergence?.origin ?? position,
      startedAt: current.divergence?.startedAt ?? timestamp,
      fixes: (current.divergence?.fixes ?? 0) + 1,
      startOffRoute: current.divergence?.startOffRoute ?? offRouteMeters,
      deviceCourse: (current.divergence?.deviceCourse ?? true) && movingWithReportedHeading,
    };
  } else if (offRouteMeters < Math.max(12, accuracy * 0.6)) {
    next.divergence = null;
  }
  // Judged on the net movement since the evidence began, not fix to fix: noise and multipath
  // jumps move the fixes sideways and back, a wrong turn keeps carrying the vehicle away.
  const netMeters = next.divergence ? distanceMeters(next.divergence.origin, position) : 0;
  const netGap = next.divergence && routeCourse !== null && netMeters > 0
    ? angularGap(bearingBetween(next.divergence.origin, position), routeCourse) : 0;
  // Without the device's own course a multipath jump and a turn look alike from the fixes
  // alone, so more travel and more time are required.
  const deviceCourse = next.divergence?.deviceCourse ?? false;
  const wrongTurn = next.divergence !== null
    && next.divergence.fixes >= (deviceCourse ? deviation.wrongTurnFixes : deviation.wrongTurnFixes + 2)
    && netMeters >= (deviceCourse ? deviation.wrongTurnMeters : deviation.wrongTurnMeters * 1.6)
    && (deviceCourse || (timestamp - next.divergence.startedAt) / 1_000 >= 5)
    && netGap >= deviation.awayDegrees - 5
    // A vehicle moves where it is heading; a multipath jump moves the fix sideways instead.
    && (!deviceCourse || angularGap(bearingBetween(next.divergence.origin, position), reportedHeading!) <= 30)
    && offRouteMeters >= Math.max(25, accuracy * 1.2)
    && offRouteMeters - next.divergence.startOffRoute >= Math.max(8, netMeters * 0.4);
  const steadilyBeside = moving && accuracy <= deviation.parallelMaxAccuracy
    && offRouteMeters >= Math.max(deviation.parallelMinOffset, accuracy * 2.5)
    && (courseGap === null || courseGap <= 40);
  next.besideMeters = steadilyBeside ? current.besideMeters + step : 0;
  const parallel = next.besideMeters >= deviation.parallelMeters;
  const confirmedDeviation = wrongTurn || parallel;

  const offRoute = evaluateOffRouteReading({
    // Confirmed course or offset evidence counts as the last reading the distance rule needs.
    currentReadings: confirmedDeviation ? Math.max(current.offRouteReadings, policy.readings - 1) : current.offRouteReadings,
    offRouteMeters: confirmedDeviation ? Number.POSITIVE_INFINITY : offRouteMeters,
    thresholdMeters: policy.offRouteMeters + Math.min(accuracy, 60),
    requiredReadings: policy.readings,
    now: context.now,
    lastCalculationAt: context.lastCalculationAt,
    cooldownMs: context.rerouteCooldownMs ?? REROUTE_COOLDOWN_MS,
    calculationInProgress: context.calculationInProgress,
  });
  next.offRouteReadings = offRoute.readings;
  if (offRoute.shouldRecalculate) {
    next.divergence = null;
    next.besideMeters = 0;
  }
  return {
    ...accepted,
    display,
    confident,
    state: next,
    progress,
    arrived: false,
    // Course or offset evidence can complete an episode on its first reading.
    offRouteStarted: current.offRouteReadings === 0 && (offRoute.readings > 0 || offRoute.shouldRecalculate),
    shouldRecalculate: offRoute.shouldRecalculate,
    ...(offRoute.shouldRecalculate
      ? { deviationReason: (wrongTurn ? "wrong-turn" : parallel ? "parallel" : "distance") as DeviationReason }
      : {}),
  };
}

/** Simulation walks the route's own vertices, so its anchor is known exactly. */
export function simulationProgressMeters<T extends ProgressInstruction>(
  model: RouteProgressModel<T>,
  coordinateIndex: number,
) {
  return model.cumulativeMeters[Math.min(coordinateIndex, model.cumulativeMeters.length - 1)] ?? 0;
}
