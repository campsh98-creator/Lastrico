import { NextRequest, NextResponse } from "next/server";
import { getSpatialRoadStore } from "@/lib/spatial-road-store";
import { areaForCoordinate, coordinateInArea } from "@/lib/pilot-areas";
import {
  isTransportMode,
  type RoutingProfileMetadata,
  type TransportMode,
} from "@/lib/routing-types";
import {
  EdgeMemo,
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
  encodePolyline6,
  pointDistanceMeters,
} from "@/lib/surface-aware-routing";
import { fetchValhallaCustomizedRoute, fetchValhallaRouteExcluding } from "@/lib/routing-providers";
import { buildRoughSections } from "@/lib/rough-sections";
import { logRouteFailure } from "@/lib/server-log";

import { routesShareCorridor, deduplicateRoutes as uniqueRoutes } from "@/lib/route-candidates";
import { roadFeaturesAlongRoute } from "@/lib/road-features";
import { formatDeparture, parseLocalDeparture, romeDeparture, type DepartureTime } from "@/lib/access-conditions";
import { MILAN_ZTL_AREAS } from "@/lib/ztl-access";
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
  /** Phase 4.31: the ZTL areas (active now, not authorised) that every route had to cross. */
  ztlAreas: string[] = [];
}

function noLegalRoute(candidates: { surfaceScore: SurfaceScore }[]) {
  const error = new NoLegalRouteError("Nessun percorso compatibile con le restrizioni note");
  error.ztlAreas = [...new Set(candidates.flatMap((candidate) => Object.keys(candidate.surfaceScore.ztlMetersByArea ?? {})))];
  return error;
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

function polylineLength(points: Coordinate[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += pointDistanceMeters(points[index - 1], points[index]);
  return total;
}

// Phase 4.33: bounding boxes of the penalised slices. A point farther than 8 m from a slice's box
// is farther than 8 m from every one of its segments, so those slices are skipped without
// changing the answer.
const sliceBoxes = new WeakMap<Coordinate[], { minLon: number; maxLon: number; minLat: number; maxLat: number }>();
function sliceBox(slice: Coordinate[]) {
  let box = sliceBoxes.get(slice);
  if (!box) {
    box = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
    for (const [lon, lat] of slice) {
      if (lon < box.minLon) box.minLon = lon;
      if (lon > box.maxLon) box.maxLon = lon;
      if (lat < box.minLat) box.minLat = lat;
      if (lat > box.maxLat) box.maxLat = lat;
    }
    sliceBoxes.set(slice, box);
  }
  return box;
}

/** A rough stretch already penalised from another route (≥80% of it within 8 m). */
function sliceAlreadyPenalised(slice: Coordinate[], penalised: Coordinate[][]) {
  if (!penalised.length) return false;
  let near = 0;
  let total = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const length = segmentLength(slice[index - 1], slice[index]);
    const samples = Math.max(1, Math.ceil(length / 10));
    for (let sample = 0; sample < samples; sample += 1) {
      const ratio = (sample + 0.5) / samples;
      const point: Coordinate = [
        slice[index - 1][0] + (slice[index][0] - slice[index - 1][0]) * ratio,
        slice[index - 1][1] + (slice[index][1] - slice[index - 1][1]) * ratio,
      ];
      total += length / samples;
      // 8 m in degrees at this point's latitude (the projection pointToSegmentDistance uses), with 1 % to spare.
      const padLat = (8 / 110_540) * 1.01;
      const padLon = (8 / (111_320 * Math.cos(point[1] * Math.PI / 180))) * 1.01;
      if (penalised.some((other) => {
        const box = sliceBox(other);
        if (point[0] < box.minLon - padLon || point[0] > box.maxLon + padLon
          || point[1] < box.minLat - padLat || point[1] > box.maxLat + padLat) return false;
        return other.some((_, k) => k > 0 && pointToSegmentDistance(point, other[k - 1], other[k]) <= 8);
      })) near += length / samples;
    }
  }
  return total > 0 && near / total >= 0.8;
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
  areaId = "",
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
    terminalWalkMeters: surfaceScore.terminalWalkMeters,
    instructions: route.instructions,
    problemSegments,
    // Phase 4.29: merged rough sections positioned along this geometry, for navigation warnings.
    roughSections: buildRoughSections(route.coordinates, surfaceScore.roughSegmentIndices, surfaceScore.confirmedRoughSegmentIndices,
      undefined, undefined, surfaceScore.roughSegmentFeatures),
    // Phase 4.31: OSM-mapped traffic signals and signs on this geometry, with their coverage.
    roadFeatures: roadFeaturesAlongRoute(areaId, route.coordinates),
    // Phase 4.31: ZTL and time-window access met on this route, at the request's departure time.
    ...(surfaceScore.ztlMetersByArea ? { access: {
      ztl: Object.entries(surfaceScore.ztlMetersByArea).map(([id, meters]) => ({ id, name: ztlName(id), meters })),
      authorisedZtl: Object.entries(surfaceScore.authorisedZtlMetersByArea ?? {}).map(([id, meters]) => ({ id, name: ztlName(id), meters })),
      terminalZtlMeters: surfaceScore.terminalZtlMeters ?? 0,
      timedClosureMeters: surfaceScore.timedClosureMeters ?? 0,
      unknownConditionMeters: surfaceScore.unknownConditionMeters ?? 0,
    } } : {}),
  };
}

