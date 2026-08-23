export type NavigationJourneyMode = "gps" | "simulation";

export type Coordinate = [number, number];

export type MilanBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type OffRouteReadingInput = {
  currentReadings: number;
  offRouteMeters: number;
  thresholdMeters: number;
  requiredReadings: number;
  now: number;
  lastCalculationAt: number;
  cooldownMs: number;
  calculationInProgress: boolean;
};

export type OffRouteReadingResult = {
  readings: number;
  shouldRecalculate: boolean;
};

export type TimedGpsReadingInput = {
  coordinate: Coordinate;
  accuracy: number;
  timestamp: number;
  now: number;
  previousCoordinate: Coordinate | null;
  previousTimestamp: number | null;
  bounds: MilanBounds;
  distanceMeters: (a: Coordinate, b: Coordinate) => number;
  maximumAccuracy?: number;
  maximumAgeMs?: number;
  maximumSpeedMetersPerSecond?: number;
};

export type TimedGpsReadingResult = {
  accepted: boolean;
  reason: "accepted" | "invalid" | "stale" | "duplicate" | "implausible";
};

export type CameraMode =
  | "overview"
  | "following"
  | "navigation-following"
  | "manual-control"
  | "recentering"
  | "arrival";

export type CameraUpdateInput = {
  mode: CameraMode;
  now: number;
  lastUpdatedAt: number;
  previousCenter: Coordinate | null;
  center: Coordinate;
  previousHeading: number;
  heading: number;
  distanceMeters: (a: Coordinate, b: Coordinate) => number;
  minimumIntervalMs?: number;
  minimumMovementMeters?: number;
  minimumHeadingDegrees?: number;
};

export function shouldRunSimulationTimer(mode: NavigationJourneyMode | null) {
  return mode === "simulation";
}

export function shouldBeginNavigation(journeyAlreadyActive: boolean) {
  return !journeyAlreadyActive;
}

export function gpsCoordinateMoved(
  previous: Coordinate | null,
  current: Coordinate,
  distanceMeters: (a: Coordinate, b: Coordinate) => number,
  minimumMovementMeters = 4,
) {
  return previous !== null && distanceMeters(previous, current) > minimumMovementMeters;
}

export function smoothGpsCoordinate(
  previous: Coordinate | null,
  current: Coordinate,
  accuracyMeters: number,
): Coordinate {
  if (!previous) return current;
  const accuracy = Math.max(4, Math.min(120, accuracyMeters));
  const weight = Math.max(0.22, Math.min(0.72, 0.82 - accuracy / 150));
  return [
    previous[0] + (current[0] - previous[0]) * weight,
    previous[1] + (current[1] - previous[1]) * weight,
  ];
}

export function smoothHeading(previous: number, current: number, weight = 0.36) {
  if (!Number.isFinite(current)) return ((previous % 360) + 360) % 360;
  const normalizedPrevious = ((previous % 360) + 360) % 360;
  const normalizedCurrent = ((current % 360) + 360) % 360;
  const shortestDelta = ((normalizedCurrent - normalizedPrevious + 540) % 360) - 180;
  return (normalizedPrevious + shortestDelta * Math.max(0, Math.min(1, weight)) + 360) % 360;
}

export function estimateArrivalTimestamp(nowMs: number, remainingMinutes: number) {
  return nowMs + Math.max(0, remainingMinutes) * 60_000;
}

export function shouldAcceptGpsReading(
  coordinate: Coordinate,
  accuracy: number,
  bounds: MilanBounds,
  maximumAccuracy = 120,
) {
  const [longitude, latitude] = coordinate;
  return (
    Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && Number.isFinite(accuracy)
    && accuracy <= maximumAccuracy
    && longitude >= bounds.west
    && longitude <= bounds.east
    && latitude >= bounds.south
    && latitude <= bounds.north
  );
}

export function evaluateTimedGpsReading(input: TimedGpsReadingInput): TimedGpsReadingResult {
  if (!shouldAcceptGpsReading(
    input.coordinate,
    input.accuracy,
    input.bounds,
    input.maximumAccuracy ?? 120,
  )) {
    return { accepted: false, reason: "invalid" };
  }
  const maximumAgeMs = input.maximumAgeMs ?? 8_000;
  if (
    !Number.isFinite(input.timestamp)
    || input.timestamp > input.now + 1_000
    || input.now - input.timestamp > maximumAgeMs
  ) {
    return { accepted: false, reason: "stale" };
  }
  if (input.previousTimestamp !== null && input.timestamp <= input.previousTimestamp) {
    return { accepted: false, reason: "duplicate" };
  }
  if (input.previousCoordinate && input.previousTimestamp !== null) {
    const elapsedSeconds = Math.max(0.001, (input.timestamp - input.previousTimestamp) / 1_000);
    const movement = input.distanceMeters(input.previousCoordinate, input.coordinate);
    const uncertainty = Math.max(8, input.accuracy * 1.5);
    const plausibleDistance = uncertainty
      + elapsedSeconds * (input.maximumSpeedMetersPerSecond ?? 70);
    if (movement > plausibleDistance) {
      return { accepted: false, reason: "implausible" };
    }
  }
  return { accepted: true, reason: "accepted" };
}

export function shouldApplyRouteResponse(
  activeRequestId: number,
  responseRequestId: number,
  activeSessionId: number,
  responseSessionId: number | null,
  journeyActive: boolean,
) {
  return activeRequestId === responseRequestId
    && (
      responseSessionId === null
      || (journeyActive && activeSessionId === responseSessionId)
    );
}

export function shouldUpdateNavigationCamera(input: CameraUpdateInput) {
  if (
    input.mode === "overview"
    || input.mode === "manual-control"
    || input.mode === "arrival"
  ) return false;
  if (input.mode === "recentering") return true;
  const elapsed = input.now - input.lastUpdatedAt;
  if (elapsed < (input.minimumIntervalMs ?? 450)) return false;
  const movement = input.previousCenter
    ? input.distanceMeters(input.previousCenter, input.center)
    : Number.POSITIVE_INFINITY;
  const headingDelta = Math.abs(((input.heading - input.previousHeading + 540) % 360) - 180);
  return movement >= (input.minimumMovementMeters ?? 3)
    || headingDelta >= (input.minimumHeadingDegrees ?? 6);
}

export function evaluateOffRouteReading(input: OffRouteReadingInput): OffRouteReadingResult {
  const nextReadings = input.offRouteMeters > input.thresholdMeters
    ? Math.min(input.requiredReadings, input.currentReadings + 1)
    : 0;
  const cooldownComplete = input.now - input.lastCalculationAt >= input.cooldownMs;
  const shouldRecalculate = (
    nextReadings >= input.requiredReadings
    && cooldownComplete
    && !input.calculationInProgress
  );
  return {
    readings: shouldRecalculate ? 0 : nextReadings,
    shouldRecalculate,
  };
}
