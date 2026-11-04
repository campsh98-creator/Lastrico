import { NextRequest, NextResponse } from "next/server";
import { getSpatialRoadStore } from "@/lib/spatial-road-store";
import { areaForCoordinate, coordinateInArea } from "@/lib/pilot-areas";
import {
  isTransportMode,
  type RoutingProfileMetadata,
  type TransportMode,
} from "@/lib/routing-types";
import {
  scoreRoadIntelligence,
  type RoadIntelligenceScore,
} from "@/lib/road-intelligence-scoring";
import {
  fetchEngineRoutes,
  ROUTE_BUDGET_MS,
  NAVIGATION_ROUTE_BUDGET_MS,
  type EngineRoute,
} from "@/lib/routing-providers";
import { parseExtraMinutes, routeFitsExtraMinutes } from "@/lib/route-time-budget";
import {
  extractRoughSlices,
  buildLinearCostFactors,
} from "@/lib/surface-aware-routing";
import { fetchValhallaCustomizedRoute } from "@/lib/routing-providers";
import { logRouteFailure } from "@/lib/server-log";

import { routesShareCorridor, deduplicateRoutes as uniqueRoutes } from "@/lib/route-candidates";
import { fastestLegalCandidate, isLegalCandidate, selectOptimizedRoute } from "@/lib/route-optimization";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";
type SurfaceScore = RoadIntelligenceScore & { confidence: number };
type ScoredRoute = {
  route: EngineRoute;
  paveMeters: number;
  riskMeters: number;
  surfaceScore: SurfaceScore;
  source: string;
};

// Provisional until field data exists: below this gain a planner request keeps looking.
const SUFFICIENT_PAVE_REDUCTION_METERS = 100;
const SUFFICIENT_PAVE_REDUCTION_RATIO = 0.25;

// Below this the two points are the same place, and there is nothing to navigate.
const MINIMUM_ROUTE_METERS = 15;

/** Retrying cannot help: every provider route contradicts explicit local access evidence. */
class NoLegalRouteError extends Error {
  override name = "NoLegalRouteError";
}

type ModePolicy = {
  surfaceMatchMeters: number;
  equivalentDistanceMeters: number;
  equivalentDurationSeconds: number;
  equivalentAverageMeters: number;
  detourMinimumMeters: number;
  detourMaximumMeters: number;
  detourDistanceFactor: number;
  balancedPaveDivisor: number;
  minimumPaveReduction: number;
  limits: Record<Avoidance, { factor: number; seconds: number }>;
};



const MODE_POLICY: Record<TransportMode, ModePolicy> = {
  car: {
    surfaceMatchMeters: 12,
    equivalentDistanceMeters: 120,
    equivalentDurationSeconds: 90,
    equivalentAverageMeters: 32,
    detourMinimumMeters: 380,
    detourMaximumMeters: 900,
    detourDistanceFactor: 0.1,
    balancedPaveDivisor: 500,
    minimumPaveReduction: 20,
    limits: {
      balanced: { factor: 1.22, seconds: 180 },
      strong: { factor: 1.42, seconds: 420 },
      maximum: { factor: 1.7, seconds: 720 },
    },
  },
  motorcycle: {
    surfaceMatchMeters: 11,
    equivalentDistanceMeters: 110,
    equivalentDurationSeconds: 75,
    equivalentAverageMeters: 30,
    detourMinimumMeters: 400,
    detourMaximumMeters: 1_050,
    detourDistanceFactor: 0.12,
    balancedPaveDivisor: 330,
    minimumPaveReduction: 15,
    limits: {
      balanced: { factor: 1.28, seconds: 240 },
      strong: { factor: 1.55, seconds: 540 },
      maximum: { factor: 1.9, seconds: 900 },
    },
  },
  bicycle: {
    surfaceMatchMeters: 9,
    equivalentDistanceMeters: 85,
    equivalentDurationSeconds: 75,
    equivalentAverageMeters: 24,
    detourMinimumMeters: 220,
    detourMaximumMeters: 650,
    detourDistanceFactor: 0.09,
    balancedPaveDivisor: 260,
    minimumPaveReduction: 12,
    limits: {
      balanced: { factor: 1.3, seconds: 300 },
      strong: { factor: 1.6, seconds: 720 },
      maximum: { factor: 2.1, seconds: 1_200 },
    },
  },
};

