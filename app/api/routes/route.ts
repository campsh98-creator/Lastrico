import { NextRequest, NextResponse } from "next/server";
import { getSpatialRoadStore } from "@/lib/spatial-road-store";
import { areaForCoordinate, coordinateInArea } from "@/lib/pilot-areas";
import type { RoadSegmentRecord } from "@/lib/road-intelligence-types";
import { normalizeOsmFeature } from "@/scripts/osm/normalize.mjs";
import {
  isTransportMode,
  type RoutingProfileMetadata,
  type TransportMode,
} from "@/lib/routing-types";
import {
  createRoadIntelligenceIndex,
  scoreRoadIntelligence,
  type RoadIntelligenceIndex,
  type RoadIntelligenceScore,
} from "@/lib/road-intelligence-scoring";
import {
  combinedTimeoutSignal,
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
type PaveWay = {
  id: number;
  tags?: Record<string, string>;
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

function createPaveSpatialIndex(details: PaveDetail[], cellSize = 0.001): PaveSpatialIndex {
  const cells = new Map<string, PaveSegmentEntry[]>();
  const padLon = 0.0003;
  const padLat = 0.0002;
  details.forEach((way, wayIndex) => {
    for (let index = 1; index < way.coordinates.length; index += 1) {
      const a = way.coordinates[index - 1];
      const b = way.coordinates[index];
      const entry: PaveSegmentEntry = { wayIndex, a, b };
      const minCellX = Math.floor((Math.min(a[0], b[0]) - padLon) / cellSize);
      const maxCellX = Math.floor((Math.max(a[0], b[0]) + padLon) / cellSize);
      const minCellY = Math.floor((Math.min(a[1], b[1]) - padLat) / cellSize);
      const maxCellY = Math.floor((Math.max(a[1], b[1]) + padLat) / cellSize);
      for (let cx = minCellX; cx <= maxCellX; cx += 1) {
        for (let cy = minCellY; cy <= maxCellY; cy += 1) {
          const key = paveCellKey(cx, cy);
          const bucket = cells.get(key);
          if (bucket) {
            bucket.push(entry);
          } else {
            cells.set(key, [entry]);
          }
        }
      }
    }
  });
  return { cellSize, cells };
}

function filterNearPaveDetails(
  coordinates: Coordinate[],
  details: PaveDetail[],
  paveIndex: PaveSpatialIndex,
  maxDistanceMeters = 18,
): PaveDetail[] {
  const matchedWayIndices = new Set<number>();
  for (const point of coordinates) {
    const bucket = paveIndex.cells.get(
      paveCellKey(Math.floor(point[0] / paveIndex.cellSize), Math.floor(point[1] / paveIndex.cellSize)),
    );
    if (!bucket) continue;
    for (const seg of bucket) {
      if (matchedWayIndices.has(seg.wayIndex)) continue;
      if (pointToSegmentDistance(point, seg.a, seg.b) <= maxDistanceMeters) {
        matchedWayIndices.add(seg.wayIndex);
      }
    }
  }
  return details.filter((_, index) => matchedWayIndices.has(index));
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

function findDetourAnchor(route: EngineRoute, paveIndex: PaveSpatialIndex, mode: TransportMode) {
  const coordinates = route.coordinates;
  let best: { a: Coordinate; b: Coordinate; weight: number } | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (!segmentTouchesPave(a, b, paveIndex, mode)) continue;
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

// bundledRoads: loaded spatially via spatialRoadStore to eliminate memory bottleneck
function roughDetails(segments: RoadSegmentRecord[]): PaveDetail[] {
  return segments.filter((segment) => segment.osmWayId !== null &&
    (segment.surfaceCategory === "confirmed_rough" || segment.surfaceCategory === "probable_rough"))
    .map((segment) => ({
      id: segment.osmWayId!,
      name: segment.name ?? "Strada senza nome",
      surface: segment.surface.value ?? "unknown",
      coordinates: segment.coordinates,
    }));
}
let lastOverpassSnapshot: {
  key: string;
  roads: RoadSegmentRecord[];
  paveDetails: PaveDetail[];
  paveIndex: PaveSpatialIndex;
  surfaceIndex: RoadIntelligenceIndex;
  liveSegments: RoadSegmentRecord[];
} | null = null;

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
  const bounds = area.bounds;
  const padding = 0.02;
  const south = Math.max(bounds.south, Math.min(start[1], end[1]) - padding);
  const west = Math.max(bounds.west, Math.min(start[0], end[0]) - padding);
  const north = Math.min(bounds.north, Math.max(start[1], end[1]) + padding);
  const east = Math.min(bounds.east, Math.max(start[0], end[0]) + padding);
  const overpassQuery = `[out:json][timeout:20];way["highway"~"${policy.surfaceHighways}"](${south},${west},${north},${east});out tags geom;`;
  // Candidates may leave the endpoint rectangle; score against the full local snapshot.

  try {
    const spatialRoadStore = await getSpatialRoadStore(area.id);
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

    const corridorCoords: Coordinate[] = [start, end, ...baseRoutes.flatMap((r) => r.coordinates)];
    const scoped = spatialRoadStore.getScopedIntelligence(corridorCoords, 500);
    let roads = scoped.roads;
    let paveDetails: PaveDetail[] = scoped.paveDetails;
    let paveIndex: PaveSpatialIndex | null = null;
    let liveSurfaceIndex: RoadIntelligenceIndex | null = null;
    let liveSegmentsList: RoadSegmentRecord[] = [];
    let dataSource = "archivio OSM locale";
    if (overpassResponse?.ok) {
      try {
        const overpass = await overpassResponse.json() as { elements?: PaveWay[] };
        // A surface-unfiltered update can invalidate stale rough/smooth evidence.
        const liveWays = (Array.isArray(overpass.elements) ? overpass.elements : [])
          .filter((way) =>
            way && Number.isSafeInteger(way.id) && way.id > 0
            && way.tags && typeof way.tags.highway === "string"
            && Object.values(way.tags).every((value) => typeof value === "string")
            && Array.isArray(way.geometry) && way.geometry.length > 1
            && way.geometry.every((point) => point
              && typeof point.lon === "number" && typeof point.lat === "number"
              && Number.isFinite(point.lon) && Number.isFinite(point.lat)
              && point.lon >= bounds.west && point.lon <= bounds.east
              && point.lat >= bounds.south && point.lat <= bounds.north));
        if (liveWays.length) {
          const tileKeyStr = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 500).sort().join(";");
          const snapshotKey = `${area.id}:${tileKeyStr}:${JSON.stringify(liveWays)}`;
          if (lastOverpassSnapshot?.key === snapshotKey) {
            roads = lastOverpassSnapshot.roads;
            paveDetails = lastOverpassSnapshot.paveDetails;
            paveIndex = lastOverpassSnapshot.paveIndex;
            liveSurfaceIndex = lastOverpassSnapshot.surfaceIndex;
            liveSegmentsList = lastOverpassSnapshot.liveSegments;
          } else {
            const ingestedAt = new Date().toISOString();
            const liveSegments = liveWays.flatMap((way) =>
              normalizeOsmFeature(way, { ingestedAt }).segments) as RoadSegmentRecord[];
            liveSegmentsList = liveSegments;
            const replacedIds = new Set(liveSegments.map((segment) => segment.osmWayId));
            roads = [...scoped.roads.filter((segment) => !replacedIds.has(segment.osmWayId)), ...liveSegments];
            paveDetails = roughDetails(roads);
            paveIndex = createPaveSpatialIndex(paveDetails);
            liveSurfaceIndex = createRoadIntelligenceIndex(roads);
            lastOverpassSnapshot = {
              key: snapshotKey,
              roads,
              paveDetails,
              paveIndex,
              surfaceIndex: liveSurfaceIndex,
              liveSegments: liveSegmentsList,
            };
          }
          dataSource = "archivio OSM locale + aggiornamento live";
        }
      } catch {
        dataSource = "archivio OSM locale";
      }
    }
    let activePaveIndex = paveIndex ?? scoped.paveIndex;
    let surfaceIndex = roads === scoped.roads
      ? scoped.surfaceIndex
      : (liveSurfaceIndex ?? createRoadIntelligenceIndex(roads));
    let loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 500);

    const ensureRouteCovered = (routeCoordinates: Coordinate[]) => {
      const missing = spatialRoadStore.getMissingTileKeys(loadedTileKeys, routeCoordinates, 80);
      if (missing.length > 0) {
        corridorCoords.push(...routeCoordinates);
        loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 500);
        const expanded = spatialRoadStore.getScopedIntelligence(corridorCoords, 500);
        if (liveSegmentsList.length > 0) {
          const replacedIds = new Set(liveSegmentsList.map((segment) => segment.osmWayId));
          roads = [...expanded.roads.filter((segment) => !replacedIds.has(segment.osmWayId)), ...liveSegmentsList];
          paveDetails = roughDetails(roads);
          activePaveIndex = createPaveSpatialIndex(paveDetails);
          surfaceIndex = createRoadIntelligenceIndex(roads);
        } else {
          roads = expanded.roads;
          paveDetails = expanded.paveDetails;
          activePaveIndex = expanded.paveIndex;
          surfaceIndex = expanded.surfaceIndex;
        }
      }
      return surfaceIndex;
    };

    const scoreCache = new Map<EngineRoute, SurfaceScore>();
    const scoreCandidate = (route: EngineRoute) => {
      const cached = scoreCache.get(route);
      if (cached) return cached;
      const activeIdx = ensureRouteCovered(route.coordinates);
      const intelligence = scoreRoadIntelligence(
        route.coordinates,
        activeIdx,
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
        riskMeters: surfaceScore.weightedPaveMeters,
        surfaceScore,
      };
    };

    const baseScored: ScoredRoute[] = baseRoutes.map((route, index) =>
      scoredCandidate(route, `base-${index + 1}`));
    const preliminaryFast = fastestLegalCandidate(baseScored, mode);
    if (!preliminaryFast) throw new Error("Nessun percorso compatibile con le restrizioni note");
    const fastestBase = preliminaryFast.route;
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
    let surfaceAwareDirectRoute: EngineRoute | null = null;
    let surfaceAwareDirectMetrics: { roughSlicesCount: number; penalizedMeters: number } | null = null;

    const canGenerate = !baseAlreadyImproves && maximumExtraMinutes !== 0
      && preliminaryFast.riskMeters >= policy.minimumPaveReduction;
    // One bounded provider-cost attempt in planner; navigation keeps its existing latency budget.
    if (canGenerate && (!navigationRequest || surfaceAwarePoc)
      && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000) {
      const isSegmentRough = (prev: Coordinate, curr: Coordinate) => {
        let end = curr;
        if (segmentLength(prev, curr) < 1) {
          const dx = curr[0] - prev[0];
          const dy = curr[1] - prev[1];
          const len = Math.hypot(dx, dy) || 1;
          end = [prev[0] + (dx / len) * 0.00002, prev[1] + (dy / len) * 0.00002];
        }
        const mid: Coordinate = [(prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2];
        return scoreRoadIntelligence([prev, mid, end], surfaceIndex, policy.surfaceMatchMeters, mode).paveMeters > 0;
      };
      const roughSlices = fastestBase.maneuverShapes?.length
        ? fastestBase.maneuverShapes.flatMap((shape) => extractRoughSlices(shape, isSegmentRough, 25))
        : extractRoughSlices(fastestBase.coordinates, isSegmentRough, 25);
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
      }
    }

    const directScored = surfaceAwareDirectRoute
      ? [...baseScored, scoredCandidate(surfaceAwareDirectRoute, "surface-aware-valhalla")] : baseScored;
    const directFast = fastestLegalCandidate(directScored, mode)!;
    const directSafe = selectSafeRoute(directScored, directFast, avoidance, mode, maximumExtraMinutes);
    const directHasAdmissibleAlternative = directSafe !== directFast
      && !routesAreEquivalent(directSafe.route, directFast.route, mode);
    // Retain waypoint fallback if direct search fails to produce an admissible distinct alternative.
    if (canGenerate && !directHasAdmissibleAlternative) {
      const anchor = findDetourAnchor(fastestBase, activePaveIndex, mode);
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
      ...(surfaceAwareDirectRoute ? [{ route: surfaceAwareDirectRoute, source: "surface-aware-valhalla" }] : []),
      ...detourResponses.flatMap((routes, index) =>
        routes.map((route) => ({ route, source: `detour-${index + 1}` })),
      ),
    ].filter((candidate) => isLegalCandidate(scoredCandidate(candidate.route, candidate.source), mode)), mode);
    const scored: ScoredRoute[] = candidates.map((candidate) =>
      scoredCandidate(candidate.route, candidate.source));
    const fast = fastestLegalCandidate(scored, mode);
    if (!fast) throw new Error("Nessun percorso compatibile con le restrizioni note");
    const selection = selectOptimizedRoute(scored, fast, mode, avoidance, maximumExtraMinutes, policy,
      (a, b) => routesAreEquivalent(a, b, mode));
    const safe = selection.safe;
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, safe.route, mode)
      && safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
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

    const displayedCoordinates = fast.route === safe.route
      ? fast.route.coordinates
      : [...fast.route.coordinates, ...safe.route.coordinates];
    const relevantPave = filterNearPaveDetails(displayedCoordinates, paveDetails, activePaveIndex, 18).slice(0, 70);
    const relevantPaveIndex = createPaveSpatialIndex(relevantPave);
    const routeProblemSegments = (route: EngineRoute) =>
      filterNearPaveDetails(route.coordinates, relevantPave, relevantPaveIndex, 18)
        .map((way) => way.coordinates);
    const fastProblemSegments = routeProblemSegments(fast.route);
    const safeProblemSegments = safe.route === fast.route
      ? fastProblemSegments
      : routeProblemSegments(safe.route);

    const routingProfile = profileMetadata(mode, fast.route, safe.route);
    const bicycleCoverageNotice = mode === "bicycle" && dataSource === "archivio OSM locale"
      ? " La copertura locale dei fondi ciclabili può essere incompleta finché Overpass non risponde"
      : "";
    const calculationCompletedAt = performance.now();

    return NextResponse.json({
      area: area.id,
      fast: routePayload(fast.route, fast.surfaceScore, fastProblemSegments),
      safe: routePayload(safe.route, safe.surfaceScore, safeProblemSegments),
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
      optimization: {
        strategy: "pareto-conservative-unknown",
        frontierSize: selection.frontier.length,
        unknownMeterPenalty: 1,
        directCandidateGenerated: surfaceAwareDirectRoute !== null,
      },
      candidateDiagnostics: scored.map((candidate) => ({
        eligibleModeAndAccess: isLegalCandidate(candidate, mode),
        confirmedRestrictionMeters: candidate.surfaceScore.confirmedRestrictionMeters,
        paretoOptimal: selection.frontier.includes(candidate),
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
              )} way OSM abbinate al percorso (${dataSource})`
            : `${routeCountLabel} ${checkedLabel}: nessuna deviazione migliora il compromesso tra tempo, pavé noto e tratti sconosciuti (${dataSource})`
      ) + bicycleCoverageNotice + ". I tratti senza classificazione restano sconosciuti: zero pavé noto non significa fondo liscio",
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
