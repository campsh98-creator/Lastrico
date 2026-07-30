import { NextRequest, NextResponse } from "next/server";
import bundledPave from "@/data/milan-pave-central.json";
import {
  isTransportMode,
  type RoutingProfileMetadata,
  type RoutingProviderName,
  type TransportMode,
} from "@/lib/routing-types";
import {
  createSurfaceIndex,
  scoreSurfaceExposure,
  type SurfaceScore,
} from "@/lib/cobblestone-scoring";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";
type SemanticDirection = "left" | "right" | "straight" | "uturn" | "roundabout" | "depart" | "arrive";

type EngineInstruction = {
  id: string;
  text: string;
  roadName: string;
  distance: number;
  location: Coordinate;
  type: string;
  modifier: string;
  exit?: number;
  direction: SemanticDirection;
};

type EngineRoute = {
  distance: number;
  duration: number;
  coordinates: Coordinate[];
  instructions: EngineInstruction[];
  provider: RoutingProviderName;
  profile: "auto" | "motorcycle" | "bicycle" | "driving";
};

type OsrmManeuver = {
  type: string;
  modifier?: string;
  location: Coordinate;
  exit?: number;
};

type OsrmStep = {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  maneuver: OsrmManeuver;
};

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: Coordinate[] };
  legs?: Array<{ steps?: OsrmStep[] }>;
};

type ValhallaManeuver = {
  type: number;
  instruction?: string;
  verbal_pre_transition_instruction?: string;
  street_names?: string[];
  travel_mode?: string;
  travel_type?: string;
  length?: number;
  time?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
  roundabout_exit_count?: number;
};

type ValhallaLeg = {
  shape: string;
  maneuvers?: ValhallaManeuver[];
};

type ValhallaTrip = {
  status?: number;
  status_message?: string;
  summary?: { time?: number; length?: number };
  legs?: ValhallaLeg[];
};

type ValhallaResponse = {
  trip?: ValhallaTrip;
  alternates?: Array<ValhallaTrip | { trip?: ValhallaTrip }>;
};

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
  profile: "auto" | "motorcycle" | "bicycle";
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

const VALHALLA_ENDPOINT = "https://valhalla1.openstreetmap.de/route";
const VALHALLA_TIMEOUT_MS = 8_000;
const OSRM_TIMEOUT_MS = 7_000;
const ROUTE_BUDGET_MS = 18_000;
const NAVIGATION_ROUTE_BUDGET_MS = 5_500;
const VALHALLA_MIN_INTERVAL_MS = 1_050;
const MOTOR_HIGHWAYS = "^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track)$";
const BICYCLE_HIGHWAYS = "^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track|cycleway|path|pedestrian|footway)$";
let valhallaQueue: Promise<void> = Promise.resolve();
let lastValhallaStartedAt = 0;