function parseCoordinate(value: string | null): Coordinate | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2 || parts.some((part) => !part.trim())) return null;
  const [lng, lat] = parts.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (!areaForCoordinate([lng, lat])) return null;
  return [lng, lat];
}

function toMeters(point: Coordinate, referenceLat: number) {
  return {
    x: point[0] * 111_320 * Math.cos(referenceLat * Math.PI / 180),
    y: point[1] * 110_540,
  };
}

function segmentLength(a: Coordinate, b: Coordinate) {
  const latitude = (a[1] + b[1]) / 2;
  const pa = toMeters(a, latitude);
  const pb = toMeters(b, latitude);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

function pointToSegmentDistance(point: Coordinate, a: Coordinate, b: Coordinate) {
  const latitude = point[1];
  const p = toMeters(point, latitude);
  const pa = toMeters(a, latitude);
  const pb = toMeters(b, latitude);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - pa.x, p.y - pa.y);
  const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (pa.x + t * dx), p.y - (pa.y + t * dy));
}

function headingsAlign(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate) {
  const latitude = (a[1] + b[1] + c[1] + d[1]) / 4;
  const pa = toMeters(a, latitude);
  const pb = toMeters(b, latitude);
  const pc = toMeters(c, latitude);
  const pd = toMeters(d, latitude);
  const routeX = pb.x - pa.x;
  const routeY = pb.y - pa.y;
  const wayX = pd.x - pc.x;
  const wayY = pd.y - pc.y;
  const denominator = Math.hypot(routeX, routeY) * Math.hypot(wayX, wayY);
  if (!denominator) return false;
  return Math.abs((routeX * wayX + routeY * wayY) / denominator) >= 0.58;
}

type PaveSegmentEntry = {
  wayIndex: number;
  a: Coordinate;
  b: Coordinate;
};

type PaveSpatialIndex = {
  cellSize: number;
  cells: Map<string, PaveSegmentEntry[]>;
};

function paveCellKey(cellX: number, cellY: number) {
  return `${cellX}:${cellY}`;
}

function segmentTouchesPave(a: Coordinate, b: Coordinate, paveIndex: PaveSpatialIndex, mode: TransportMode) {
  const midpoint: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const matchMeters = MODE_POLICY[mode].surfaceMatchMeters;
  const bucket = paveIndex.cells.get(
    paveCellKey(Math.floor(midpoint[0] / paveIndex.cellSize), Math.floor(midpoint[1] / paveIndex.cellSize)),
  );
  if (!bucket) return false;
  for (const seg of bucket) {
    if (
      headingsAlign(a, b, seg.a, seg.b)
      && pointToSegmentDistance(midpoint, seg.a, seg.b) <= matchMeters
    ) {
      return true;
    }
  }
  return false;
}

function routesAreEquivalent(a: EngineRoute, b: EngineRoute, mode: TransportMode) {
  return routesShareCorridor(a, b, MODE_POLICY[mode].equivalentAverageMeters);
}

function deduplicateRoutes(routes: Array<{ route: EngineRoute; source: string }>, mode: TransportMode) {
  return uniqueRoutes(routes, MODE_POLICY[mode]);
}

