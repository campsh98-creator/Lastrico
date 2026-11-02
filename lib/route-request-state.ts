export type RouteCoordinate = [number, number];

export type RoutePreferences = {
  avoidance: "balanced" | "strong" | "maximum";
  maxExtraMinutes: number | null;
};

export type AppliedRoutePreferences = {
  avoidance: RoutePreferences["avoidance"];
  maximumExtraMinutes: number | null;
};

export function routePreferencesMatch(
  requested: RoutePreferences,
  applied: AppliedRoutePreferences | null | undefined,
) {
  return Boolean(
    applied
    && applied.avoidance === requested.avoidance
    && applied.maximumExtraMinutes === requested.maxExtraMinutes,
  );
}

export function isNavigableRouteGeometry(coordinates: unknown): coordinates is RouteCoordinate[] {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const valid = coordinates.every((point) => (
    Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && point[0] >= -180
    && point[0] <= 180
    && point[1] >= -90
    && point[1] <= 90
  ));
  // A line that never leaves its first point has nothing to navigate.
  return valid && coordinates.some(([longitude, latitude]) => (
    longitude !== coordinates[0][0] || latitude !== coordinates[0][1]
  ));
}

export function shouldApplyPlannerRouteResponse(input: {
  activeRequestId: number;
  responseRequestId: number;
  activeRevision: number;
  responseRevision: number;
}) {
  return input.activeRequestId === input.responseRequestId
    && input.activeRevision === input.responseRevision;
}
