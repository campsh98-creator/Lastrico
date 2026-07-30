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

export function shouldRunSimulationTimer(mode: NavigationJourneyMode | null) {
  return mode === "simulation";
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

export function evaluateOffRouteReading(input: OffRouteReadingInput): OffRouteReadingResult {
  const nextReadings = input.offRouteMeters > input.thresholdMeters
    ? input.currentReadings + 1
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