const MODE_POLICY: Record<TransportMode, ModePolicy> = {
  car: {
    profile: "auto",
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
    profile: "motorcycle",
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
    profile: "bicycle",
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
  const [lng, lat] = value.split(",").map(Number);
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

function sampledCoordinates(route: EngineRoute) {
  const coordinates = route.coordinates;
  const step = Math.max(1, Math.floor(coordinates.length / 24));
  const sampled = coordinates.filter((_, index) => index % step === 0);
  if (sampled[sampled.length - 1] !== coordinates[coordinates.length - 1]) {
    sampled.push(coordinates[coordinates.length - 1]);
  }
  return sampled;
}

function routesAreEquivalent(a: EngineRoute, b: EngineRoute, mode: TransportMode) {
  const policy = MODE_POLICY[mode];
  if (
    Math.abs(a.distance - b.distance) > policy.equivalentDistanceMeters
    || Math.abs(a.duration - b.duration) > policy.equivalentDurationSeconds
  ) {
    return false;
  }
  const aSamples = sampledCoordinates(a);
  const bSamples = sampledCoordinates(b);
  const averageDistance = aSamples.reduce((sum, point) => {
    const nearest = bSamples.reduce((minimum, candidate) => {
      const distance = segmentLength(point, candidate);
      return Math.min(minimum, distance);
    }, Number.POSITIVE_INFINITY);
    return sum + nearest;
  }, 0) / Math.max(1, aSamples.length);
  return averageDistance < policy.equivalentAverageMeters;
}

function deduplicateRoutes(
  routes: Array<{ route: EngineRoute; source: string }>,
  mode: TransportMode,
) {
  return routes.filter((candidate, index, all) =>
    all.findIndex((existing) => routesAreEquivalent(candidate.route, existing.route, mode)) === index,
  );
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

function decodePolyline6(encoded: string): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([longitude / 1e6, latitude / 1e6]);
  }
  return coordinates;
}

function valhallaDirection(type: number): SemanticDirection {
  if ([1, 2, 3].includes(type)) return "depart";
  if ([4, 5, 6].includes(type)) return "arrive";
  if ([26, 27].includes(type)) return "roundabout";
  if ([9, 10, 11, 18, 20, 23].includes(type)) return "right";
  if ([14, 15, 16, 19, 21, 24].includes(type)) return "left";
  if ([12, 13].includes(type)) return "uturn";
  return "straight";
}

function valhallaInstructionType(type: number) {
  if ([1, 2, 3].includes(type)) return "depart";
  if ([4, 5, 6].includes(type)) return "arrive";
  if (type === 26) return "roundabout";
  if (type === 27) return "roundabout exit";
  if (type === 25) return "merge";
  if ([18, 19].includes(type)) return "on ramp";
  if ([20, 21].includes(type)) return "off ramp";
  return "turn";
}

function valhallaModifier(direction: SemanticDirection) {
  if (direction === "left" || direction === "right" || direction === "uturn") return direction;
  return direction === "straight" ? "straight" : "";
}

function normalizeValhallaTrip(trip: ValhallaTrip, profile: ModePolicy["profile"]): EngineRoute | null {
  if (!trip.legs?.length || !trip.summary) return null;
  const coordinates: Coordinate[] = [];
  const instructions: EngineInstruction[] = [];

  trip.legs.forEach((leg, legIndex) => {
    const legCoordinates = decodePolyline6(leg.shape);
    if (!legCoordinates.length) return;
    const globalOffset = Math.max(0, coordinates.length - (legIndex > 0 ? 1 : 0));
    coordinates.push(...(legIndex > 0 ? legCoordinates.slice(1) : legCoordinates));
    (leg.maneuvers ?? []).forEach((maneuver) => {
      const direction = valhallaDirection(maneuver.type);
      const localIndex = Math.min(
        legCoordinates.length - 1,
        Math.max(0, maneuver.begin_shape_index ?? 0),
      );
      const location = coordinates[Math.min(coordinates.length - 1, globalOffset + localIndex)]
        ?? legCoordinates[localIndex];
      const roadName = maneuver.street_names?.[0] ?? "";
      const type = valhallaInstructionType(maneuver.type);
      const baseText = maneuver.instruction
        ?? maneuver.verbal_pre_transition_instruction
        ?? (direction === "arrive" ? "Sei arrivato a destinazione" : "Segui il percorso");
      const instructionText = profile === "bicycle" && maneuver.travel_mode === "pedestrian"
        ? `${baseText} (bici a mano)`
        : baseText;
      instructions.push({
        id: `${instructions.length}-${type}-${location.join(",")}`,
        text: instructionText,
        roadName,
        distance: Math.max(0, (maneuver.length ?? 0) * 1_000),
        location,
        type,
        modifier: valhallaModifier(direction),
        exit: maneuver.roundabout_exit_count,
        direction,
      });
    });
  });

  if (coordinates.length < 2) return null;
  return {
    distance: Math.max(0, (trip.summary.length ?? 0) * 1_000),
    duration: Math.max(0, trip.summary.time ?? 0),
    coordinates,
    instructions,
    provider: "valhalla-fossgis",
    profile,
  };
}

function valhallaCostingOptions(mode: TransportMode) {
  if (mode === "bicycle") {
    return { bicycle: { bicycle_type: "hybrid", use_roads: 0.35, use_hills: 0.45 } };
  }
  if (mode === "motorcycle") {
    return { motorcycle: { use_highways: 0.35, use_tolls: 0.2, use_trails: 0 } };
  }
  return { auto: { use_highways: 0.7, use_tolls: 0.2 } };
}

function combinedTimeoutSignal(signal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

async function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

async function runValhallaLimited<T>(
  deadline: number,
  signal: AbortSignal,
  reserveMs: number,
  task: (timeoutMs: number) => Promise<T>,
) {
  let releaseQueue = () => undefined;
  const previousRequest = valhallaQueue;
  valhallaQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previousRequest;
  try {
    if (signal.aborted) throw signal.reason;
    const waitMs = Math.max(0, VALHALLA_MIN_INTERVAL_MS - (Date.now() - lastValhallaStartedAt));
    if (waitMs) await abortableDelay(waitMs, signal);
    const timeoutMs = Math.min(VALHALLA_TIMEOUT_MS, deadline - Date.now() - reserveMs);
    if (timeoutMs < 500) throw new Error("Budget routing esaurito");
    lastValhallaStartedAt = Date.now();
    return await task(timeoutMs);
  } finally {
    releaseQueue();
  }
}

async function fetchValhallaRoutes(
  points: Coordinate[],
  mode: TransportMode,
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
): Promise<EngineRoute[]> {
  const profile = MODE_POLICY[mode].profile;
  try {
    const response = await runValhallaLimited(
      deadline,
      signal,
      mode === "car" ? 1_500 : 0,
      (timeoutMs) =>
      fetch(VALHALLA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Client-Id": "lastrico-milano",
          "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
        },
        body: JSON.stringify({
          locations: points.map(([lon, lat], index) => ({
            lon,
            lat,
            type: index === 0 || index === points.length - 1 ? "break" : "through",
          })),
          costing: profile,
          costing_options: valhallaCostingOptions(mode),
          units: "kilometers",
          directions_options: { units: "kilometers", language: "it-IT" },
          alternates: alternatives ? 2 : 0,
        }),
        cache: "no-store",
        signal: combinedTimeoutSignal(signal, timeoutMs),
      }),
    );
    if (!response.ok) return [];
    const data = await response.json() as ValhallaResponse;
    const alternateTrips = (data.alternates ?? [])
      .map((alternate) => "trip" in alternate ? alternate.trip : alternate)
      .filter((trip): trip is ValhallaTrip => Boolean(trip));
    return [data.trip, ...alternateTrips]
      .filter((trip): trip is ValhallaTrip => Boolean(trip))
      .map((trip) => normalizeValhallaTrip(trip, profile))
      .filter((route): route is EngineRoute => Boolean(route));
  } catch {
    return [];
  }
}

