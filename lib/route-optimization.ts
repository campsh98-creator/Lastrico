import type { EngineRoute } from "./routing-providers";
import type { TransportMode } from "./routing-types";
import { routeFitsExtraMinutes } from "./route-time-budget.ts";

export type OptimizationCandidate = {
  route: EngineRoute;
  paveMeters?: number;
  riskMeters: number;
  surfaceScore: { paveMeters?: number; unknownMeters: number; totalMeters: number; confirmedRestrictionMeters?: number };
};
export type OptimizationPolicy = {
  minimumPaveReduction: number;
  balancedPaveDivisor: number;
  limits: Record<"balanced" | "strong" | "maximum", { factor: number; seconds: number }>;
};

export function isLegalCandidate(candidate: OptimizationCandidate, mode: TransportMode) {
  const { route, surfaceScore } = candidate;
  const correctProfile = mode === "car"
    ? (route.provider === "valhalla-fossgis" && route.profile === "auto")
      || (route.provider === "osrm-public-fallback" && route.profile === "driving")
    : route.provider === "valhalla-fossgis" && route.profile === mode;
  // Provider profiles retain turn/access restrictions. Reject additional, unambiguous
  // local contradictions; missing OSM evidence is not proof of illegal travel.
  return correctProfile && (surfaceScore.confirmedRestrictionMeters ?? 0) === 0
    && Number.isFinite(route.duration) && route.duration >= 0
    && Number.isFinite(candidate.riskMeters) && candidate.riskMeters >= 0
    && Number.isFinite(surfaceScore.unknownMeters) && surfaceScore.unknownMeters >= 0;
}

function compare(a: OptimizationCandidate, b: OptimizationCandidate) {
  return a.route.duration - b.route.duration || a.riskMeters - b.riskMeters
    || a.surfaceScore.unknownMeters - b.surfaceScore.unknownMeters
    || JSON.stringify(a.route.coordinates).localeCompare(JSON.stringify(b.route.coordinates));
}

export function fastestLegalCandidate<T extends OptimizationCandidate>(candidates: T[], mode: TransportMode): T | undefined {
  return candidates.filter((candidate) => isLegalCandidate(candidate, mode)).sort(compare)[0];
}

export function paretoFrontier<T extends OptimizationCandidate>(candidates: T[]): T[] {
  const objectives = (candidate: T) => [candidate.route.duration, candidate.riskMeters, candidate.surfaceScore.unknownMeters];
  return candidates.filter((candidate) => {
    const values = objectives(candidate);
    return !candidates.some((other) => {
      const alternative = objectives(other);
      return alternative.every((value, i) => value <= values[i])
        && alternative.some((value, i) => value < values[i]);
    });
  }).sort(compare);
}

export function selectOptimizedRoute<T extends OptimizationCandidate>(
  candidates: T[], fast: T, mode: TransportMode, avoidance: "balanced" | "strong" | "maximum",
  maximumExtraMinutes: number | null, policy: OptimizationPolicy,
  equivalent: (a: EngineRoute, b: EngineRoute) => boolean,
): { safe: T; frontier: T[] } {
  const limit = policy.limits[avoidance];
  const eligible = candidates.filter((candidate) => isLegalCandidate(candidate, mode)
    && (candidate === fast || !equivalent(candidate.route, fast.route))
    && candidate.route.duration <= fast.route.duration * limit.factor + limit.seconds
    && routeFitsExtraMinutes(candidate.route.duration, fast.route.duration, maximumExtraMinutes));
  const frontier = paretoFrontier(eligible);
  // Conservative burden, not a prediction: each added unknown metre can hide a
  // rough metre. A route cannot win merely by replacing known stone with missing data.
  const burden = (candidate: T) =>
    candidate.riskMeters + Math.max(0, candidate.surfaceScore.unknownMeters - fast.surfaceScore.unknownMeters);
  const rawPave = (candidate: T) => candidate.paveMeters ?? candidate.surfaceScore.paveMeters ?? candidate.riskMeters;
  const secondsWeight = avoidance === "maximum" ? 0 : policy.balancedPaveDivisor / (avoidance === "balanced" ? 60 : 600);
  const utility = (candidate: T) => burden(candidate) + (candidate.route.duration - fast.route.duration) * secondsWeight;
  const reducing = frontier.filter((candidate) => !equivalent(candidate.route, fast.route)
    && rawPave(candidate) <= rawPave(fast)
    && candidate.riskMeters + policy.minimumPaveReduction <= fast.riskMeters
    && burden(candidate) + policy.minimumPaveReduction <= burden(fast)
    && utility(candidate) < utility(fast));
  reducing.sort((a, b) => utility(a) - utility(b) || compare(a, b));
  return { safe: reducing[0] ?? fast, frontier };
}
