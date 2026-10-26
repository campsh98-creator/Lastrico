import { NextRequest, NextResponse } from "next/server";
import bundledPave from "@/data/milan-pave-central.json";
import {
  isTransportMode,
  type RoutingProfileMetadata,
  type TransportMode,
} from "@/lib/routing-types";
import {
  createSurfaceIndex,
  scoreSurfaceExposure,
  type SurfaceIndex,
  type SurfaceScore,
} from "@/lib/cobblestone-scoring";
import {
  combinedTimeoutSignal,
  fetchEngineRoutes,
  ROUTE_BUDGET_MS,
  NAVIGATION_ROUTE_BUDGET_MS,
  type EngineRoute,
} from "@/lib/routing-providers";
import { parseExtraMinutes, routeFitsExtraMinutes } from "@/lib/route-time-budget";

import { routesAreEquivalent as equivalentRoutes, deduplicateRoutes as uniqueRoutes } from "@/lib/route-candidates";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";
type PaveWay = {
  id: number;
  tags?: { name?: string; surface?: string; highway?: string };
  geometry?: Array<{ lat: number; lon: number }>;
};

type PaveDetail = {
  id: number;
  name: string;
  surface: string;
  coordinates: Coordinate[];
};

type ScoredRoute = {
  route: EngineRoute;
  paveMeters: number;
  riskMeters: number;
  surfaceScore: SurfaceScore;
  source: string;
};

type ModePolicy = {
  surfaceHighways: string;
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

const MILAN_BOUNDS = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
};

const MOTOR_HIGHWAYS = "^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track)$";
const BICYCLE_HIGHWAYS = "^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track|cycleway|path|pedestrian|footway)$";