function osrmInstructionText(step: OsrmStep) {
  const road = step.name || step.ref || "";
  const onto = road ? ` in ${road}` : "";
  const modifier = step.maneuver.modifier ?? "";
  const directions: Record<string, string> = {
    left: `Svolta a sinistra${onto}`,
    right: `Svolta a destra${onto}`,
    "slight left": `Tieni leggermente la sinistra${onto}`,
    "slight right": `Tieni leggermente la destra${onto}`,
    "sharp left": `Svolta nettamente a sinistra${onto}`,
    "sharp right": `Svolta nettamente a destra${onto}`,
    straight: `Prosegui dritto${onto}`,
    uturn: `Fai inversione a U${onto}`,
  };
  switch (step.maneuver.type) {
    case "depart":
      return road ? `Parti su ${road}` : "Parti e segui il percorso";
    case "arrive":
      return "Sei arrivato a destinazione";
    case "roundabout":
    case "rotary":
      return `Entra nella rotonda${step.maneuver.exit ? ` e prendi l’uscita ${step.maneuver.exit}` : ""}${onto}`;
    case "merge":
      return `Immettiti${modifier.includes("left") ? " a sinistra" : modifier.includes("right") ? " a destra" : ""}${onto}`;
    case "fork":
      return `Tieni ${modifier.includes("left") ? "la sinistra" : "la destra"}${onto}`;
    case "on ramp":
    case "off ramp":
      return `Prendi la rampa${modifier.includes("left") ? " a sinistra" : modifier.includes("right") ? " a destra" : ""}${onto}`;
    case "end of road":
      return directions[modifier] ?? `Alla fine della strada prosegui${onto}`;
    case "continue":
    case "new name":
    case "turn":
      return directions[modifier] ?? `Continua${onto}`;
    default:
      return directions[modifier] ?? `Segui il percorso${onto}`;
  }
}

