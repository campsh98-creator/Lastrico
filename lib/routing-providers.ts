import type { RoutingProviderName, TransportMode } from "./routing-types";
import { logProviderFailure } from "./server-log.ts";

type Coordinate = [number, number];
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

export type EngineRoute = {
  distance: number;
  duration: number;
  coordinates: Coordinate[];
  instructions: EngineInstruction[];
  provider: RoutingProviderName;
  profile: "auto" | "motorcycle" | "bicycle" | "driving";
  /** Exact provider maneuver shapes, used only for graph-aligned cost factors. */
  maneuverShapes?: Coordinate[][];
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

const VALHALLA_ENDPOINT = "https://valhalla1.openstreetmap.de/route";
const VALHALLA_TIMEOUT_MS = 8_000;
const OSRM_TIMEOUT_MS = 7_000;
export const ROUTE_BUDGET_MS = 18_000;
export const NAVIGATION_ROUTE_BUDGET_MS = 5_500;
const VALHALLA_MIN_INTERVAL_MS = 1_050;
// Pacing is per isolate: other isolates keep their own slots, so this is best effort
// against the provider's one-request-per-second policy, not a global guarantee.
let nextValhallaSlotAt = 0;
let lastValhallaFetch: typeof fetch | null = null;

export const ROUTING_PROFILES = { car: "auto", motorcycle: "motorcycle", bicycle: "bicycle" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function coordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function metricsMatchGeometry(distance: number, duration: number, coordinates: Coordinate[]) {
  const moves = coordinates.some(([lon, lat]) => lon !== coordinates[0][0] || lat !== coordinates[0][1]);
  return (!moves || (distance > 0 && duration > 0)) && (distance === 0 || duration > 0);
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown) {
  return value === undefined || nonnegative(value);
}

function optionalIndex(value: unknown) {
  return value === undefined || (nonnegative(value) && Number.isSafeInteger(value));
}

// Decode complete coordinate pairs only; truncated and overflowing varints are invalid.
function decodePolyline6(encoded: string): Coordinate[] {
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  function readDelta(): number | null {
    let result = 0;
    for (let shift = 0; shift <= 30 && index < encoded.length; shift += 5) {
      const byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      result += (byte & 31) * 2 ** shift;
      if (result > 0xffffffff) return null;
      if (byte < 32) return result % 2 ? -(result + 1) / 2 : result / 2;
    }
    return null;
  }
  while (index < encoded.length) {
    const latDelta = readDelta();
    const lonDelta = readDelta();
    if (latDelta === null || lonDelta === null) return [];
    latitude += latDelta;
    longitude += lonDelta;
    const point: Coordinate = [longitude / 1e6, latitude / 1e6];
    if (!coordinate(point)) return [];
    coordinates.push(point);
  }
  return coordinates;
}

function validValhallaTrip(value: unknown): value is ValhallaTrip {
  if (!isRecord(value) || (value.status !== undefined && value.status !== 0)
    || !isRecord(value.summary) || !nonnegative(value.summary.time) || !nonnegative(value.summary.length)
    || !Number.isFinite(value.summary.length * 1_000)
    || !Array.isArray(value.legs) || !value.legs.length) return false;
  return value.legs.every((leg) => {
    if (!isRecord(leg) || typeof leg.shape !== "string") return false;
    const points = decodePolyline6(leg.shape);
    if (points.length < 2) return false;
    return leg.maneuvers === undefined || (Array.isArray(leg.maneuvers) && leg.maneuvers.every((maneuver) =>
      isRecord(maneuver) && Number.isSafeInteger(maneuver.type) && nonnegative(maneuver.type)
      && optionalString(maneuver.instruction) && optionalString(maneuver.verbal_pre_transition_instruction)
      && optionalString(maneuver.travel_mode) && optionalString(maneuver.travel_type)
      && optionalNumber(maneuver.length) && optionalNumber(maneuver.time)
      && (maneuver.length === undefined || Number.isFinite((maneuver.length as number) * 1_000))
      && optionalIndex(maneuver.roundabout_exit_count)
      && optionalIndex(maneuver.begin_shape_index) && optionalIndex(maneuver.end_shape_index)
      && (maneuver.begin_shape_index === undefined || (maneuver.begin_shape_index as number) < points.length)
      && (maneuver.end_shape_index === undefined || (maneuver.end_shape_index as number) < points.length)
      && (maneuver.begin_shape_index === undefined || maneuver.end_shape_index === undefined
        || (maneuver.begin_shape_index as number) <= (maneuver.end_shape_index as number))
      && (maneuver.street_names === undefined
        || (Array.isArray(maneuver.street_names) && maneuver.street_names.every((name) => typeof name === "string")))
    ));
  });
}

function validOsrmRoute(value: unknown): value is OsrmRoute {
  if (!isRecord(value) || !nonnegative(value.distance) || !nonnegative(value.duration)
    || !isRecord(value.geometry) || !Array.isArray(value.geometry.coordinates)
    || value.geometry.coordinates.length < 2 || !value.geometry.coordinates.every(coordinate)) return false;
  if (!metricsMatchGeometry(value.distance, value.duration, value.geometry.coordinates)) return false;
  return value.legs === undefined || (Array.isArray(value.legs) && value.legs.every((leg) =>
    isRecord(leg) && (leg.steps === undefined || (Array.isArray(leg.steps) && leg.steps.every((step) =>
      isRecord(step) && nonnegative(step.distance) && nonnegative(step.duration)
      && optionalString(step.name) && optionalString(step.ref)
      && isRecord(step.maneuver) && typeof step.maneuver.type === "string"
      && coordinate(step.maneuver.location) && optionalString(step.maneuver.modifier)
      && optionalIndex(step.maneuver.exit)
    )))
  ));
}

export function normalizeValhallaResponse(data: unknown, mode: TransportMode): EngineRoute[] {
  if (!isRecord(data)) return [];
  const alternates = Array.isArray(data.alternates) ? data.alternates : [];
  return [data.trip, ...alternates.map((alternate) => isRecord(alternate) && "trip" in alternate ? alternate.trip : alternate)]
    .filter(validValhallaTrip)
    .map((trip) => normalizeValhallaTrip(trip, ROUTING_PROFILES[mode]))
    .filter((route): route is EngineRoute => route !== null);
}

export function normalizeOsrmResponse(data: unknown): EngineRoute[] {
  if (!isRecord(data) || data.code !== "Ok" || !Array.isArray(data.routes)) return [];
  return data.routes.filter(validOsrmRoute).map(normalizeOsrmRoute);
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

function normalizeValhallaTrip(trip: ValhallaTrip, profile: typeof ROUTING_PROFILES[TransportMode]): EngineRoute | null {
  if (!trip.legs?.length || !trip.summary) return null;
  const coordinates: Coordinate[] = [];
  const instructions: EngineInstruction[] = [];
  const maneuverShapes: Coordinate[][] = [];

  for (const [legIndex, leg] of trip.legs.entries()) {
    const legCoordinates = decodePolyline6(leg.shape);
    if (legCoordinates.length < 2) return null;
    const previousEnd = coordinates.at(-1);
    if (previousEnd && (previousEnd[0] !== legCoordinates[0][0] || previousEnd[1] !== legCoordinates[0][1])) return null;
    const globalOffset = Math.max(0, coordinates.length - (legIndex > 0 ? 1 : 0));
    coordinates.push(...(legIndex > 0 ? legCoordinates.slice(1) : legCoordinates));
    (leg.maneuvers ?? []).forEach((maneuver) => {
      if (maneuver.begin_shape_index !== undefined && maneuver.end_shape_index !== undefined
        && maneuver.end_shape_index > maneuver.begin_shape_index) {
        maneuverShapes.push(legCoordinates.slice(maneuver.begin_shape_index, maneuver.end_shape_index + 1));
      }
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
  }

  const distance = (trip.summary.length ?? 0) * 1_000;
  const duration = trip.summary.time ?? 0;
  if (coordinates.length < 2 || !metricsMatchGeometry(distance, duration, coordinates)) return null;
  return {
    distance,
    duration,
    coordinates,
    instructions,
    provider: "valhalla-fossgis",
    profile,
    maneuverShapes,
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

export function combinedTimeoutSignal(signal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

async function abortableDelay(milliseconds: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await waitWithSignal(new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); }), signal);
  } finally {
    clearTimeout(timer);
  }
}

async function runValhallaLimited<T>(
  deadline: number,
  signal: AbortSignal,
  reserveMs: number,
  task: (timeoutMs: number) => Promise<T>,
) {
  const now = Date.now();
  const remainingMs = deadline - now - reserveMs;
  if (remainingMs < 500 || signal.aborted) throw new Error("Budget routing esaurito");
  if (lastValhallaFetch !== globalThis.fetch) {
    lastValhallaFetch = globalThis.fetch;
    nextValhallaSlotAt = 0;
  }
  // Slots limit how often calls start, not how many are in flight. Nothing here waits on
  // another request's promise, which a cancelled Worker request might never settle.
  const slotAt = Math.max(now, nextValhallaSlotAt);
  if (deadline - slotAt - reserveMs < 500) throw new Error("Budget routing esaurito");
  nextValhallaSlotAt = slotAt + VALHALLA_MIN_INTERVAL_MS;
  if (slotAt > now) await abortableDelay(slotAt - now, signal);
  signal.throwIfAborted();
  const timeoutMs = Math.min(VALHALLA_TIMEOUT_MS, deadline - Date.now() - reserveMs);
  if (timeoutMs < 500) throw new Error("Budget routing esaurito");
  return task(timeoutMs);
}

async function fetchValhallaRoutes(
  points: Coordinate[],
  mode: TransportMode,
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
  linearCostFactors?: { shape: string; factor: number }[],
  excludePolygons?: Coordinate[][],
): Promise<EngineRoute[]> {
  const profile = ROUTING_PROFILES[mode];
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
          ...(linearCostFactors && linearCostFactors.length > 0
            ? { linear_cost_factors: linearCostFactors }
            : {}),
          // Phase 4.31: stretches that are illegal at the departure time (ZTL, timed closure).
          ...(excludePolygons && excludePolygons.length > 0
            ? { exclude_polygons: excludePolygons }
            : {}),
          units: "kilometers",
          directions_options: { units: "kilometers", language: "it-IT" },
          alternates: alternatives ? 2 : 0,
        }),
        cache: "no-store",
        signal: combinedTimeoutSignal(signal, timeoutMs),
      }),
    );
    if (!response.ok) {
      logProviderFailure("valhalla", mode, { status: response.status });
      return [];
    }
    return normalizeValhallaResponse(await response.json(), mode);
  } catch (error) {
    logProviderFailure("valhalla", mode, { error });
    return [];
  }
}

