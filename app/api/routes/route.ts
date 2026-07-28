import { NextRequest, NextResponse } from "next/server";
import bundledPave from "@/data/milan-pave-central.json";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: Coordinate[] };
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
  route: OsrmRoute;
  paveMeters: number;
  source: string;
};

const MILAN_BOUNDS = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
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

function segmentTouchesPave(a: Coordinate, b: Coordinate, paveWays: Coordinate[][]) {
  const midpoint: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const way of paveWays) {
    for (let index = 1; index < way.length; index += 1) {
      if (
        headingsAlign(a, b, way[index - 1], way[index])
        && pointToSegmentDistance(midpoint, way[index - 1], way[index]) <= 12
      ) {
        return true;
      }
    }
  }
  return false;
}

function scoreRoute(route: OsrmRoute, paveWays: Coordinate[][]) {
  const coordinates = route.geometry.coordinates;
  const longitude = coordinates.map(([lng]) => lng);
  const latitude = coordinates.map(([, lat]) => lat);
  const west = Math.min(...longitude) - 0.00035;
  const east = Math.max(...longitude) + 0.00035;
  const south = Math.min(...latitude) - 0.00035;
  const north = Math.max(...latitude) + 0.00035;
  const relevantWays = paveWays.filter((way) =>
    way.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north),
  );
  let paveMeters = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (segmentTouchesPave(a, b, relevantWays)) paveMeters += segmentLength(a, b);
  }
  return Math.round(paveMeters);
}

function sampledCoordinates(route: OsrmRoute) {
  const coordinates = route.geometry.coordinates;
  const step = Math.max(1, Math.floor(coordinates.length / 24));
  const sampled = coordinates.filter((_, index) => index % step === 0);
  if (sampled[sampled.length - 1] !== coordinates[coordinates.length - 1]) {
    sampled.push(coordinates[coordinates.length - 1]);
  }
  return sampled;
}

function routesAreEquivalent(a: OsrmRoute, b: OsrmRoute) {
  if (Math.abs(a.distance - b.distance) > 120 || Math.abs(a.duration - b.duration) > 90) return false;
  const aSamples = sampledCoordinates(a);
  const bSamples = sampledCoordinates(b);
  const averageDistance = aSamples.reduce((sum, point) => {
    const nearest = bSamples.reduce((minimum, candidate) => {
      const distance = segmentLength(point, candidate);
      return Math.min(minimum, distance);
    }, Number.POSITIVE_INFINITY);
    return sum + nearest;
  }, 0) / Math.max(1, aSamples.length);
  return averageDistance < 32;
}

function deduplicateRoutes(routes: Array<{ route: OsrmRoute; source: string }>) {
  return routes.filter((candidate, index, all) =>
    all.findIndex((existing) => routesAreEquivalent(candidate.route, existing.route)) === index,
  );
}

