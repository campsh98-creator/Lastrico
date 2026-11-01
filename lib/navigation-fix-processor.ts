/**
 * Per-fix navigation decisions, free of React and browser APIs so recorded GPS traces can be
 * replayed through the same logic the app runs. Side effects stay with the caller.
 */
import {
  evaluateOffRouteReading,
  evaluateTimedGpsReading,
  gpsCoordinateMoved,
  smoothGpsCoordinate,
  smoothHeading,
  type Coordinate,
  type MilanBounds,
} from "./navigation-state.ts";
import {
  calculateRouteProgress,
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

const REROUTE_COOLDOWN_MS = 15_000;
// Averaging across a gap would place the vehicle far behind its fix and then race to catch up.
const MAX_SMOOTHED_GAP_SECONDS = 5;

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
};

export function createNavigationFixState(): NavigationFixState {
  return {
    position: null,
    accuracy: null,
    timestamp: null,
    heading: 0,
    progressMeters: 0,
    pendingJump: null,
    travelledMeters: 0,
    offRouteReadings: 0,
    arrivalReadings: 0,
  };
}

/** A replacement route has its own distances, so nothing measured on the old one carries over. */
export function withReplacementRoute(state: NavigationFixState, progressMeters: number): NavigationFixState {
  return { ...state, progressMeters, pendingJump: null, offRouteReadings: 0, arrivalReadings: 0 };
}

export function withClearedReadings(state: NavigationFixState): NavigationFixState {
  return { ...state, offRouteReadings: 0, arrivalReadings: 0 };
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
      progress: ReturnType<typeof calculateRouteProgress<T>> | null;
      arrived: boolean;
      offRouteStarted: boolean;
      shouldRecalculate: boolean;
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
  const reading = evaluateTimedGpsReading({
    coordinate,
    accuracy,
    timestamp,
    now: context.now,
    previousCoordinate: state.position,
    previousAccuracy: state.accuracy,
    previousTimestamp: state.timestamp,
    bounds: context.bounds,
    distanceMeters,
    maximumSpeedMetersPerSecond: context.mode === "bicycle" ? 22 : 70,
  });
  if (!reading.accepted) {
    return { outcome: "rejected", reason: reading.reason, state: withClearedReadings(state) };
  }

  const elapsedSeconds = state.timestamp !== null ? (timestamp - state.timestamp) / 1_000 : 1;
  const previous = state.position;
  const previousAccuracy = state.accuracy ?? accuracy;
  const headingMovementThreshold = Math.max(6, Math.min(25, Math.max(previousAccuracy, accuracy) * 0.75));
  const inferredHeading = previous && gpsCoordinateMoved(previous, coordinate, distanceMeters, headingMovementThreshold)
    ? bearingBetween(previous, coordinate)
    : state.heading;
  const movingWithReportedHeading = Number.isFinite(reportedHeading)
    && Number.isFinite(reportedSpeed)
    && reportedSpeed! > 1;
  const heading = smoothHeading(
    state.heading,
    movingWithReportedHeading ? reportedHeading! : inferredHeading,
    movingWithReportedHeading ? 0.46 : 0.32,
  );
  const position = elapsedSeconds > MAX_SMOOTHED_GAP_SECONDS
    ? coordinate
    : smoothGpsCoordinate(previous, coordinate, accuracy);
  const markerMovementThreshold = Math.max(4, Math.min(15, Math.max(previousAccuracy, accuracy) * 0.35));
  const markerMoved = previous === null
    || gpsCoordinateMoved(previous, position, distanceMeters, markerMovementThreshold);
  const next: NavigationFixState = {
    ...state,
    position: markerMoved ? position : previous,
    accuracy,
    timestamp,
    heading,
    travelledMeters: markerMoved && previous
      ? state.travelledMeters + Math.min(250, distanceMeters(previous, position))
      : state.travelledMeters,
  };
  const accepted = { outcome: "accepted" as const, position, markerMoved, heading, elapsedSeconds };

  if (!context.route) {
    return {
      ...accepted,
      state: next,
      progress: null,
      arrived: false,
      offRouteStarted: false,
      shouldRecalculate: false,
    };
  }

  const { model, minutes, distanceKm } = context.route;
  const policy = NAVIGATION_POLICY[context.mode];
  const progress = calculateRouteProgress(model, position, minutes, state.progressMeters, {
    accuracy,
    elapsedSeconds,
    maxSpeedMps: context.mode === "bicycle" ? 22 : 45,
    headingDegrees: movingWithReportedHeading ? reportedHeading : null,
    pendingJump: state.pendingJump,
  });
  next.progressMeters = progress.routeProgressMeters;
  next.pendingJump = progress.pendingJump;

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
    currentArrivalReadings: state.arrivalReadings,
    journeyMode: "gps",
  });
  next.arrivalReadings = arrival.consecutiveArrivalReadings;
  if (arrival.isConfirmedArrival && next.arrivalReadings >= 2) {
    return {
      ...accepted,
      state: next,
      progress,
      arrived: true,
      offRouteStarted: false,
      shouldRecalculate: false,
    };
  }

  const offRoute = evaluateOffRouteReading({
    currentReadings: state.offRouteReadings,
    offRouteMeters: progress.offRouteMeters,
    thresholdMeters: policy.offRouteMeters + Math.min(accuracy, 60),
    requiredReadings: policy.readings,
    now: context.now,
    lastCalculationAt: context.lastCalculationAt,
    cooldownMs: REROUTE_COOLDOWN_MS,
    calculationInProgress: context.calculationInProgress,
  });
  next.offRouteReadings = offRoute.readings;
  return {
    ...accepted,
    state: next,
    progress,
    arrived: false,
    offRouteStarted: state.offRouteReadings === 0 && offRoute.readings > 0,
    shouldRecalculate: offRoute.shouldRecalculate,
  };
}

/** Simulation walks the route's own vertices, so its anchor is known exactly. */
export function simulationProgressMeters<T extends ProgressInstruction>(
  model: RouteProgressModel<T>,
  coordinateIndex: number,
) {
  return model.cumulativeMeters[Math.min(coordinateIndex, model.cumulativeMeters.length - 1)] ?? 0;
}