/** Phase 4.31: what the person must know about ZTLs on the shown route. */
function ztlNotice(score: SurfaceScore, departure: DepartureTime | undefined) {
  if (!departure) return "";
  const at = formatDeparture(departure);
  const terminal = Object.keys(score.ztlMetersByArea ?? {});
  const authorised = Object.keys(score.authorisedZtlMetersByArea ?? {});
  const parts: string[] = [];
  if ((score.terminalZtlMeters ?? 0) > 0 && terminal.length) {
    parts.push(`. Partenza o destinazione in ${terminal.map(ztlName).join(", ")}, attiva ${at}: serve un'autorizzazione`);
  }
  if (authorised.length) parts.push(`. Attraversa ${authorised.map(ztlName).join(", ")} con la tua autorizzazione`);
  return parts.join("");
}

/**
 * A closed ring of half-width `halfWidth` metres around `slice`, shortened by `trim` metres at
 * each end; null when the stretch is too short to keep anything after trimming.
 */
function corridorRing(slice: Coordinate[], halfWidth: number, trim: number): Coordinate[] | null {
  const kx = 111_320 * Math.cos((slice[0][1] * Math.PI) / 180);
  const ky = 110_540;
  const xy = slice.map(([lon, lat]) => [lon * kx, lat * ky]);
  const lengths = [0];
  for (let i = 1; i < xy.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const total = lengths[lengths.length - 1];
  if (total <= 2 * trim + 2) return null;
  const at = (m: number) => {
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < m) i += 1;
    const span = lengths[i] - lengths[i - 1] || 1;
    const t = (m - lengths[i - 1]) / span;
    return [xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * t, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * t];
  };
  const centre: number[][] = [at(trim), ...xy.filter((_, i) => lengths[i] > trim && lengths[i] < total - trim), at(total - trim)];
  const left: number[][] = [];
  const right: number[][] = [];
  for (let i = 0; i < centre.length; i += 1) {
    const a = centre[Math.max(0, i - 1)];
    const b = centre[Math.min(centre.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const norm = Math.hypot(dx, dy) || 1;
    const nx = (-dy / norm) * halfWidth, ny = (dx / norm) * halfWidth;
    left.push([centre[i][0] + nx, centre[i][1] + ny]);
    right.push([centre[i][0] - nx, centre[i][1] - ny]);
  }
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return ring.map(([x, y]) => [Number((x / kx).toFixed(7)), Number((y / ky).toFixed(7))] as Coordinate);
}

function ztlName(id: string) {
  return MILAN_ZTL_AREAS.find((area) => area.id === id)?.name ?? "Accesso con permesso (zona non registrata)";
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
  // Phase 4.31: departure time (Milan local, "YYYY-MM-DDTHH:MM"; now when absent) and the ZTL
  // areas the person is authorised for in this mode. Unknown area ids are ignored.
  const departureParam = request.nextUrl.searchParams.get("departure");
  const parsedDeparture = parseLocalDeparture(departureParam);
  const authorisedZtl = new Set((request.nextUrl.searchParams.get("ztl") ?? "").split(",")
    .map((id) => id.trim()).filter((id) => MILAN_ZTL_AREAS.some((area) => area.id === id)));
  const requestedMode = request.nextUrl.searchParams.get("mode") ?? "car";
  if (
    !start
    || !end
    || !area || !coordinateInArea(end, area)
    || (requestedArea !== null && requestedArea !== area.id)
    || !["balanced", "strong", "maximum"].includes(avoidance)
    || maximumExtraMinutes === undefined
    || !isTransportMode(requestedMode)
    || (departureParam !== null && parsedDeparture === null)
  ) {
    return NextResponse.json(
      { error: "Coordinate, modalità di trasporto o livello di evitamento non validi." },
      { status: 400 },
    );
  }
  const mode = requestedMode;
  const policy = MODE_POLICY[mode];
  // ZTL areas and time windows are Milan data; Rome and Roccella keep their established checks.
  const departure: DepartureTime | undefined = area.id === "milan" ? parsedDeparture ?? romeDeparture(new Date()) : undefined;
  if (segmentLength(start, end) < MINIMUM_ROUTE_METERS) {
    return NextResponse.json(
      { error: "Partenza e destinazione coincidono. Scegli due punti diversi.", mode, transportMode: mode },
      { status: 422 },
    );
  }

  try {
    const spatialRoadStore = await getSpatialRoadStore(area.id);
    const rawBaseRoutes = await fetchEngineRoutes([start, end], mode, true, deadline, request.signal);
    const baseRoutingReadyAt = performance.now();
    if (!rawBaseRoutes.length) throw new Error("Nessun percorso");

    // Prune provider alternate routes that exceed Lastrico policy or budget limits.
    // Such orbital detours (e.g. 26km highway loops for a 4km city trip) are never eligible under
    // Lastrico's time budgets and waste edge CPU time hydrating and scoring outer regions.
    const primary = rawBaseRoutes[0];
    const maxAllowedFactor = (policy.limits.maximum.factor ?? 1.7) * 1.15;
    const maxAllowedDuration = primary.duration * maxAllowedFactor + (policy.limits.maximum.seconds ?? 600) + 60;
    const baseRoutes = rawBaseRoutes.filter((r) => {
      if (r === primary) return true;
      if (r.distance > primary.distance * maxAllowedFactor) return false;
      if (r.duration > maxAllowedDuration) return false;
      if (maximumExtraMinutes !== null && !routeFitsExtraMinutes(r.duration, primary.duration, maximumExtraMinutes)) {
        return false;
      }
      return true;
    });

    const corridorCoords: Coordinate[] = baseRoutes.flatMap((r) => r.coordinates);
    const loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 50);
    // Preload only the tiles intersecting the initial base route corridors
    await spatialRoadStore.preloadTiles(loadedTileKeys);
    const scoped = spatialRoadStore.getScopedIntelligence(corridorCoords, 50);

    const ensureRouteCovered = async (routeCoordinates: Coordinate[]) => {
      const missing = spatialRoadStore.getMissingTileKeys(loadedTileKeys, routeCoordinates, 50);
      if (missing.length > 0) {
        await spatialRoadStore.preloadTiles(missing);
        for (const key of missing) {
          loadedTileKeys.push(key);
          if (typeof scoped.addTileKey === "function") {
            scoped.addTileKey(key);
          }
        }
      }
      return scoped.surfaceIndex;
    };

    const scoreCache = new Map<EngineRoute, SurfaceScore>();
    // Phase 4.33: candidates share most of their edges (46 % of sampled work on the Milan
    // benchmark); each shared edge is matched once per request, with identical results.
    const edgeMemo = new EdgeMemo();
    const scoreOptions = { terminalWalkingForBicycle: area.id === "milan", departure, authorisedZtl, edgeMemo };
    const scoreCandidate = (route: EngineRoute) => {
      const cached = scoreCache.get(route);
      if (cached) return cached;
      const intelligence = scoreRoadIntelligence(
        route.coordinates,
        scoped.surfaceIndex,
        policy.surfaceMatchMeters,
        mode,
        false,
        // Validated on the Milan benchmark only; Rome and Roccella keep their 4.23 behaviour.
        scoreOptions,
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
    // Phase 4.31: the provider does not know the departure time or the person's ZTL permits. When
    // its fastest route crosses an unauthorised ZTL or a stretch closed at this hour, ask once for
    // a route that avoids exactly those stretches (the linear cost factors of the pavé search).
    const accessBlocked = baseScored[0]?.surfaceScore.accessBlockedSegmentIndices;
    if (departure && accessBlocked && accessBlocked.size > 0 && primary.provider === "valhalla-fossgis"
      && !request.signal.aborted && deadline - Date.now() >= 2_500) {
      const blockedSlices = extractRoughSlices(primary.coordinates, (_prev, _curr, idx) => accessBlocked.has(idx), 5);
      // Excluded outright, as a thin ring along the inner part of each stretch, so the streets that
      // cross its ends stay usable (a cost penalty alone let the provider keep the closed street).
      const rings = blockedSlices.map((slice) => corridorRing(slice, 4, 6)).filter((ring): ring is Coordinate[] => ring !== null).slice(0, 8);
      if (rings.length > 0) {
        const avoiding = await fetchValhallaRouteExcluding([start, end], mode, rings,
          Math.min(deadline - 1_000, Date.now() + 3_500), request.signal);
        if (avoiding) {
          await ensureRouteCovered(avoiding.coordinates);
          baseRoutes.push(avoiding);
          baseScored.push(scoredCandidate(avoiding, "access-aware-valhalla"));
        }
      }
    }
    const preliminaryFast = fastestLegalCandidate(baseScored, mode);
    if (!preliminaryFast) throw noLegalRoute(baseScored);
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
    // Phase 4.31 release gate: an improvement found among the provider's alternates stops the
    // search only when it is cheap. Porta Romana (field case E): the alternate saved the stones of
    // Viale Sabotino for +383 s, so the penalised search never ran, and the route along Viale
    // Filippetti (same stones avoided, about the same time) was never generated.
    const improvesCheaply = (candidate: ScoredRoute, fastest: ScoredRoute) => improvesEnough(candidate, fastest)
      && candidate.route.duration - fastest.route.duration <= Math.max(90, fastest.route.duration * 0.08);
    const baseAlreadyImproves = improvesCheaply(preliminarySafe, preliminaryFast);
    const detourResponses: EngineRoute[][] = [];
    const surfaceAwareRoutes: EngineRoute[] = [];
    let pendingRefinement: { shape: string; factor: number }[] | null = null;
    let surfaceAwareDirectMetrics: { roughSlicesCount: number; penalizedMeters: number } | null = null;
    // Phase 4.31: whether the anti-pavé search really ran, so "no alternative" is never confused
    // with a search that failed or did not run.
    let surfaceAwareAttempted = false;
    let surfaceAwareFailed = false;
    // The stones were only in stretches too short to target (under 25 m): nothing to search for.
    let surfaceAwareNothingToTarget = false;

    const canGenerate = !baseAlreadyImproves && maximumExtraMinutes !== 0
      && preliminaryFast.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction;
    // One bounded provider-cost attempt. Phase 4.31: navigation runs it too, so a reroute keeps
    // optimising the rest of the journey for comfort with the planner's own generator (one extra
    // paced provider call, ~1.2 s, inside the navigation budget); before, a reroute fell back to
    // the provider's alternates and at most one detour waypoint.
    if (canGenerate
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
      if (factors.length === 0) surfaceAwareNothingToTarget = true;
      if (factors.length > 0) {
        surfaceAwareDirectMetrics = {
          roughSlicesCount: factors.length,
          penalizedMeters: totalPenalizedMeters,
        };
        // The established penalised search, unchanged: its candidate always stays in the pool.
        surfaceAwareAttempted = true;
        const first = await fetchValhallaCustomizedRoute(
          [start, end],
          mode,
          factors,
          Math.min(deadline - 2_000, Date.now() + 3_500),
          request.signal,
        );
        if (!first) surfaceAwareFailed = true;
        if (first) {
          await ensureRouteCovered(first.coordinates);
          surfaceAwareRoutes.push(first);
          // Phase 4.25: penalising only the fastest route's stones often moved the provider onto a
          // parallel stone street (Milan benchmark: the median penalised candidate kept all its
          // confirmed pavé). When it still keeps half the stone, a refinement also penalises the
          // stones seen on the other legal provider routes and on that candidate. It runs after the
          // established detours, and only if they too leave half the stone: it only adds a
          // candidate. Every shape is provider geometry, so Valhalla can walk it.
          const firstScored = scoredCandidate(first, "surface-aware-valhalla");
          if (!isLegalCandidate(firstScored, mode) || firstScored.surfaceScore.weightedPaveMeters >= Math.max(
            policy.minimumPaveReduction, preliminaryFast.surfaceScore.weightedPaveMeters * 0.5)) {
            const penalised = roughSlices.filter((slice) => factors.some((factor) => factor.shape === encodePolyline6(slice)));
            const seen = [...roughSlices, ...[...baseScored.filter((candidate) => candidate !== preliminaryFast), firstScored]
              .filter((candidate) => isLegalCandidate(candidate, mode))
              .flatMap((candidate) => {
                const indices = candidate.surfaceScore.roughSegmentIndices;
                return indices && indices.size > 0
                  ? extractRoughSlices(candidate.route.coordinates, (_prev, _curr, idx) => indices.has(idx), 25) : [];
              })]
              .sort((a, b) => polylineLength(b) - polylineLength(a));
            for (const slice of seen) {
              if (penalised.length >= 12) break;
              if (!sliceAlreadyPenalised(slice, penalised)) penalised.push(slice);
            }
            const refined = buildLinearCostFactors(penalised, 15.0, 12);
            if (refined.factors.length > factors.length) pendingRefinement = refined.factors;
          }
        }
      }
    }
    const surfaceAwareSourcesOf = () => surfaceAwareRoutes.map((route, index) => ({
      route, source: index === 0 ? "surface-aware-valhalla" : `surface-aware-valhalla-${index + 1}`,
    }));

    const directScored = [...baseScored, ...surfaceAwareSourcesOf().map(({ route, source }) => scoredCandidate(route, source))];
    const directFast = fastestLegalCandidate(directScored, mode)!;
    const directSafe = selectSafeRoute(directScored, directFast, avoidance, mode, maximumExtraMinutes);
    // Retain waypoint fallback if direct search fails to produce a sufficient distinct alternative.
    if (canGenerate && !(directSafe !== directFast && improvesEnough(directSafe, directFast))) {
      const anchor = findDetourAnchor(
        fastestBase,
        preliminaryFast.surfaceScore.roughSegmentIndices,
        undefined,
        mode,
      );
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
        if (deadline - Date.now() < (navigationRequest ? 2_200 : 1_500)) break;
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
          ...surfaceAwareRoutes,
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
    // The refinement stays planner-only: a reroute has to answer within its latency budget.
    if (pendingRefinement && (!navigationRequest || surfaceAwarePoc) && deadline - Date.now() >= 4_000 && !request.signal.aborted) {
      const pool = [...baseRoutes, ...surfaceAwareRoutes, ...detourResponses.flat()]
        .map((route, index) => scoredCandidate(route, `refinement-check-${index + 1}`));
      const poolFast = fastestLegalCandidate(pool, mode)!;
      const poolSafe = selectSafeRoute(pool, poolFast, avoidance, mode, maximumExtraMinutes);
      if (poolSafe.surfaceScore.weightedPaveMeters >= Math.max(
        policy.minimumPaveReduction, poolFast.surfaceScore.weightedPaveMeters * 0.5)) {
        const refinedRoute = await fetchValhallaCustomizedRoute(
          [start, end],
          mode,
          pendingRefinement,
          Math.min(deadline - 2_000, Date.now() + 3_500),
          request.signal,
        );
        if (refinedRoute) {
          await ensureRouteCovered(refinedRoute.coordinates);
          surfaceAwareRoutes.push(refinedRoute);
        }
      }
    }
    const generated = [
      ...baseRoutes.map((route, index) => ({ route, source: `base-${index + 1}` })),
      ...surfaceAwareSourcesOf(),
      ...detourResponses.flatMap((routes, index) =>
        routes.map((route) => ({ route, source: `detour-${index + 1}` })),
      ),
    ];
    const candidates = deduplicateRoutes(generated.filter((candidate) => isLegalCandidate(scoredCandidate(candidate.route, candidate.source), mode)), mode);
    const scored: ScoredRoute[] = candidates.map((candidate) =>
      scoredCandidate(candidate.route, candidate.source));
    const fast = fastestLegalCandidate(scored, mode);
    if (!fast) throw noLegalRoute(scored);
    // Rome's anti-sampietrini option must save confirmed stone exposure, not only
    // probable paving_stones or unpaved risk. Keep established cities unchanged.
    const selectable = area.id === "rome" ? scored.filter((candidate) => candidate === fast
      || candidate.surfaceScore.confirmedMeters + policy.minimumPaveReduction <= fast.surfaceScore.confirmedMeters) : scored;
    const selection = selectOptimizedRoute(selectable, fast, mode, avoidance, maximumExtraMinutes, policy,
      (a, b) => routesAreEquivalent(a, b, mode));
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, selection.safe.route, mode)
      && selection.safe.paveMeters < fast.paveMeters
      && selection.safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
    const safe = hasDistinctAlternative ? selection.safe : fast;
    // Phase 4.31 release gate: why the shown route is what it is, in terms the person can act on.
    const standard = baseScored[0];
    const standardLegal = Boolean(standard) && isLegalCandidate(standard, mode);
    const illegalLowerPave = generated.some((candidate) => {
      const candidateScore = scoredCandidate(candidate.route, candidate.source);
      return !isLegalCandidate(candidateScore, mode) && candidateScore.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
    });
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
    // The fastest legal route can itself be the anti-pavé result (the penalised search found a
    // route that avoids the provider's stones and is not slower): it is then said, not hidden
    // behind a "Più rapido" label.
    const fastAvoidsStandard = standardLegal && fast.route !== standard.route
      && standard.riskMeters - fast.riskMeters >= policy.minimumPaveReduction;
    const antiPaveStatus = hasDistinctAlternative ? "alternative"
      : fastAvoidsStandard ? "fastest-avoids-pave"
        : fast.surfaceScore.weightedPaveMeters < policy.minimumPaveReduction ? "no-pave"
          : budgetExcludedLowerExposureRoute || (maximumExtraMinutes === 0 && fast.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction) ? "over-extra-time"
            : illegalLowerPave ? "access-restricted"
              : surfaceAwareFailed ? "generation-failed"
                : canGenerate && !surfaceAwareAttempted && !surfaceAwareNothingToTarget ? "generation-skipped"
                  : "no-better-route";
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
    // Name the route that needs it: the fastest and the anti-pavé route can end on different streets.
    const fastWalk = fast.surfaceScore.terminalWalkMeters;
    const safeWalk = safe.surfaceScore.terminalWalkMeters;
    const walkRoute = fastWalk > 0 && safeWalk > 0 ? "" : fastWalk > 0 ? "Percorso più rapido: " : "Percorso anti-pavé: ";
    const terminalWalkNotice = fastWalk > 0 || safeWalk > 0
      ? `. ${walkRoute}${walkRoute ? "p" : "P"}artenza o arrivo su una via pedonale chiusa alle bici secondo OpenStreetMap: per circa ${Math.max(fastWalk, safeWalk)} m scendi e prosegui a piedi`
      : "";
    const calculationCompletedAt = performance.now();

    return NextResponse.json({
      area: area.id,
      fast: routePayload(fast.route, fast.surfaceScore, fastProblemSegments, area.id),
      safe: routePayload(safe.route, safe.surfaceScore, safeProblemSegments, area.id),
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
      // Phase 4.31 release gate: the anti-pavé outcome, and the provider's own (standard) route it
      // is measured against.
      antiPave: {
        status: antiPaveStatus,
        standard: standard ? {
          source: standard.source,
          legal: standardLegal,
          seconds: Math.round(standard.route.duration),
          meters: Math.round(standard.route.distance),
          paveMeters: standard.surfaceScore.paveMeters,
          confirmedPaveMeters: standard.surfaceScore.confirmedMeters,
        } : null,
        avoidedVsStandardMeters: standard && standardLegal ? Math.max(0, standard.surfaceScore.paveMeters - safe.surfaceScore.paveMeters) : null,
        search: { attempted: surfaceAwareAttempted, failed: surfaceAwareFailed, generated: surfaceAwareRoutes.length },
      },
      optimization: {
        strategy: "pareto-conservative-unknown",
        frontierSize: selection.frontier.length,
        unknownMeterPenalty: 1,
        directCandidateGenerated: surfaceAwareRoutes.length > 0,
        directCandidates: surfaceAwareRoutes.length,
      },
      candidateDiagnostics: scored.map((candidate) => ({
        eligibleModeAndAccess: isLegalCandidate(candidate, mode),
        confirmedRestrictionMeters: candidate.surfaceScore.confirmedRestrictionMeters,
        blockingRestrictionMeters: candidate.surfaceScore.blockingRestrictionMeters,
        terminalPrivateAccessMeters: candidate.surfaceScore.terminalPrivateAccessMeters,
        terminalWalkMeters: candidate.surfaceScore.terminalWalkMeters,
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
        // Phase 4.31: the surface split and the selection rule that decided this candidate.
        confirmedPaveMeters: candidate.surfaceScore.confirmedMeters,
        probablePaveMeters: candidate.surfaceScore.probableMeters,
        selectionVerdict: selection.verdicts.get(candidate) ?? null,
        selectionBurden: Math.round(selection.scores.get(candidate)?.burden ?? 0),
        selectionUtility: Math.round(selection.scores.get(candidate)?.utility ?? 0),
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
          applied: scored.some((c) => c.source.startsWith("surface-aware-valhalla") && c.route === safe.route),
          candidateGenerated: surfaceAwareRoutes.length > 0,
          penalizedMeters: surfaceAwareDirectMetrics?.penalizedMeters ?? 0,
          roughSlicesCount: surfaceAwareDirectMetrics?.roughSlicesCount ?? 0,
        },
      } : {}),
      ...(departure ? { accessContext: { departure: formatDeparture(departure), authorisedZtl: [...authorisedZtl].sort() } } : {}),
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
      ) + bicycleCoverageNotice + terminalAccessNotice + terminalWalkNotice + ztlNotice(safe.surfaceScore, departure)
        + ". I tratti senza classificazione restano sconosciuti: zero pavé noto non significa fondo liscio"
        + (area.id === "rome"
          ? mode === "bicycle"
            ? ". Roma: verifica segnaletica e accessi locali; il percorso non certifica tutte le restrizioni aggiornate"
            : ". Roma: accesso ZTL, orari e permessi non verificati. Controlla Centro Storico, Trastevere e Tridente A1; le limitazioni del Tridente riguardano anche le moto"
          : ""),
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
          error: error.ztlAreas.length
            ? `Ogni percorso trovato entra in ${error.ztlAreas.map(ztlName).join(", ")}, attiva in questo orario. Se hai l'autorizzazione, attivala in Preferenze › Accessi ZTL; altrimenti scegli un punto fuori dalla zona.`
            : "Tutti i percorsi trovati attraversano tratti vietati secondo OpenStreetMap. Prova una partenza o una destinazione vicina.",
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