function findDetourAnchor(route: OsrmRoute, paveWays: Coordinate[][]) {
  const coordinates = route.geometry.coordinates;
  let best: { a: Coordinate; b: Coordinate; weight: number } | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    if (!segmentTouchesPave(a, b, paveWays)) continue;
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

async function fetchOsrmRoute(points: Coordinate[], alternatives = false) {
  const path = points.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${path}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", alternatives ? "3" : "false");
  url.searchParams.set("steps", "false");
  url.searchParams.set("continue_straight", "false");
  const response = await fetch(url, {
    headers: { "User-Agent": "Lastrico-Milano-Beta/0.6" },
  });
  if (!response.ok) return [];
  const data = await response.json() as { code: string; routes?: OsrmRoute[] };
  return data.code === "Ok" ? data.routes ?? [] : [];
}

function selectSafeRoute(scored: ScoredRoute[], fast: ScoredRoute, avoidance: Avoidance) {
  const distinct = scored.filter((candidate) => !routesAreEquivalent(candidate.route, fast.route));
  const limits: Record<Avoidance, { factor: number; seconds: number }> = {
    balanced: { factor: 1.22, seconds: 180 },
    strong: { factor: 1.42, seconds: 420 },
    maximum: { factor: 1.7, seconds: 720 },
  };
  const limit = limits[avoidance];
  const eligible = distinct.filter((candidate) =>
    candidate.route.duration <= fast.route.duration * limit.factor + limit.seconds,
  );
  const reducing = eligible
    .filter((candidate) => candidate.paveMeters + 20 < fast.paveMeters)
    .sort((a, b) => {
      if (avoidance === "balanced") {
        const scoreA = a.route.duration / 60 + a.paveMeters / 500;
        const scoreB = b.route.duration / 60 + b.paveMeters / 500;
        return scoreA - scoreB;
      }
      return a.paveMeters - b.paveMeters || a.route.duration - b.route.duration;
    });
  return reducing[0] ?? fast;
}

function routePayload(route: OsrmRoute, paveMeters: number) {
  return {
    coordinates: route.geometry.coordinates,
    distance: route.distance / 1000,
    minutes: route.duration / 60,
    paveMeters,
  };
}

export async function GET(request: NextRequest) {
  const start = parseCoordinate(request.nextUrl.searchParams.get("start"));
  const end = parseCoordinate(request.nextUrl.searchParams.get("end"));
  const avoidance = (request.nextUrl.searchParams.get("avoid") ?? "strong") as Avoidance;
  if (!start || !end || !["balanced", "strong", "maximum"].includes(avoidance)) {
    return NextResponse.json({ error: "Coordinate non valide o fuori Milano." }, { status: 400 });
  }

  const padding = 0.02;
  const south = Math.max(MILAN_BOUNDS.south, Math.min(start[1], end[1]) - padding);
  const west = Math.max(MILAN_BOUNDS.west, Math.min(start[0], end[0]) - padding);
  const north = Math.min(MILAN_BOUNDS.north, Math.max(start[1], end[1]) + padding);
  const east = Math.min(MILAN_BOUNDS.east, Math.max(start[0], end[0]) + padding);
  const drivableHighways = "^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|track)$";
  const overpassQuery = `[out:json][timeout:20];way["highway"~"${drivableHighways}"]["surface"~"^(sett|cobblestone|unhewn_cobblestone|paving_stones)$"](${south},${west},${north},${east});out tags geom;`;
  const localPave = (bundledPave as PaveDetail[]).filter((way) =>
    way.coordinates.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north),
  );

  try {
    const [baseRoutes, overpassResponse] = await Promise.all([
      fetchOsrmRoute([start, end], true),
      fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Lastrico-Milano-Beta/0.6",
        },
        body: new URLSearchParams({ data: overpassQuery }),
        signal: AbortSignal.timeout(3_500),
      }).catch(() => null),
    ]);
    if (!baseRoutes.length) throw new Error("Nessun percorso");

    let paveDetails: PaveDetail[] = localPave;
    let dataSource = "archivio OSM locale";
    if (overpassResponse?.ok) {
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
    }
    const paveWays = paveDetails.map((way) => way.coordinates);

    const fastestBase = [...baseRoutes].sort((a, b) => a.duration - b.duration)[0];
    const anchor = findDetourAnchor(fastestBase, paveWays);
    const baseOffset = Math.max(380, Math.min(900, fastestBase.distance * 0.1));
    const detourPoints = [
      offsetPoint(anchor.a, anchor.b, baseOffset),
      offsetPoint(anchor.a, anchor.b, -baseOffset),
      offsetPoint(anchor.a, anchor.b, baseOffset * 1.55),
      offsetPoint(anchor.a, anchor.b, -baseOffset * 1.55),
    ].filter((point): point is Coordinate => Boolean(point));

    const detourResponses = await Promise.all(
      detourPoints.map((point) => fetchOsrmRoute([start, point, end])),
    );
    const candidates = deduplicateRoutes([
      ...baseRoutes.map((route, index) => ({ route, source: `base-${index + 1}` })),
      ...detourResponses.flatMap((routes, index) =>
        routes.map((route) => ({ route, source: `detour-${index + 1}` })),
      ),
    ]);
    const scored: ScoredRoute[] = candidates.map((candidate) => ({
      ...candidate,
      paveMeters: scoreRoute(candidate.route, paveWays),
    }));
    const fast = [...scored].sort((a, b) => a.route.duration - b.route.duration)[0];
    const safe = selectSafeRoute(scored, fast, avoidance);
    const hasDistinctAlternative = !routesAreEquivalent(fast.route, safe.route)
      && safe.paveMeters + 20 < fast.paveMeters;
    const routeCountLabel = `${scored.length} ${scored.length === 1 ? "percorso reale" : "percorsi reali"}`;
    const comparedLabel = scored.length === 1 ? "confrontato" : "confrontati";
    const checkedLabel = scored.length === 1 ? "controllato" : "controllati";

    const relevantPave = paveDetails
      .filter((way) => {
        const displayedCoordinates = [...fast.route.geometry.coordinates, ...safe.route.geometry.coordinates];
        return displayedCoordinates.some((point) =>
          way.coordinates.some((_, index) =>
            index > 0 && pointToSegmentDistance(point, way.coordinates[index - 1], way.coordinates[index]) <= 18,
          ),
        );
      })
      .slice(0, 70);

    return NextResponse.json({
      fast: routePayload(fast.route, fast.paveMeters),
      safe: routePayload(safe.route, safe.paveMeters),
      problemSegments: relevantPave.map((way) => way.coordinates),
      alternativesAnalyzed: scored.length,
      hasDistinctAlternative,
      surfaceDataAvailable: paveWays.length > 0,
      candidateDiagnostics: scored.map((candidate) => ({
        source: candidate.source,
        distance: Math.round(candidate.route.distance),
        seconds: Math.round(candidate.route.duration),
        paveMeters: candidate.paveMeters,
        distinctFromFast: !routesAreEquivalent(candidate.route, fast.route),
      })),
      dataNotice: !paveWays.length
        ? "Dati sul pavé non disponibili: mostro soltanto il percorso rapido"
        : hasDistinctAlternative
          ? `${routeCountLabel} ${comparedLabel} su ${paveWays.length} tratti critici (${dataSource})`
          : `${routeCountLabel} ${checkedLabel}: nessuna deviazione riduce il pavé noto (${dataSource})`,
    }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=120" },
    });
  } catch {
    return NextResponse.json(
      { error: "Il routing gratuito è temporaneamente indisponibile. Riprova tra poco." },
      { status: 503 },
    );
  }
}