function osrmSemanticDirection(step: OsrmStep): SemanticDirection {
  if (step.maneuver.type === "arrive") return "arrive";
  if (step.maneuver.type === "depart") return "depart";
  if (step.maneuver.type === "roundabout" || step.maneuver.type === "rotary") return "roundabout";
  if (step.maneuver.modifier?.includes("left")) return "left";
  if (step.maneuver.modifier?.includes("right")) return "right";
  if (step.maneuver.modifier === "uturn") return "uturn";
  return "straight";
}

function normalizeOsrmRoute(route: OsrmRoute): EngineRoute {
  const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
  return {
    distance: route.distance,
    duration: route.duration,
    coordinates: route.geometry.coordinates,
    instructions: steps.map((step, index) => ({
      id: `${index}-${step.maneuver.type}-${step.maneuver.location.join(",")}`,
      text: osrmInstructionText(step),
      roadName: step.name || step.ref || "",
      distance: step.distance,
      location: step.maneuver.location,
      type: step.maneuver.type,
      modifier: step.maneuver.modifier ?? "",
      exit: step.maneuver.exit,
      direction: osrmSemanticDirection(step),
    })),
    provider: "osrm-public-fallback",
    profile: "driving",
  };
}

async function fetchOsrmCarRoutes(
  points: Coordinate[],
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
): Promise<EngineRoute[]> {
  const path = points.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${path}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", alternatives ? "3" : "false");
  url.searchParams.set("steps", "true");
  url.searchParams.set("continue_straight", "false");
  try {
    const timeoutMs = Math.min(OSRM_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs < 500) return [];
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
      },
      cache: "no-store",
      signal: combinedTimeoutSignal(signal, timeoutMs),
    });
    if (!response.ok) return [];
    const data = await response.json() as { code: string; routes?: OsrmRoute[] };
    return data.code === "Ok" ? (data.routes ?? []).map(normalizeOsrmRoute) : [];
  } catch {
    return [];
  }
}

async function fetchEngineRoutes(
  points: Coordinate[],
  mode: TransportMode,
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
) {
  const valhallaRoutes = await fetchValhallaRoutes(points, mode, alternatives, deadline, signal);
  if (valhallaRoutes.length) return valhallaRoutes;
  // A generic driving graph is a valid degraded car route, but would be unsafe and
  // misleading for bicycle or motorcycle mode. Those modes fail explicitly.
  return mode === "car" ? fetchOsrmCarRoutes(points, alternatives, deadline, signal) : [];
}