const MODE_POLICY: Record<TransportMode, ModePolicy> = {
  car: {
    surfaceHighways: MOTOR_HIGHWAYS,
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
    surfaceHighways: MOTOR_HIGHWAYS,
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
    surfaceHighways: BICYCLE_HIGHWAYS,
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
  if (lng < MILAN_BOUNDS.west || lng > MILAN_BOUNDS.east || lat < MILAN_BOUNDS.south || lat > MILAN_BOUNDS.north) return null;
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

function segmentTouchesPave(a: Coordinate, b: Coordinate, paveWays: Coordinate[][], mode: TransportMode) {
  const midpoint: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const matchMeters = MODE_POLICY[mode].surfaceMatchMeters;
  for (const way of paveWays) {
    for (let index = 1; index < way.length; index += 1) {
      if (
        headingsAlign(a, b, way[index - 1], way[index])
        && pointToSegmentDistance(midpoint, way[index - 1], way[index]) <= matchMeters
      ) {
        return true;
      }
    }
  }
  return false;
}

function routesAreEquivalent(a: EngineRoute, b: EngineRoute, mode: TransportMode) {
  return equivalentRoutes(a, b, MODE_POLICY[mode]);
}

function deduplicateRoutes(routes: Array<{ route: EngineRoute; source: string }>, mode: TransportMode) {
  return uniqueRoutes(routes, MODE_POLICY[mode]);
}

function findDetourAnchor(route: EngineRoute, paveWays: Coordinate[][], mode: TransportMode) {
  const coordinates = route.coordinates;
  let best: { a: Coordinate; b: Coordinate; weight: number } | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (!segmentTouchesPave(a, b, paveWays, mode)) continue;
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
  const policy = MODE_POLICY[mode];
  const distinct = scored.filter((candidate) => !routesAreEquivalent(candidate.route, fast.route, mode));
  const limit = policy.limits[avoidance];
  const eligible = distinct.filter((candidate) =>
    candidate.route.duration <= fast.route.duration * limit.factor + limit.seconds
    && routeFitsExtraMinutes(candidate.route.duration, fast.route.duration, maximumExtraMinutes),
  );
  const reducing = eligible
    .filter((candidate) => candidate.riskMeters + policy.minimumPaveReduction <= fast.riskMeters)
    .sort((a, b) => {
      if (avoidance === "balanced") {
        const scoreA = a.route.duration / 60 + a.riskMeters / policy.balancedPaveDivisor;
        const scoreB = b.route.duration / 60 + b.riskMeters / policy.balancedPaveDivisor;
        return scoreA - scoreB;
      }
      return a.riskMeters - b.riskMeters || a.route.duration - b.route.duration;
    });
  return reducing[0] ?? fast;
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
    cyclewayMeters: surfaceScore.cyclewayMeters ?? 0,
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

let cachedBaseIndex: SurfaceIndex | null = null;
function getBaseSurfaceIndex(): SurfaceIndex {
  if (!cachedBaseIndex) {
    cachedBaseIndex = createSurfaceIndex(bundledPave as PaveDetail[]);
  }
  return cachedBaseIndex;
}

export async function GET(request: NextRequest) {
  const calculationStartedAt = performance.now();
  const navigationRequest = request.nextUrl.searchParams.get("navigation") === "1";
  const deadline = Date.now() + (navigationRequest ? NAVIGATION_ROUTE_BUDGET_MS : ROUTE_BUDGET_MS);
  const start = parseCoordinate(request.nextUrl.searchParams.get("start"));
  const end = parseCoordinate(request.nextUrl.searchParams.get("end"));
  const avoidance = (request.nextUrl.searchParams.get("avoid") ?? "strong") as Avoidance;
  const maximumExtraMinutes = parseExtraMinutes(request.nextUrl.searchParams.get("maxExtraMinutes"));
  const requestedMode = request.nextUrl.searchParams.get("mode") ?? "car";
  if (
    !start
    || !end
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
  const padding = 0.02;
  const south = Math.max(MILAN_BOUNDS.south, Math.min(start[1], end[1]) - padding);
  const west = Math.max(MILAN_BOUNDS.west, Math.min(start[0], end[0]) - padding);
  const north = Math.min(MILAN_BOUNDS.north, Math.max(start[1], end[1]) + padding);
  const east = Math.min(MILAN_BOUNDS.east, Math.max(start[0], end[0]) + padding);
  const overpassQuery = `[out:json][timeout:20];way["highway"~"${policy.surfaceHighways}"]["surface"~"^(sett|cobblestone|unhewn_cobblestone|paving_stones)$"](${south},${west},${north},${east});out tags geom;`;
  // Candidates may leave the endpoint rectangle; score against the full local snapshot.
  const localPave = bundledPave as PaveDetail[];

  try {
    const [baseRoutes, overpassResponse] = await Promise.all([
      fetchEngineRoutes([start, end], mode, true, deadline, request.signal),
      navigationRequest
        ? Promise.resolve(null)
        : fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
            },
            body: new URLSearchParams({ data: overpassQuery }),
            cache: "no-store",
            signal: combinedTimeoutSignal(request.signal, 650),
          }).catch(() => null),
    ]);
    const baseRoutingReadyAt = performance.now();
    if (!baseRoutes.length) throw new Error("Nessun percorso");

    let paveDetails: PaveDetail[] = localPave;
    let dataSource = "archivio OSM locale";
    if (overpassResponse?.ok) {
      try {
        const overpass = await overpassResponse.json() as { elements?: PaveWay[] };
        const livePave = (overpass.elements ?? [])
          .filter((way) =>
            way && Number.isSafeInteger(way.id) && way.id > 0
            && typeof way.tags?.surface === "string"
            && ["sett", "cobblestone", "unhewn_cobblestone", "paving_stones"].includes(way.tags.surface)
            && Array.isArray(way.geometry) && way.geometry.length > 1
            && way.geometry.every((point) => point
              && typeof point.lon === "number" && typeof point.lat === "number"
              && Number.isFinite(point.lon) && Number.isFinite(point.lat)
              && point.lon >= MILAN_BOUNDS.west && point.lon <= MILAN_BOUNDS.east
              && point.lat >= MILAN_BOUNDS.south && point.lat <= MILAN_BOUNDS.north))
          .map((way) => ({
            id: way.id,
            name: typeof way.tags?.name === "string" ? way.tags.name : "Strada senza nome",
            surface: way.tags?.surface ?? "pavé",
            coordinates: way.geometry!.map((point) => [point.lon, point.lat] as Coordinate),
          }));
        if (livePave.length) {
          const merged = new Map<number, PaveDetail>(paveDetails.map((way) => [way.id, way]));
          livePave.forEach((way) => merged.set(way.id, way));
          paveDetails = [...merged.values()];
          dataSource = "archivio OSM locale + aggiornamento live";
        }
      } catch {
        dataSource = "archivio OSM locale";
      }
    }
    const paveWays = paveDetails.map((way) => way.coordinates);
    const surfaceIndex = paveDetails === localPave
      ? getBaseSurfaceIndex()
      : createSurfaceIndex(paveDetails);
    const scoreCache = new Map<EngineRoute, SurfaceScore>();
    const scoreCandidate = (route: EngineRoute) => {
      const cached = scoreCache.get(route);
      if (cached) return cached;
      const score = scoreSurfaceExposure(
        route.coordinates,
        surfaceIndex,
        policy.surfaceMatchMeters,
      );
      scoreCache.set(route, score);
      return score;
    };
    const scoredCandidate = (route: EngineRoute, source: string): ScoredRoute => {
      const surfaceScore = scoreCandidate(route);
      return {
        route,
        source,
        paveMeters: surfaceScore.paveMeters,
        riskMeters: surfaceScore.weightedPaveMeters,
        surfaceScore,
      };
    };

    const fastestBase = [...baseRoutes].sort((a, b) => a.duration - b.duration)[0];
    const baseScored: ScoredRoute[] = baseRoutes.map((route, index) =>
      scoredCandidate(route, `base-${index + 1}`));
    const preliminaryFast = [...baseScored].sort((a, b) => a.route.duration - b.route.duration)[0];
    const preliminarySafe = selectSafeRoute(
      baseScored,
      preliminaryFast,
      avoidance,
      mode,
      maximumExtraMinutes,
    );
    const baseAlreadyImproves = !routesAreEquivalent(
      preliminaryFast.route,
      preliminarySafe.route,
      mode,
    ) && preliminarySafe.riskMeters + policy.minimumPaveReduction <= preliminaryFast.riskMeters;
    const detourResponses: EngineRoute[][] = [];
    // No candidate can reduce known exposure when the fastest has none.
    if (!baseAlreadyImproves && preliminaryFast.riskMeters >= policy.minimumPaveReduction) {
      const anchor = findDetourAnchor(fastestBase, paveWays, mode);
      const baseOffset = Math.max(
        policy.detourMinimumMeters,
        Math.min(policy.detourMaximumMeters, fastestBase.distance * policy.detourDistanceFactor),
      );
      const detourPoints = [
        offsetPoint(anchor.a, anchor.b, baseOffset),
        offsetPoint(anchor.a, anchor.b, -baseOffset),
        offsetPoint(anchor.a, anchor.b, baseOffset * 1.55),
        offsetPoint(anchor.a, anchor.b, -baseOffset * 1.55),
      ].filter((point): point is Coordinate => Boolean(point));
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
        const provisionalRoutes = [...baseRoutes, ...detourResponses.flat()];
        const provisionalScored: ScoredRoute[] = provisionalRoutes.map((route, index) =>
          scoredCandidate(route, `provisional-${index + 1}`));
        const provisionalFast = [...provisionalScored]
          .sort((a, b) => a.route.duration - b.route.duration)[0];
        const provisionalSafe = selectSafeRoute(
          provisionalScored,
          provisionalFast,
          avoidance,
          mode,
          maximumExtraMinutes,
        );
        if (
          !routesAreEquivalent(provisionalFast.route, provisionalSafe.route, mode)
          && provisionalSafe.riskMeters + policy.minimumPaveReduction <= provisionalFast.riskMeters
        ) {
          break;
        }
      }
    }
    const candidates = deduplicateRoutes([
      ...baseRoutes.map((route, index) => ({ route, source: `base-${index + 1}` })),
      ...detourResponses.flatMap((routes, index) =>
        routes.map((route) => ({ route, source: `detour-${index + 1}` })),
      ),
    ], mode);
    const scored: ScoredRoute[] = candidates.map((candidate) =>
      scoredCandidate(candidate.route, candidate.source));
    const fast = [...scored].sort((a, b) => a.route.duration - b.route.duration)[0];
    const safe = selectSafeRoute(scored, fast, avoidance, mode, maximumExtraMinutes);
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, safe.route, mode)
      && safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
    const budgetExcludedLowerExposureRoute = maximumExtraMinutes !== null
      && !hasDistinctAlternative
      && scored.some((candidate) =>
        !routesAreEquivalent(candidate.route, fast.route, mode)
        && candidate.riskMeters + policy.minimumPaveReduction <= fast.riskMeters
        && !routeFitsExtraMinutes(
          candidate.route.duration,
          fast.route.duration,
          maximumExtraMinutes,
        ));
    const routeCountLabel = `${scored.length} ${scored.length === 1 ? "percorso reale" : "percorsi reali"}`;
    const comparedLabel = scored.length === 1 ? "confrontato" : "confrontati";
    const checkedLabel = scored.length === 1 ? "controllato" : "controllati";

    const relevantPave = paveDetails
      .filter((way) => {
        const displayedCoordinates = [...fast.route.coordinates, ...safe.route.coordinates];
        return displayedCoordinates.some((point) =>
          way.coordinates.some((_, index) =>
            index > 0 && pointToSegmentDistance(point, way.coordinates[index - 1], way.coordinates[index]) <= 18,
          ),
        );
      })
      .slice(0, 70);

    const routingProfile = profileMetadata(mode, fast.route, safe.route);
    const bicycleCoverageNotice = mode === "bicycle" && dataSource === "archivio OSM locale"
      ? " La copertura locale dei fondi ciclabili può essere incompleta finché Overpass non risponde"
      : "";
    const calculationCompletedAt = performance.now();
    const routeProblemSegments = (route: EngineRoute) => relevantPave
      .filter((way) => route.coordinates.some((point) =>
        way.coordinates.some((_, index) =>
          index > 0 && pointToSegmentDistance(point, way.coordinates[index - 1], way.coordinates[index]) <= 18,
        ),
      ))
      .map((way) => way.coordinates);

    return NextResponse.json({
      fast: routePayload(fast.route, fast.surfaceScore, routeProblemSegments(fast.route)),
      safe: routePayload(safe.route, safe.surfaceScore, routeProblemSegments(safe.route)),
      problemSegments: relevantPave.map((way) => way.coordinates),
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
      candidateDiagnostics: scored.map((candidate) => ({
        source: candidate.source,
        provider: candidate.route.provider,
        profile: candidate.route.profile,
        distance: Math.round(candidate.route.distance),
        seconds: Math.round(candidate.route.duration),
        paveMeters: candidate.paveMeters,
        pavePercent: candidate.surfaceScore.pavePercent,
        weightedPaveMeters: candidate.riskMeters,
        surfaceConfidence: candidate.surfaceScore.confidence,
        surfaceClassificationConfidence: candidate.surfaceScore.classificationConfidence,
        surfaceDataConfidence: candidate.surfaceScore.dataConfidence,
        unknownSurfaceMeters: candidate.surfaceScore.unknownMeters,
        surfaceCoveragePercent: candidate.surfaceScore.matchedCoveragePercent,
        smoothSurfaceMeters: candidate.surfaceScore.smoothMeters ?? 0,
        cyclewayMeters: candidate.surfaceScore.cyclewayMeters ?? 0,
        matchedSurfaceFeatures: candidate.surfaceScore.matchedFeatures,
        detourPercent: fast.route.duration > 0
          ? Math.round(((candidate.route.duration / fast.route.duration) - 1) * 1_000) / 10
          : 0,
        distinctFromFast: !routesAreEquivalent(candidate.route, fast.route, mode),
      })),
      dataNotice: (
        !paveWays.length
          ? "Dati sul pavé non disponibili: mostro soltanto il percorso rapido"
          : budgetExcludedLowerExposureRoute
            ? `Nessuna deviazione con meno pavé rispetta il limite di +${maximumExtraMinutes} minuti: mantengo il percorso rapido`
          : hasDistinctAlternative
            ? `${routeCountLabel} ${comparedLabel}; ${Math.max(
                fast.surfaceScore.matchedFeatures,
                safe.surfaceScore.matchedFeatures,
              )} way OSM abbinate al percorso (${dataSource})`
            : `${routeCountLabel} ${checkedLabel}: nessuna deviazione riduce l’esposizione nota (${dataSource})`
      ) + bicycleCoverageNotice + ". I tratti senza classificazione restano sconosciuti: zero pavé noto non significa fondo liscio",
    }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
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
