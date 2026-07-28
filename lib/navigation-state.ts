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
