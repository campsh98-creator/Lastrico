import { NextRequest, NextResponse } from "next/server";
import { getSpatialRoadStore } from "@/lib/spatial-road-store";
import { silRailVertexIndices, silShadowDiagnostics } from "@/lib/sil-shadow";
import { chooseRailAware, silRailExperimentEnabled } from "@/lib/sil-rail-experiment";
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
  penalisedSliceMinimumMeters,
  pointDistanceMeters,
  refinesWhileStoneLeft,
  stopsOnlyWhenClean,
} from "@/lib/surface-aware-routing";
import { fetchValhallaCustomizedRoute, fetchValhallaRouteExcluding, withProviderTimeout, type ProviderMeter } from "@/lib/routing-providers";
import { TrafficSession } from "@/lib/traffic/session";
import type { RouteTraffic } from "@/lib/traffic/flow";
import { buildRoughSections } from "@/lib/rough-sections";
import { logRouteFailure } from "@/lib/server-log";

import { routesShareCorridor, deduplicateRoutes as uniqueRoutes } from "@/lib/route-candidates";
import { roadFeaturesAlongRoute } from "@/lib/road-features";
import { formatDeparture, parseLocalDeparture, romeDeparture, type DepartureTime } from "@/lib/access-conditions";
import { MILAN_ZTL_AREAS } from "@/lib/ztl-access";
import {
  fastestLegalCandidate,
  isLegalCandidate,
  selectOptimizedRoute,
  addsConfirmedPave,
  uTurnCount,
  U_TURN_PENALTY_SECONDS,
  type OptimizationPolicy,
} from "@/lib/route-optimization";

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
// Phase 4.37: hard ceiling on provider requests for one calculation. The per-isolate pacing (1.05 s), the
// deadline and the timeouts already bound a burst and nothing retries; the ceiling makes the bound explicit.
// Planner: base (1, or 2 when the OSRM fallback answered) + penalised search + refinement + three detours.
// Navigation: base + penalised search + one detour.
const MAX_PLANNER_PROVIDER_REQUESTS = 7;
const MAX_NAVIGATION_PROVIDER_REQUESTS = 4;
// Linear cost factor for a congested stretch in the penalised search (stone uses 15, tram rails 8). Provisional until
// field data exists; the penalised route is only used if it wins the traffic-adjusted comparison.
const TRAFFIC_COST_FACTOR = 6;

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
  /** Phase 4.37: seconds a U-turn costs when comparing routes (Milan only). */
  uTurnPenaltySeconds?: number;
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
  policy: OptimizationPolicy = MODE_POLICY[mode],
) {
  return selectOptimizedRoute(scored, fast, mode, avoidance, maximumExtraMinutes, policy,
    (a, b) => routesAreEquivalent(a, b, mode)).safe;
}

/** What the live-traffic layer says about one route; present only when traffic was requested and received. */
type RouteTrafficPayload = {
  freeMinutes: number;
  delaySeconds: number;
  coveragePercent: number;
  /** Slowest covered stretch as a percentage of free-flow speed. */
  slowestSpeedPercent: number | null;
  congestedMeters: number;
  closedMeters: number;
  delayShare: number;
  incidents: { category: string; magnitude: number; delaySeconds: number | null; description: string; position: Coordinate; lengthMeters: number | null }[];
};

