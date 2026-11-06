/**
 * Read-only adapter around the CURRENT production selector (lib/route-optimization.ts) and the
 * selection flow of app/api/routes/route.ts. Nothing here changes production code: modules are
 * imported as-is (Node 24 strips TypeScript types natively).
 */
import {
  fastestLegalCandidate,
  isLegalCandidate,
  paretoFrontier,
  selectOptimizedRoute,
} from "../../../lib/route-optimization.ts";
import { deduplicateRoutes, routesShareCorridor } from "../../../lib/route-candidates.ts";

export { isLegalCandidate, paretoFrontier, routesShareCorridor, deduplicateRoutes, fastestLegalCandidate };

/**
 * MODE_POLICY is a non-exported const in app/api/routes/route.ts. This mirror is verified
 * field-by-field against the production source by test/production-parity.test.mjs.
 */
export const PRODUCTION_MODE_POLICY = Object.freeze({
  car: {
    surfaceMatchMeters: 12, equivalentDistanceMeters: 120, equivalentDurationSeconds: 90, equivalentAverageMeters: 32,
    detourMinimumMeters: 380, detourMaximumMeters: 900, detourDistanceFactor: 0.1, balancedPaveDivisor: 500, minimumPaveReduction: 20,
    limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } },
  },
  motorcycle: {
    surfaceMatchMeters: 11, equivalentDistanceMeters: 110, equivalentDurationSeconds: 75, equivalentAverageMeters: 30,
    detourMinimumMeters: 400, detourMaximumMeters: 1_050, detourDistanceFactor: 0.12, balancedPaveDivisor: 330, minimumPaveReduction: 15,
    limits: { balanced: { factor: 1.28, seconds: 240 }, strong: { factor: 1.55, seconds: 540 }, maximum: { factor: 1.9, seconds: 900 } },
  },
  bicycle: {
    surfaceMatchMeters: 9, equivalentDistanceMeters: 85, equivalentDurationSeconds: 75, equivalentAverageMeters: 24,
    detourMinimumMeters: 220, detourMaximumMeters: 650, detourDistanceFactor: 0.09, balancedPaveDivisor: 260, minimumPaveReduction: 12,
    limits: { balanced: { factor: 1.3, seconds: 300 }, strong: { factor: 1.6, seconds: 720 }, maximum: { factor: 2.1, seconds: 1_200 } },
  },
});

/** Normalised candidate -> production OptimizationCandidate (route object kept stable by id). */
export function toOptimizationCandidate(candidate, geometry = []) {
  return {
    id: candidate.id,
    normalised: candidate,
    route: {
      duration: candidate.durationS,
      distance: candidate.distanceM,
      coordinates: geometry,
      instructions: [],
      provider: candidate.provider,
      profile: candidate.profile,
    },
    paveMeters: candidate.confirmedPaveM + candidate.probablePaveM,
    riskMeters: candidate.riskM,
    surfaceScore: {
      paveMeters: candidate.confirmedPaveM + candidate.probablePaveM,
      smoothMeters: candidate.smoothM ?? 0,
      unknownMeters: candidate.unknownM,
      totalMeters: candidate.totalM ?? 0,
      ...(candidate.confirmedRestrictionM !== undefined ? { confirmedRestrictionMeters: candidate.confirmedRestrictionM } : {}),
      ...(candidate.blockingRestrictionM !== undefined ? { blockingRestrictionMeters: candidate.blockingRestrictionM } : {}),
    },
  };
}

/**
 * Re-run the current production selection on an already scored candidate pool:
 * fastestLegalCandidate -> selectOptimizedRoute -> route.ts hasDistinctAlternative post-filter.
 * `equivalentById(aId, bId)` answers the corridor question for two candidate ids.
 */
export function productionSelect(candidates, { mode, avoidance, maxExtraMinutes, equivalentById }) {
  const policy = PRODUCTION_MODE_POLICY[mode];
  const pool = candidates.map((candidate) => toOptimizationCandidate(candidate));
  const byRoute = new Map(pool.map((item) => [item.route, item.id]));
  const equivalent = (a, b) => a === b || equivalentById(byRoute.get(a), byRoute.get(b));
  const fast = fastestLegalCandidate(pool, mode);
  if (!fast) return { fastId: null, safeId: null, frontierIds: [], hasDistinctAlternative: false };
  const selection = selectOptimizedRoute(pool, fast, mode, avoidance, maxExtraMinutes, policy, equivalent);
  const hasDistinctAlternative = !equivalent(fast.route, selection.safe.route)
    && selection.safe.paveMeters < fast.paveMeters
    && selection.safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
  const safe = hasDistinctAlternative ? selection.safe : fast;
  return {
    fastId: fast.id,
    safeId: safe.id,
    rawSafeId: selection.safe.id,
    frontierIds: selection.frontier.map((item) => item.id),
    hasDistinctAlternative,
    legalIds: pool.filter((item) => isLegalCandidate(item, mode)).map((item) => item.id),
  };
}

/** Production legality verdict for a normalised candidate. */
export function productionIsLegal(candidate, mode) {
  return isLegalCandidate(toOptimizationCandidate(candidate), mode);
}