function findDetourAnchor(
  route: EngineRoute,
  roughIndices?: Set<number>,
  paveIndex?: PaveSpatialIndex,
  mode: TransportMode = "car",
) {
  const coordinates = route.coordinates;
  let best: { a: Coordinate; b: Coordinate; weight: number } | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (roughIndices && roughIndices.size > 0) {
      if (!roughIndices.has(index)) continue;
    } else if (paveIndex) {
      if (!segmentTouchesPave(a, b, paveIndex, mode)) continue;
    }
    const centrality = 1 - Math.abs(index / coordinates.length - 0.5);
    const weight = segmentLength(a, b) * (0.7 + centrality);
    if (!best || weight > best.weight) best = { a, b, weight };
  }
  if (best) return best;
  const middle = Math.max(1, Math.floor(coordinates.length / 2));
  return { a: coordinates[middle - 1], b: coordinates[middle], weight: 0 };
}

function offsetPoint(a: Coordinate, b: Coordinate, offsetMeters: number): Coordinate | null {
  const latitude = (a[1] + b[1]) / 2;
  const pa = toMeters(a, latitude);
  const pb = toMeters(b, latitude);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const midpoint: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const xOffset = (-dy / length) * offsetMeters;
  const yOffset = (dx / length) * offsetMeters;
  const candidate: Coordinate = [
    midpoint[0] + xOffset / (111_320 * Math.cos(latitude * Math.PI / 180)),
    midpoint[1] + yOffset / 110_540,
  ];
  return parseCoordinate(candidate.join(","));
}

function selectSafeRoute(
  scored: ScoredRoute[],
  fast: ScoredRoute,
  avoidance: Avoidance,
  mode: TransportMode,
  maximumExtraMinutes: number | null,
) {
  return selectOptimizedRoute(scored, fast, mode, avoidance, maximumExtraMinutes, MODE_POLICY[mode],
    (a, b) => routesAreEquivalent(a, b, mode)).safe;
}

function routePayload(
  route: EngineRoute,
  surfaceScore: SurfaceScore,
  problemSegments: Coordinate[][] = [],
) {
  return {
    coordinates: route.coordinates,
    distance: route.distance / 1_000,
    minutes: route.duration / 60,
    paveMeters: surfaceScore.paveMeters,
    pavePercent: surfaceScore.pavePercent,
    // Legacy category-weight alias, not overall data reliability.
    surfaceConfidence: surfaceScore.confidence,
    surfaceClassificationConfidence: surfaceScore.classificationConfidence,
    surfaceDataConfidence: surfaceScore.dataConfidence,
    unknownSurfaceMeters: surfaceScore.unknownMeters,
    surfaceCoveragePercent: surfaceScore.matchedCoveragePercent,
    confirmedPaveMeters: surfaceScore.confirmedMeters,
    probablePaveMeters: surfaceScore.probableMeters,
    smoothSurfaceMeters: surfaceScore.smoothMeters ?? 0,
    surfaceTotalMeters: surfaceScore.totalMeters,
    unpavedSurfaceMeters: surfaceScore.unpavedMeters,
    surfaceSource: "osm" as const,
    cyclewayMeters: surfaceScore.cyclewayMeters ?? 0,
    terminalPrivateAccessMeters: surfaceScore.terminalPrivateAccessMeters,
    instructions: route.instructions,
    problemSegments,
  };
}

function profileMetadata(
  mode: TransportMode,
  fast: EngineRoute,
  safe: EngineRoute,
): RoutingProfileMetadata {
  const fallbackUsed = [fast, safe].some((route) => route.provider === "osrm-public-fallback");
  const provider = fast.provider === safe.provider ? fast.provider : "mixed";
  if (mode === "motorcycle") {
    return {
      provider,
      profile: mode,
      beta: true,
      approximate: false,
      fallbackUsed: false,
      notice: "Profilo Valhalla Motorcycle beta: accessi e restrizioni dipendono dai dati OpenStreetMap.",
    };
  }
  if (mode === "bicycle") {
    return {
      provider,
      profile: mode,
      beta: true,
      approximate: false,
      fallbackUsed: false,
      notice: "Profilo ciclabile Valhalla: preferisce infrastrutture adatte ma non certifica la sicurezza del percorso.",
    };
  }
  return {
    provider,
    profile: fast.profile,
    beta: false,
    approximate: false,
    fallbackUsed,
    notice: fallbackUsed
      ? "Profilo auto OSRM usato come fallback temporaneo del routing Valhalla."
      : "Profilo auto Valhalla basato sulla rete OpenStreetMap.",
  };
}