function routePayload(
  route: EngineRoute,
  surfaceScore: SurfaceScore,
  problemSegments: Coordinate[][] = [],
  areaId = "",
  traffic?: RouteTrafficPayload,
) {
  return {
    ...(traffic ? { traffic } : {}),
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
  // Independent tram-track preference (local layers only; without them it is reported as unavailable and changes nothing).
  const tramPreference = request.nextUrl.searchParams.get("tram") === "avoid" || silRailExperimentEnabled();
  // Optional live traffic (provider tiles through the quota ledger, lib/traffic). Not requested: nothing below changes.
  const trafficRequested = request.nextUrl.searchParams.get("traffic") === "live";
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
  // Phase 4.37: Milan compares U-turn routes with a time penalty; other areas are unchanged.
  const policy: ModePolicy = area.id === "milan"
    ? { ...MODE_POLICY[mode], uTurnPenaltySeconds: U_TURN_PENALTY_SECONDS }
    : MODE_POLICY[mode];
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
    // Counts the provider requests really started (retry and fallback included) and refuses the
    // one past the limit, so the cap holds even when a call is repeated inside the provider layer.
    const meter: ProviderMeter = {
      requests: 0,
      limit: navigationRequest ? MAX_NAVIGATION_PROVIDER_REQUESTS : MAX_PLANNER_PROVIDER_REQUESTS,
    };
    const rawBaseRoutes = await fetchEngineRoutes([start, end], mode, true, deadline, request.signal, meter);
    const baseRoutingReadyAt = performance.now();
    if (!rawBaseRoutes.length) throw new Error("Nessun percorso");
    const providerRequestBudgetLeft = () => meter.requests < meter.limit;

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

    // Live traffic: the flow and incident tiles of the base routes are fetched while the road tiles load below.
    // Any failure leaves the session unavailable and every route keeps the provider's own time.
    const traffic = trafficRequested ? new TrafficSession(mode, { signal: request.signal }) : null;
    const trafficTimeoutMs = navigationRequest ? 1_200 : 2_500;
    const loadTraffic = (routes: Coordinate[][]) => traffic
      ? withProviderTimeout(request.signal, trafficTimeoutMs, (signal) => traffic.ensure(routes, signal)).catch(() => undefined)
      : Promise.resolve();
    const trafficLoading = loadTraffic(baseRoutes.map((r) => r.coordinates));
    const staticSeconds = new WeakMap<EngineRoute, number>();
    const trafficOf = new WeakMap<EngineRoute, RouteTraffic>();
    // Replaces a route's duration with the live-traffic one, once. Identity is kept (the selection compares routes by
    // reference); the provider's own time stays in `staticSeconds`.
    const applyTraffic = (route: EngineRoute) => {
      if (!traffic?.available || trafficOf.has(route)) return;
      const live = traffic.forRoute(route.coordinates, route.duration);
      staticSeconds.set(route, route.duration);
      trafficOf.set(route, live);
      route.duration = live.trafficSeconds;
    };

    const corridorCoords: Coordinate[] = baseRoutes.flatMap((r) => r.coordinates);
    const loadedTileKeys = spatialRoadStore.getTileKeysForCoordinates(corridorCoords, 50);
    // Preload only the tiles intersecting the initial base route corridors
    await spatialRoadStore.preloadTiles(loadedTileKeys);
    await trafficLoading;
    for (const route of baseRoutes) applyTraffic(route);
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

    // Live traffic for a route that appeared after the base routes: loads the few tiles it needs, then applies its time.
    const adoptTraffic = async (...routes: EngineRoute[]) => {
      if (!traffic?.available || !routes.length) return;
      await loadTraffic(routes.map((route) => route.coordinates));
      for (const route of routes) applyTraffic(route);
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
          Math.min(deadline - 1_000, Date.now() + 3_500), request.signal, meter);
        if (avoiding) {
          await ensureRouteCovered(avoiding.coordinates);
          await adoptTraffic(avoiding);
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
      policy,
    );
    // Live traffic: stretches of the fastest route below 60 % of free flow (150 m or more) are penalised in the same
    // provider request as stone and rails, so traffic, pavé and tram exposure are optimised together. Bicycles do not
    // feel the queue (delay share 0), so nothing is penalised for them.
    const congestionSlices = traffic?.available ? trafficOf.get(fastestBase)?.congestedSlices ?? [] : [];
    const trafficFactors = mode === "bicycle" ? [] : buildLinearCostFactors(congestionSlices, TRAFFIC_COST_FACTOR, 4).factors;
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
    // Phase 4.37 (Milan planner): a cheap improvement ends the search only when it leaves almost no
    // stone; otherwise the penalised search still runs (Phase 4.36, routing-forensics R3).
    const baseAlreadyImproves = improvesCheaply(preliminarySafe, preliminaryFast)
      && !(stopsOnlyWhenClean(area.id, navigationRequest) && preliminarySafe.riskMeters >= policy.minimumPaveReduction);
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
    // Phase 4.37 (Milan): a penalised-search route that adds confirmed stone to the provider's fastest route is
    // not an anti-pavé result, and must not become the fastest card (De Angeli → San Babila by motorcycle: +426 m of
    // confirmed stone for 27 s). It is dropped from the pool with the same rule the selection applies.
    let surfaceAwareDiscarded = 0;
    const keepsPenalisedRoute = (candidate: ScoredRoute) => area.id !== "milan" || !addsConfirmedPave(candidate, preliminaryFast);
    const sliceMinimumMeters = penalisedSliceMinimumMeters(area.id, policy.minimumPaveReduction);
    // "Maximum" avoidance in the Milan planner keeps refining while any stone is left (not only while half is).
    const refineWhileStoneLeft = refinesWhileStoneLeft(area.id, navigationRequest, avoidance);
    const refinementStoneThreshold = (fastWeightedPave: number) => refineWhileStoneLeft
      ? policy.minimumPaveReduction
      : Math.max(policy.minimumPaveReduction, fastWeightedPave * 0.5);

    const canGenerate = !baseAlreadyImproves && maximumExtraMinutes !== 0
      && preliminaryFast.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction;
    // One bounded provider-cost attempt. Phase 4.31: navigation runs it too, so a reroute keeps
    // optimising the rest of the journey for comfort with the planner's own generator (one extra
    // paced provider call, ~1.2 s, inside the navigation budget); before, a reroute fell back to
    // the provider's alternates and at most one detour waypoint.
    if (canGenerate
      && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000 && preliminaryFast.surfaceScore.paveMeters > 0 && providerRequestBudgetLeft()) {
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
      // Phase 4.37: Milan targets slices down to 15 m (24.99 m of Piazzale Lodi stone was under the old 25 m).
      const roughSlices = extractRoughSlices(fastestBase.coordinates, isSegmentRough, sliceMinimumMeters);
      const { factors, totalPenalizedMeters } = buildLinearCostFactors(roughSlices, 15.0, 4);
      if (factors.length === 0) surfaceAwareNothingToTarget = true;
      if (factors.length > 0) {
        surfaceAwareDirectMetrics = {
          roughSlicesCount: factors.length,
          penalizedMeters: totalPenalizedMeters,
        };
        // The established penalised search; in Milan its candidate stays in the pool unless it adds confirmed stone.
        surfaceAwareAttempted = true;
        const first = await fetchValhallaCustomizedRoute(
          [start, end],
          mode,
          [...factors, ...trafficFactors],
          Math.min(deadline - 2_000, Date.now() + 3_500),
          request.signal,
          meter,
        );
        if (!first) surfaceAwareFailed = true;
        if (first) {
          await ensureRouteCovered(first.coordinates);
          await adoptTraffic(first);
          // Phase 4.25: penalising only the fastest route's stones often moved the provider onto a
          // parallel stone street (Milan benchmark: the median penalised candidate kept all its
          // confirmed pavé). When it still keeps half the stone, a refinement also penalises the
          // stones seen on the other legal provider routes and on that candidate. It runs after the
          // established detours, and only if they too leave half the stone: it only adds a
          // candidate. Every shape is provider geometry, so Valhalla can walk it.
          const firstScored = scoredCandidate(first, "surface-aware-valhalla");
          if (keepsPenalisedRoute(firstScored)) surfaceAwareRoutes.push(first);
          else surfaceAwareDiscarded += 1;
          if (!isLegalCandidate(firstScored, mode) || firstScored.surfaceScore.weightedPaveMeters
            >= refinementStoneThreshold(preliminaryFast.surfaceScore.weightedPaveMeters)) {
            const penalised = roughSlices.filter((slice) => factors.some((factor) => factor.shape === encodePolyline6(slice)));
            const seen = [...roughSlices, ...[...baseScored.filter((candidate) => candidate !== preliminaryFast), firstScored]
              .filter((candidate) => isLegalCandidate(candidate, mode))
              .flatMap((candidate) => {
                const indices = candidate.surfaceScore.roughSegmentIndices;
                return indices && indices.size > 0
                  ? extractRoughSlices(candidate.route.coordinates, (_prev, _curr, idx) => indices.has(idx), sliceMinimumMeters) : [];
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
    // Tram-track avoidance: one more penalised search, built like the anti-pavé one from the slices of the fastest route that run
    // on mapped shared rails (plus its stone, so comfort is optimised together). Planner only; counts against the request budget.
    const railAwareRoutes: EngineRoute[] = [];
    let railGeneration: { attempted: boolean; slices: number; generated: boolean; reason: string } = { attempted: false, slices: 0, generated: false, reason: tramPreference ? "not-run" : "off" };
    if (tramPreference && area.id === "milan" && !navigationRequest && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000 && providerRequestBudgetLeft() && maximumExtraMinutes !== 0) {
      const railVertices = await silRailVertexIndices({ area: area.id, coordinates: fastestBase.coordinates, store: spatialRoadStore, loadedTileKeys });
      if (!railVertices) railGeneration.reason = "layers-unavailable";
      else {
        const railSlices = extractRoughSlices(fastestBase.coordinates, (_prev, _curr, idx) => railVertices.has(idx), 20, 30);
        railGeneration = { ...railGeneration, slices: railSlices.length, reason: railSlices.length ? "searching" : "no-rails-on-fastest" };
        if (railSlices.length) {
          const stoneSlices = extractRoughSlices(fastestBase.coordinates, (_prev, _curr, idx) => Boolean(preliminaryFast.surfaceScore.roughSegmentIndices?.has(idx)), sliceMinimumMeters);
          const factors = [...buildLinearCostFactors(stoneSlices, 15.0, 4).factors, ...buildLinearCostFactors(railSlices, 8.0, 6).factors, ...trafficFactors];
          railGeneration.attempted = true;
            const railRoute = await fetchValhallaCustomizedRoute([start, end], mode, factors, Math.min(deadline - 2_000, Date.now() + 3_500), request.signal, meter);
          if (!railRoute) railGeneration.reason = "provider-failed";
          else {
            await ensureRouteCovered(railRoute.coordinates);
            await adoptTraffic(railRoute);
            const railScored = scoredCandidate(railRoute, "rail-aware-valhalla");
            if (keepsPenalisedRoute(railScored)) { railAwareRoutes.push(railRoute); railGeneration = { ...railGeneration, generated: true, reason: "generated" }; }
            else railGeneration.reason = "adds-stone";
          }
        }
      }
    }
    // Traffic-only search: the fastest route runs into congestion, and no stone or rail search took the request already.
    const trafficAwareRoutes: EngineRoute[] = [];
    const trafficSearch = { attempted: false, generated: false, slices: trafficFactors.length };
    if (trafficFactors.length > 0 && !surfaceAwareAttempted && !railGeneration.attempted && maximumExtraMinutes !== 0
      && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000 && providerRequestBudgetLeft()) {
      trafficSearch.attempted = true;
      const route = await fetchValhallaCustomizedRoute([start, end], mode, trafficFactors, Math.min(deadline - 2_000, Date.now() + 3_500), request.signal, meter);
      if (route) {
        await ensureRouteCovered(route.coordinates);
        await adoptTraffic(route);
        if (keepsPenalisedRoute(scoredCandidate(route, "traffic-aware-valhalla"))) { trafficAwareRoutes.push(route); trafficSearch.generated = true; }
      }
    }
    const surfaceAwareSourcesOf = () => surfaceAwareRoutes.map((route, index) => ({
      route, source: index === 0 ? "surface-aware-valhalla" : `surface-aware-valhalla-${index + 1}`,
    }));

    const directScored = [...baseScored, ...surfaceAwareSourcesOf().map(({ route, source }) => scoredCandidate(route, source))];
    const directFast = fastestLegalCandidate(directScored, mode)!;
    const directSafe = selectSafeRoute(directScored, directFast, avoidance, mode, maximumExtraMinutes, policy);
    // Phase 4.37 (Milan planner): a penalised route that leaves almost no stone makes the geometric
    // via-point requests pointless (3 of 5 provider requests in the Phase 4.36 return replica).
    const penalisedRouteIsClean = stopsOnlyWhenClean(area.id, navigationRequest)
      && directSafe !== directFast && directSafe.riskMeters < policy.minimumPaveReduction;
    // Retain waypoint fallback if direct search fails to produce a sufficient distinct alternative.
    if (canGenerate && !penalisedRouteIsClean && !(directSafe !== directFast && improvesEnough(directSafe, directFast))) {
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
        if (request.signal.aborted || !providerRequestBudgetLeft()) break;
        const routes = await fetchEngineRoutes(
          [start, point, end],
          mode,
          false,
          deadline,
          request.signal,
          meter,
        );
        detourResponses.push(routes);
        await ensureRouteCovered(routes.flatMap((r) => r.coordinates));
        await adoptTraffic(...routes);
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
          policy,
        );
        if (improvesEnough(provisionalSafe, provisionalFast)) break;
      }
    }
    // The refinement stays planner-only: a reroute has to answer within its latency budget.
    if (pendingRefinement && (!navigationRequest || surfaceAwarePoc) && deadline - Date.now() >= 4_000 && !request.signal.aborted
      && providerRequestBudgetLeft()) {
      const pool = [...baseRoutes, ...surfaceAwareRoutes, ...detourResponses.flat()]
        .map((route, index) => scoredCandidate(route, `refinement-check-${index + 1}`));
      const poolFast = fastestLegalCandidate(pool, mode)!;
      const poolSafe = selectSafeRoute(pool, poolFast, avoidance, mode, maximumExtraMinutes, policy);
      if (poolSafe.surfaceScore.weightedPaveMeters >= refinementStoneThreshold(poolFast.surfaceScore.weightedPaveMeters)) {
        const refinedRoute = await fetchValhallaCustomizedRoute(
          [start, end],
          mode,
          [...pendingRefinement, ...trafficFactors],
          Math.min(deadline - 2_000, Date.now() + 3_500),
          request.signal,
          meter,
        );
        if (refinedRoute) {
          await ensureRouteCovered(refinedRoute.coordinates);
          await adoptTraffic(refinedRoute);
          if (keepsPenalisedRoute(scoredCandidate(refinedRoute, "surface-aware-valhalla-refined"))) surfaceAwareRoutes.push(refinedRoute);
          else surfaceAwareDiscarded += 1;
        }
      }
    }
    // Residual stone at "maximum" avoidance (Milan planner). A multiplicative penalty on a short slice is worth only a few seconds
    // (25 m of stone at 15x is about the same as a 250 m detour), so the penalised searches above hand back the same stone-bearing
    // route when a clean one costs a little more. One exclusion search around what is left asks for the route that really avoids it;
    // the selection then decides on time as usual. One provider request at most, inside the existing cap.
    const residualExclusion = { attempted: false, slices: 0, generated: false };
    if (refineWhileStoneLeft && fastestBase.provider === "valhalla-fossgis" && !request.signal.aborted
      && deadline - Date.now() >= 4_000 && providerRequestBudgetLeft()) {
      const pool = [...baseRoutes, ...surfaceAwareRoutes, ...detourResponses.flat()]
        .map((route, index) => scoredCandidate(route, `residual-check-${index + 1}`));
      const poolFast = fastestLegalCandidate(pool, mode);
      const poolSafe = poolFast ? selectSafeRoute(pool, poolFast, avoidance, mode, maximumExtraMinutes, policy) : null;
      const residualIndices = poolSafe?.surfaceScore.roughSegmentIndices;
      if (poolSafe && residualIndices && residualIndices.size > 0
        && poolSafe.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction) {
        const residualSlices = extractRoughSlices(poolSafe.route.coordinates, (_prev, _curr, idx) => residualIndices.has(idx), sliceMinimumMeters);
        const residualRings = residualSlices.map((slice) => corridorRing(slice, 4, 3)).filter((ring): ring is Coordinate[] => ring !== null).slice(0, 8);
        residualExclusion.slices = residualRings.length;
        if (residualRings.length > 0) {
          residualExclusion.attempted = true;
          const clean = await fetchValhallaRouteExcluding([start, end], mode, residualRings,
            Math.min(deadline - 2_000, Date.now() + 3_500), request.signal, meter);
          if (clean) {
            await ensureRouteCovered(clean.coordinates);
            await adoptTraffic(clean);
            if (keepsPenalisedRoute(scoredCandidate(clean, "surface-aware-valhalla-residual"))) {
              surfaceAwareRoutes.push(clean);
              residualExclusion.generated = true;
            } else surfaceAwareDiscarded += 1;
          }
        }
      }
    }
    const generated = [
      ...baseRoutes.map((route, index) => ({ route, source: `base-${index + 1}` })),
      ...surfaceAwareSourcesOf(),
      ...railAwareRoutes.map((route) => ({ route, source: "rail-aware-valhalla" })),
      ...trafficAwareRoutes.map((route) => ({ route, source: "traffic-aware-valhalla" })),
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
    let safe = hasDistinctAlternative ? selection.safe : fast;
    // EXPERIMENT (off by default, local layers only): tram rails as a separate dimension for two-wheelers.
    let railExperiment: unknown = null;
    if (tramPreference && area.id === "milan" && !navigationRequest) {
      const legal = scored.filter((candidate) => isLegalCandidate(candidate, mode));
      const evidence = await silShadowDiagnostics({
        area: area.id, store: spatialRoadStore, loadedTileKeys, force: true,
        routes: Object.fromEntries(legal.map((candidate, index) => [String(index), candidate.route.coordinates])),
      });
      if (evidence && evidence.status === "ok") {
        const diagnosticsOf = (index: number) => { const entry = evidence.routes[String(index)]; return entry && !("sameAs" in entry) ? entry : evidence.routes[(entry as { sameAs: string }).sameAs] as never; };
        const candidates = legal.map((candidate, index) => ({
          id: index, seconds: candidate.route.duration, paveMeters: candidate.paveMeters, riskMeters: candidate.riskMeters, diagnostics: diagnosticsOf(index),
        })).filter((candidate) => candidate.diagnostics && !("sameAs" in candidate.diagnostics));
        const choice = chooseRailAware(candidates, legal.indexOf(safe), fast.route.duration, maximumExtraMinutes);
        railExperiment = { ...choice, candidates: legal.length, processingMs: evidence.processingMs, generation: railGeneration };
        if (choice.replaced) safe = legal[choice.chosen];
      } else railExperiment = { replaced: false, reason: evidence ? "layers-" + evidence.status : "layers-off", generation: railGeneration };
    }
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
    // Live traffic, as received: per-route numbers and incidents only from routes the tiles were matched to.
    const trafficPayloadFor = (route: EngineRoute): RouteTrafficPayload | undefined => {
      const live = trafficOf.get(route);
      if (!traffic?.available || !live) return undefined;
      return {
        freeMinutes: (staticSeconds.get(route) ?? route.duration) / 60,
        delaySeconds: Math.round(live.delaySeconds),
        coveragePercent: live.coveragePercent,
        slowestSpeedPercent: live.minRatio === null ? null : Math.round(live.minRatio * 100),
        congestedMeters: live.congestedMeters,
        closedMeters: live.closedMeters,
        delayShare: live.delayShare,
        incidents: traffic.incidentsFor(route.coordinates).slice(0, 8),
      };
    };
    const trafficBlock = !trafficRequested ? undefined : traffic?.available ? {
      status: "live" as const,
      provider: "TomTom" as const,
      mode,
      delayShare: trafficOf.get(fast.route)?.delayShare ?? null,
      fetchedAt: traffic.meta().oldestTileAt === null ? null : new Date(traffic.meta().oldestTileAt as number).toISOString(),
      ageSeconds: traffic.meta().oldestTileAt === null ? null : Math.max(0, Math.round((Date.now() - (traffic.meta().oldestTileAt as number)) / 1_000)),
      tileRequests: traffic.meta().tileRequests,
      cachedTiles: traffic.meta().cachedTiles,
      flowZoom: traffic.meta().flowZoom,
      // Seconds the shown fastest route saves against the provider's standard route, with the same live traffic on both.
      savedVsStandardSeconds: standard && standard.route !== fast.route ? Math.round(standard.route.duration - fast.route.duration) : 0,
      search: trafficSearch,
      note: mode === "bicycle"
        ? "Il traffico dei veicoli non cambia il tempo in bici; sono mostrati solo incidenti e chiusure."
        : mode === "motorcycle"
          ? "Per la moto è contata metà del ritardo misurato sulle auto (stima)."
          : "Tempo con il traffico di ora; i tratti senza dato mantengono il tempo senza traffico.",
    } : {
      status: "unavailable" as const,
      provider: "TomTom" as const,
      reason: traffic?.unavailableReason ?? "unavailable",
    };
    const calculationCompletedAt = performance.now();
    // Phase 4.40: read-only SIL shadow diagnostics, computed after everything above is decided. Null (and the response
    // unchanged) unless the mode is "shadow" and the area is Milan. It never throws and never feeds back into routing.
    const silDiagnostics = await silShadowDiagnostics({
      area: area.id,
      store: spatialRoadStore,
      loadedTileKeys,
      routes: { fast: fast.route.coordinates, safe: safe.route.coordinates },
    });

    return NextResponse.json({
      area: area.id,
      fast: routePayload(fast.route, fast.surfaceScore, fastProblemSegments, area.id, trafficPayloadFor(fast.route)),
      safe: routePayload(safe.route, safe.surfaceScore, safeProblemSegments, area.id, trafficPayloadFor(safe.route)),
      ...(trafficBlock ? { traffic: trafficBlock } : {}),
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
        search: {
          attempted: surfaceAwareAttempted,
          failed: surfaceAwareFailed,
          generated: surfaceAwareRoutes.length,
          // Phase 4.37: how many stone slices were targeted, and whether none was long enough to target.
          slices: surfaceAwareDirectMetrics?.roughSlicesCount ?? 0,
          nothingToTarget: surfaceAwareNothingToTarget,
          // Phase 4.37: penalised routes dropped for adding confirmed stone, and provider requests used.
          discarded: surfaceAwareDiscarded,
          providerRequests: meter.requests,
          // Exclusion search around the stone the penalised searches left ("maximum" only): whether it ran and gave a route.
          residualExclusion,
        },
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
        // Phase 4.37: U-turn maneuvers in the candidate (a penalty in the selection, never a rejection).
        uTurnCount: uTurnCount(candidate.route),
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
      ...(silDiagnostics || railExperiment ? { diagnostics: { ...(silDiagnostics ? { sil: silDiagnostics } : {}), ...(railExperiment ? { silRailExperiment: railExperiment } : {}) } } : {}),
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
