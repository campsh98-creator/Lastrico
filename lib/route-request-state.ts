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

export function isNavigableRouteGeometry(coordinates: RouteCoordinate[]) {
  return coordinates.length >= 2 && coordinates.every(([longitude, latitude]) => (
    Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
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