function selectSafeRoute(
  scored: ScoredRoute[],
  fast: ScoredRoute,
  avoidance: Avoidance,
  mode: TransportMode,
) {
  const policy = MODE_POLICY[mode];
  const distinct = scored.filter((candidate) => !routesAreEquivalent(candidate.route, fast.route, mode));
  const limit = policy.limits[avoidance];
  const eligible = distinct.filter((candidate) =>
    candidate.route.duration <= fast.route.duration * limit.factor + limit.seconds,
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

function routePayload(route: EngineRoute, surfaceScore: SurfaceScore) {
  return {
    coordinates: route.coordinates,
    distance: route.distance / 1_000,
    minutes: route.duration / 60,
    paveMeters: surfaceScore.paveMeters,
    pavePercent: surfaceScore.pavePercent,
    surfaceConfidence: surfaceScore.confidence,
    confirmedPaveMeters: surfaceScore.confirmedMeters,
    probablePaveMeters: surfaceScore.probableMeters,
    instructions: route.instructions,
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
      profile: "motorcycle",
      beta: true,
      approximate: false,
      fallbackUsed: false,
      notice: "Profilo Valhalla Motorcycle beta: accessi e restrizioni dipendono dai dati OpenStreetMap.",
    };
  }
  if (mode === "bicycle") {
    return {
      provider,
      profile: "bicycle",
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
  const deadline = Date.now() + (navigationRequest ? NAVIGATION_ROUTE_BUDGET_MS : ROUTE_BUDGET_MS);
  const start = parseCoordinate(request.nextUrl.searchParams.get("start"));
  const end = parseCoordinate(request.nextUrl.searchParams.get("end"));
  const avoidance = (request.nextUrl.searchParams.get("avoid") ?? "strong") as Avoidance;
  const requestedMode = request.nextUrl.searchParams.get("mode") ?? "car";
  if (
    !start
    || !end
    || !["balanced", "strong", "maximum"].includes(avoidance)
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
  const localPave = (bundledPave as PaveDetail[]).filter((way) =>
    way.coordinates.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north),
  );

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
          .filter((way) => way.geometry && way.geometry.length > 1)
          .map((way) => ({
            id: way.id,
            name: way.tags?.name ?? "Strada senza nome",
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
    const surfaceIndex = createSurfaceIndex(paveDetails);
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
    const preliminarySafe = selectSafeRoute(baseScored, preliminaryFast, avoidance, mode);
    const baseAlreadyImproves = !routesAreEquivalent(
      preliminaryFast.route,
      preliminarySafe.route,
      mode,
    ) && preliminarySafe.riskMeters + policy.minimumPaveReduction <= preliminaryFast.riskMeters;
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

    const detourResponses: EngineRoute[][] = [];
    if (!baseAlreadyImproves) {
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
    const safe = selectSafeRoute(scored, fast, avoidance, mode);
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, safe.route, mode)
      && safe.riskMeters + policy.minimumPaveReduction <= fast.riskMeters;
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
      ? " La copertura locale dei fondi ciclabili può essere incompleta finché Overpass non risponde."
      : "";
    const calculationCompletedAt = performance.now();

    return NextResponse.json({
      fast: routePayload(fast.route, fast.surfaceScore),
      safe: routePayload(safe.route, safe.surfaceScore),
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
        matchedSurfaceFeatures: candidate.surfaceScore.matchedFeatures,
        detourPercent: fast.route.duration > 0
          ? Math.round(((candidate.route.duration / fast.route.duration) - 1) * 1_000) / 10
          : 0,
        distinctFromFast: !routesAreEquivalent(candidate.route, fast.route, mode),
      })),
      dataNotice: (
        !paveWays.length
          ? "Dati sul pavé non disponibili: mostro soltanto il percorso rapido"
          : hasDistinctAlternative
            ? `${routeCountLabel} ${comparedLabel}; ${Math.max(
                fast.surfaceScore.matchedFeatures,
                safe.surfaceScore.matchedFeatures,
              )} way OSM abbinate al percorso (${dataSource})`
            : `${routeCountLabel} ${checkedLabel}: nessuna deviazione riduce l’esposizione nota (${dataSource})`
      ) + bicycleCoverageNotice,
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