function modeUnavailableMessage(mode: TransportMode) {
  if (mode === "bicycle") {
    return "Il routing ciclabile gratuito è temporaneamente indisponibile o non trova un collegamento legale. Non userò un percorso auto come sostituto.";
  }
  if (mode === "motorcycle") {
    return "Il profilo moto beta è temporaneamente indisponibile o non trova un collegamento legale. Non userò silenziosamente un percorso auto.";
  }
  return "Il routing gratuito è temporaneamente indisponibile. Riprova tra poco.";
}

export async function GET(request: NextRequest) {
  const calculationStartedAt = performance.now();
  const navigationRequest = request.nextUrl.searchParams.get("navigation") === "1";
  const surfaceAwarePoc = request.nextUrl.searchParams.get("poc") === "surface-aware";
  const deadline = Date.now() + (navigationRequest ? NAVIGATION_ROUTE_BUDGET_MS : ROUTE_BUDGET_MS);
  const start = parseCoordinate(request.nextUrl.searchParams.get("start"));
  const end = parseCoordinate(request.nextUrl.searchParams.get("end"));
  const area = start ? areaForCoordinate(start) : undefined;
  const requestedArea = request.nextUrl.searchParams.get("area");
  const avoidance = (request.nextUrl.searchParams.get("avoid") ?? "strong") as Avoidance;
  const maximumExtraMinutes = parseExtraMinutes(request.nextUrl.searchParams.get("maxExtraMinutes"));
  const requestedMode = request.nextUrl.searchParams.get("mode") ?? "car";
  if (
    !start
    || !end
    || !area || !coordinateInArea(end, area)
    || (requestedArea !== null && requestedArea !== area.id)
    || !["balanced", "strong", "maximum"].includes(avoidance)
    || maximumExtraMinutes === undefined
    || !isTransportMode(requestedMode)
  ) {
    return NextResponse.json(
      { error: "Coordinate, modalità di trasporto o livello di evitamento non validi." },
      { status: 400 },
    );
  }
  const mode = requestedMode;
  const policy = MODE_POLICY[mode];
  if (segmentLength(start, end) < MINIMUM_ROUTE_METERS) {
    return NextResponse.json(
      { error: "Partenza e destinazione coincidono. Scegli due punti diversi.", mode, transportMode: mode },
      { status: 422 },
    );
  }

  try {
    const spatialRoadStore = await getSpatialRoadStore(area.id);
    const baseRoutes = await fetchEngineRoutes([start, end], mode, true, deadline, request.signal);
    const baseRoutingReadyAt = performance.now();
    if (!baseRoutes.length) throw new Error("Nessun percorso");

    const corridorCoords: Coordinate[] = [start, end, ...baseRoutes.flatMap((r) => r.coordinates)];
    // Preload only the tiles intersecting the initial corridor
    let loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 50);
    await spatialRoadStore.preloadTiles(loadedTileKeys);
    let scoped = spatialRoadStore.getScopedIntelligence(corridorCoords, 50);

    const ensureRouteCovered = async (routeCoordinates: Coordinate[]) => {
      const missing = spatialRoadStore.getMissingTileKeys(loadedTileKeys, routeCoordinates, 50);
      if (missing.length > 0) {
        corridorCoords.push(...routeCoordinates);
        await spatialRoadStore.preloadTiles(missing);
        loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 50);
        scoped = spatialRoadStore.getScopedIntelligence(corridorCoords, 50);
      }
      return scoped.surfaceIndex;
    };

    const scoreCache = new Map<EngineRoute, SurfaceScore>();
    const scoreCandidate = (route: EngineRoute) => {
      const cached = scoreCache.get(route);
      if (cached) return cached;
      const intelligence = scoreRoadIntelligence(
        route.coordinates,
        scoped.surfaceIndex,
        policy.surfaceMatchMeters,
        mode,
      );
      const score: SurfaceScore = { ...intelligence, confidence: intelligence.classificationConfidence };
      scoreCache.set(route, score);
      return score;
    };
    const scoredCandidate = (route: EngineRoute, source: string): ScoredRoute => {
      const surfaceScore = scoreCandidate(route);
      return {
        route,
        source,
        paveMeters: surfaceScore.paveMeters,
        riskMeters: surfaceScore.weightedPaveMeters + surfaceScore.weightedUnpavedMeters,
        surfaceScore,
      };
    };

    const baseScored: ScoredRoute[] = baseRoutes.map((route, index) =>
      scoredCandidate(route, `base-${index + 1}`));
    const preliminaryFast = fastestLegalCandidate(baseScored, mode);
    if (!preliminaryFast) throw new NoLegalRouteError("Nessun percorso compatibile con le restrizioni note");
    const fastestBase = preliminaryFast.route;
    if (fastestBase.distance < MINIMUM_ROUTE_METERS) {
      return NextResponse.json(
        { error: "Partenza e destinazione coincidono. Scegli due punti diversi.", mode, transportMode: mode },
        { status: 422 },
      );
    }
    const preliminarySafe = selectSafeRoute(
      baseScored,
      preliminaryFast,
      avoidance,
      mode,
      maximumExtraMinutes,
    );
    // A small gain must not end the search for a much better route, except in navigation,
    // where a reroute has to stay fast.
    const improvesEnough = (candidate: ScoredRoute, fastest: ScoredRoute) =>
      !routesAreEquivalent(fastest.route, candidate.route, mode)
      && candidate.riskMeters + policy.minimumPaveReduction <= fastest.riskMeters
      && (navigationRequest || fastest.paveMeters - candidate.paveMeters >= Math.max(
        SUFFICIENT_PAVE_REDUCTION_METERS,
        fastest.paveMeters * SUFFICIENT_PAVE_REDUCTION_RATIO,
      ));
    const baseAlreadyImproves = improvesEnough(preliminarySafe, preliminaryFast);
    const detourResponses: EngineRoute[][] = [];
    let surfaceAwareDirectRoute: EngineRoute | null = null;
    let surfaceAwareDirectMetrics: { roughSlicesCount: number; penalizedMeters: number } | null = null;

    const canGenerate = !baseAlreadyImproves && maximumExtraMinutes !== 0
      && preliminaryFast.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction;
    // One bounded provider-cost attempt in planner; navigation keeps its existing latency budget.
    if (canGenerate && (!navigationRequest || surfaceAwarePoc)
      && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000 && preliminaryFast.surfaceScore.paveMeters > 0) {
      const fastRough = preliminaryFast.surfaceScore.roughSegmentIndices;
      const isSegmentRough = (prev: Coordinate, curr: Coordinate, idx: number) => {
        if (fastRough && fastRough.size > 0) {
          return fastRough.has(idx);
        }
        let end = curr;
        if (segmentLength(prev, curr) < 1) {
          const dx = curr[0] - prev[0];
          const dy = curr[1] - prev[1];
          const len = Math.hypot(dx, dy) || 1;
          end = [prev[0] + (dx / len) * 0.00002, prev[1] + (dy / len) * 0.00002];
        }
        return scoreRoadIntelligence([prev, end], scoped.surfaceIndex, policy.surfaceMatchMeters, mode, true).paveMeters > 0;
      };
      const roughSlices = extractRoughSlices(fastestBase.coordinates, isSegmentRough, 25);
      const { factors, totalPenalizedMeters } = buildLinearCostFactors(roughSlices, 15.0, 4);
      if (factors.length > 0) {
        surfaceAwareDirectMetrics = {
          roughSlicesCount: factors.length,
          penalizedMeters: totalPenalizedMeters,
        };
        surfaceAwareDirectRoute = await fetchValhallaCustomizedRoute(
          [start, end],
          mode,
          factors,
          Math.min(deadline - 2_000, Date.now() + 3_500),
          request.signal,
        );
        if (surfaceAwareDirectRoute) {
          await ensureRouteCovered(surfaceAwareDirectRoute.coordinates);
        }
      }
    }

    const directScored = surfaceAwareDirectRoute
      ? [...baseScored, scoredCandidate(surfaceAwareDirectRoute, "surface-aware-valhalla")] : baseScored;
    const directFast = fastestLegalCandidate(directScored, mode)!;
    const directSafe = selectSafeRoute(directScored, directFast, avoidance, mode, maximumExtraMinutes);
    // Retain waypoint fallback if direct search fails to produce a sufficient distinct alternative.
    if (canGenerate && !(directSafe !== directFast && improvesEnough(directSafe, directFast))) {
      const anchor = findDetourAnchor(fastestBase, preliminaryFast.surfaceScore.roughSegmentIndices, scoped.paveIndex, mode);
      const baseOffset = Math.max(
        policy.detourMinimumMeters,
        Math.min(policy.detourMaximumMeters, fastestBase.distance * policy.detourDistanceFactor),
      );
      const detourPoints = [
        offsetPoint(anchor.a, anchor.b, baseOffset),
        offsetPoint(anchor.a, anchor.b, -baseOffset),
        offsetPoint(anchor.a, anchor.b, baseOffset * 1.55),
        offsetPoint(anchor.a, anchor.b, -baseOffset * 1.55),
      ].filter((point): point is Coordinate => Boolean(point && coordinateInArea(point, area)));
      for (const point of detourPoints.slice(0, navigationRequest ? 1 : 3)) {
        if (deadline - Date.now() < 1_500) break;
        if (request.signal.aborted) break;
        const routes = await fetchEngineRoutes(
          [start, point, end],
          mode,
          false,
          deadline,
          request.signal,
        );
        detourResponses.push(routes);
        await ensureRouteCovered(routes.flatMap((r) => r.coordinates));
        const provisionalRoutes = [
          ...baseRoutes,
          ...(surfaceAwareDirectRoute ? [surfaceAwareDirectRoute] : []),
          ...detourResponses.flat(),
        ];
        const provisionalScored: ScoredRoute[] = provisionalRoutes.map((route, index) =>
          scoredCandidate(route, `provisional-${index + 1}`));
        const provisionalFast = fastestLegalCandidate(provisionalScored, mode)!;
        const provisionalSafe = selectSafeRoute(
          provisionalScored,
          provisionalFast,
          avoidance,
          mode,
          maximumExtraMinutes,
        );
        if (improvesEnough(provisionalSafe, provisionalFast)) break;
      }
    }
    const candidates = deduplicateRoutes([
      ...baseRoutes.map((route, index) => ({ route, source: `base-${index + 1}` })),
      ...(surfaceAwareDirectRoute ? [{ route: surfaceAwareDirectRoute, source: "surface-aware-valhalla" }] : []),
      ...detourResponses.flatMap((routes, index) =>
        routes.map((route) => ({ route, source: `detour-${index + 1}` })),
      ),
    ].filter((candidate) => isLegalCandidate(scoredCandidate(candidate.route, candidate.source), mode)), mode);
    const scored: ScoredRoute[] = candidates.map((candidate) =>
      scoredCandidate(candidate.route, candidate.source));
    const fast = fastestLegalCandidate(scored, mode);
    if (!fast) throw new NoLegalRouteError("Nessun percorso compatibile con le restrizioni note");
    const selection = selectOptimizedRoute(scored, fast, mode, avoidance, maximumExtraMinutes, policy,
      (a, b) => routesAreEquivalent(a, b, mode));
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, selection.safe.route, mode)
      && selection.safe.paveMeters < fast.paveMeters
      && selection.safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
    const safe = hasDistinctAlternative ? selection.safe : fast;
    const budgetExcludedLowerExposureRoute = maximumExtraMinutes !== null
      && !hasDistinctAlternative
      && scored.some((candidate) =>
        isLegalCandidate(candidate, mode)
        && !routesAreEquivalent(candidate.route, fast.route, mode)
        && candidate.riskMeters + policy.minimumPaveReduction <= fast.riskMeters
        && !routeFitsExtraMinutes(
          candidate.route.duration,
          fast.route.duration,
          maximumExtraMinutes,
        ));
    const routeCountLabel = `${scored.length} ${scored.length === 1 ? "percorso reale" : "percorsi reali"}`;
    const comparedLabel = scored.length === 1 ? "confrontato" : "confrontati";
    const checkedLabel = scored.length === 1 ? "controllato" : "controllati";

    // Drawn from the route itself with the classifier behind the metres shown on its card, so
    // the map and the numbers agree, and parallel or crossing streets are not painted as pave.
    const isSampleRough = (prev: Coordinate, curr: Coordinate) => {
      return scoreRoadIntelligence([prev, curr], scoped.surfaceIndex, policy.surfaceMatchMeters, mode, true).paveMeters > 0;
    };
    const routeProblemSegments = (route: EngineRoute, paveMeters: number, roughIndices?: Set<number>) => {
      if (paveMeters <= 0) return [];
      if (roughIndices && roughIndices.size > 0) {
        return extractRoughSlices(route.coordinates, (_prev, _curr, idx) => roughIndices.has(idx), 15);
      }
      return extractRoughSlices(route.coordinates, isSampleRough, 15);
    };
    const fastProblemSegments = routeProblemSegments(fast.route, fast.surfaceScore.paveMeters, fast.surfaceScore.roughSegmentIndices);
    const safeProblemSegments = safe.route === fast.route
      ? fastProblemSegments
      : routeProblemSegments(safe.route, safe.surfaceScore.paveMeters, safe.surfaceScore.roughSegmentIndices);

    const routingProfile = profileMetadata(mode, fast.route, safe.route);
    const bicycleCoverageNotice = mode === "bicycle"
      ? ". La copertura locale dei fondi ciclabili può essere incompleta"
      : "";
    const terminalAccessNotice = fast.surfaceScore.terminalPrivateAccessMeters + safe.surfaceScore.terminalPrivateAccessMeters > 0
      ? ". Partenza o arrivo su un tratto privato secondo OpenStreetMap: verifica di potervi accedere"
      : "";
    const calculationCompletedAt = performance.now();

    return NextResponse.json({
      area: area.id,
      fast: routePayload(fast.route, fast.surfaceScore, fastProblemSegments),
      safe: routePayload(safe.route, safe.surfaceScore, safeProblemSegments),
      problemSegments: safe.route === fast.route
        ? fastProblemSegments
        : [...fastProblemSegments, ...safeProblemSegments],
      alternativesAnalyzed: scored.length,
      hasDistinctAlternative,
      surfaceDataAvailable: (
        fast.surfaceScore.matchedFeatures + safe.surfaceScore.matchedFeatures
      ) > 0,
      mode,
      transportMode: mode,
      routingProfile,
      calculationMode: navigationRequest ? "navigation" : "planner",
      appliedPreferences: {
        avoidance,
        maximumExtraMinutes,
      },
      performance: {
        routingAndSurfaceDataMs: Math.round(baseRoutingReadyAt - calculationStartedAt),
        candidateGenerationAndScoringMs: Math.round(calculationCompletedAt - baseRoutingReadyAt),
        totalMs: Math.round(calculationCompletedAt - calculationStartedAt),
      },
      optimization: {
        strategy: "pareto-conservative-unknown",
        frontierSize: selection.frontier.length,
        unknownMeterPenalty: 1,
        directCandidateGenerated: surfaceAwareDirectRoute !== null,
      },
      candidateDiagnostics: scored.map((candidate) => ({
        eligibleModeAndAccess: isLegalCandidate(candidate, mode),
        confirmedRestrictionMeters: candidate.surfaceScore.confirmedRestrictionMeters,
        blockingRestrictionMeters: candidate.surfaceScore.blockingRestrictionMeters,
        terminalPrivateAccessMeters: candidate.surfaceScore.terminalPrivateAccessMeters,
        paretoOptimal: selection.frontier.includes(candidate),
        source: candidate.source,
        provider: candidate.route.provider,
        profile: candidate.route.profile,
        distance: Math.round(candidate.route.distance),
        seconds: Math.round(candidate.route.duration),
        paveMeters: candidate.paveMeters,
        pavePercent: candidate.surfaceScore.pavePercent,
        weightedPaveMeters: candidate.surfaceScore.weightedPaveMeters,
        riskMeters: candidate.riskMeters,
        surfaceConfidence: candidate.surfaceScore.confidence,
        surfaceClassificationConfidence: candidate.surfaceScore.classificationConfidence,
        surfaceDataConfidence: candidate.surfaceScore.dataConfidence,
        unknownSurfaceMeters: candidate.surfaceScore.unknownMeters,
        surfaceCoveragePercent: candidate.surfaceScore.matchedCoveragePercent,
        smoothSurfaceMeters: candidate.surfaceScore.smoothMeters ?? 0,
        surfaceTotalMeters: candidate.surfaceScore.totalMeters,
        unpavedSurfaceMeters: candidate.surfaceScore.unpavedMeters,
        cyclewayMeters: candidate.surfaceScore.cyclewayMeters ?? 0,
        matchedSurfaceFeatures: candidate.surfaceScore.matchedFeatures,
        detourPercent: fast.route.duration > 0
          ? Math.round(((candidate.route.duration / fast.route.duration) - 1) * 1_000) / 10
          : 0,
        distinctFromFast: !routesAreEquivalent(candidate.route, fast.route, mode),
      })),
      ...(surfaceAwarePoc ? {
        surfaceAwarePoc: {
          attempted: true,
          applied: scored.some((c) => c.source === "surface-aware-valhalla" && c.route === safe.route),
          candidateGenerated: surfaceAwareDirectRoute !== null,
          penalizedMeters: surfaceAwareDirectMetrics?.penalizedMeters ?? 0,
          roughSlicesCount: surfaceAwareDirectMetrics?.roughSlicesCount ?? 0,
        },
      } : {}),
      dataNotice: (
        fast.surfaceScore.matchedFeatures + safe.surfaceScore.matchedFeatures === 0
          ? "Dati sul pavé non disponibili: mostro soltanto il percorso rapido"
          : budgetExcludedLowerExposureRoute
            ? `Nessuna deviazione con meno pavé rispetta il limite di +${maximumExtraMinutes} minuti: mantengo il percorso rapido`
          : hasDistinctAlternative
            ? `${routeCountLabel} ${comparedLabel}; ${Math.max(
                fast.surfaceScore.matchedFeatures,
                safe.surfaceScore.matchedFeatures,
              )} way OSM abbinate al percorso (archivio OSM locale)`
            : `${routeCountLabel} ${checkedLabel}: nessuna deviazione migliora il compromesso tra tempo, pavé noto e tratti sconosciuti (archivio OSM locale)`
      ) + bicycleCoverageNotice + terminalAccessNotice + ". I tratti senza classificazione restano sconosciuti: zero pavé noto non significa fondo liscio",
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logRouteFailure(error, {
      mode,
      area: area.id,
      calculationMode: navigationRequest ? "navigation" : "planner",
    });
    if (error instanceof NoLegalRouteError) {
      return NextResponse.json(
        {
          error: "Tutti i percorsi trovati attraversano tratti vietati secondo OpenStreetMap. Prova una partenza o una destinazione vicina.",
          mode,
          transportMode: mode,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: modeUnavailableMessage(mode),
        mode,
        transportMode: mode,
      },
      { status: 503 },
    );
  }
}