export async function fetchValhallaCustomizedRoutes(
  points: Coordinate[],
  mode: TransportMode,
  linearCostFactors: { shape: string; factor: number }[],
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
): Promise<EngineRoute[]> {
  return fetchValhallaRoutes(points, mode, alternatives, deadline, signal, linearCostFactors);
}

/**
 * Phase 4.31: one route that leaves out the given rings entirely (Valhalla `exclude_polygons`),
 * for stretches the provider cannot know are closed: a ZTL without the person's permit, or a
 * time-window closure at the departure time.
 */
export async function fetchValhallaRouteExcluding(
  points: Coordinate[],
  mode: TransportMode,
  excludePolygons: Coordinate[][],
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
): Promise<EngineRoute | null> {
  const routes = await fetchValhallaRoutes(points, mode, false, deadline, signal, undefined, excludePolygons);
  return routes[0] ?? null;
}

export async function fetchValhallaCustomizedRoute(
  points: Coordinate[],
  mode: TransportMode,
  linearCostFactors: { shape: string; factor: number }[],
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
): Promise<EngineRoute | null> {
  const routes = await fetchValhallaCustomizedRoutes(points, mode, linearCostFactors, false, deadline, signal);
  return routes[0] ?? null;
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
    if (!response.ok) {
      logProviderFailure("osrm", "car", { status: response.status });
      return [];
    }
    return normalizeOsrmResponse(await response.json());
  } catch (error) {
    logProviderFailure("osrm", "car", { error });
    return [];
  }
}

export async function fetchEngineRoutes(
  points: Coordinate[],
  mode: TransportMode,
  alternatives = false,
  deadline = Date.now() + ROUTE_BUDGET_MS,
  signal: AbortSignal = new AbortController().signal,
) {
  if (signal.aborted || Date.now() >= deadline) return [];
  const valhallaRoutes = await fetchValhallaRoutes(points, mode, alternatives, deadline, signal);
  if (valhallaRoutes.length) return valhallaRoutes;
  // A generic driving graph is a valid degraded car route, but would be unsafe and
  // misleading for bicycle or motorcycle mode. Those modes fail explicitly.
  if (signal.aborted) return [];
  return mode === "car" ? fetchOsrmCarRoutes(points, alternatives, deadline, signal) : [];
}

