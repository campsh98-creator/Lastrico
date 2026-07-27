import { NextRequest, NextResponse } from "next/server";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: Coordinate[] };
};

type PaveWay = {
  id: number;
  tags?: { name?: string; surface?: string };
  geometry?: Array<{ lat: number; lon: number }>;
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

function scoreRoute(route: OsrmRoute, paveWays: Coordinate[][]) {
  const coordinates = route.geometry.coordinates;
  let paveMeters = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const midpoint: Coordinate = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let onPave = false;
    for (const way of paveWays) {
      for (let wayIndex = 1; wayIndex < way.length; wayIndex += 1) {
        if (pointToSegmentDistance(midpoint, way[wayIndex - 1], way[wayIndex]) <= 22) {
          onPave = true;
          break;
        }
      }
      if (onPave) break;
    }
    if (onPave) paveMeters += segmentLength(a, b);
  }
  return Math.round(paveMeters);
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

  const padding = 0.008;
  const south = Math.max(MILAN_BOUNDS.south, Math.min(start[1], end[1]) - padding);
  const west = Math.max(MILAN_BOUNDS.west, Math.min(start[0], end[0]) - padding);
  const north = Math.min(MILAN_BOUNDS.north, Math.max(start[1], end[1]) + padding);
  const east = Math.min(MILAN_BOUNDS.east, Math.max(start[0], end[0]) + padding);
  const overpassQuery = `[out:json][timeout:18];way["highway"]["surface"~"^(sett|cobblestone|unhewn_cobblestone|paving_stones)$"](${south},${west},${north},${east});out tags geom;`;

  const osrmUrl = new URL(`https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}`);
  osrmUrl.searchParams.set("overview", "full");
  osrmUrl.searchParams.set("geometries", "geojson");
  osrmUrl.searchParams.set("alternatives", "true");
  osrmUrl.searchParams.set("steps", "false");

  try {
    const [osrmResponse, overpassResponse] = await Promise.all([
      fetch(osrmUrl, { headers: { "User-Agent": "Lastrico-Milano-Demo/0.2" } }),
      fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Lastrico-Milano-Demo/0.2",
        },
        body: new URLSearchParams({ data: overpassQuery }),
      }).catch(() => null),
    ]);

    if (!osrmResponse.ok) throw new Error("Routing non disponibile");
    const osrm = await osrmResponse.json() as { code: string; routes: OsrmRoute[] };
    if (osrm.code !== "Ok" || !osrm.routes?.length) throw new Error("Nessun percorso");

    let paveWays: Coordinate[][] = [];
    let paveDetails: Array<{ name: string; surface: string; coordinates: Coordinate[] }> = [];
    if (overpassResponse?.ok) {
      const overpass = await overpassResponse.json() as { elements?: PaveWay[] };
      paveDetails = (overpass.elements ?? [])
        .filter((way) => way.geometry && way.geometry.length > 1)
        .map((way) => ({
          name: way.tags?.name ?? "Strada senza nome",
          surface: way.tags?.surface ?? "pavé",
          coordinates: way.geometry!.map((point) => [point.lon, point.lat] as Coordinate),
        }));
      paveWays = paveDetails.map((way) => way.coordinates);
    }

    const scored = osrm.routes.map((route) => ({
      route,
      paveMeters: scoreRoute(route, paveWays),
    }));
    const fast = [...scored].sort((a, b) => a.route.duration - b.route.duration)[0];
    const penaltyMinutesPerKm: Record<Avoidance, number> = { balanced: 2, strong: 7, maximum: 22 };
    const safe = [...scored].sort((a, b) => {
      const scoreA = a.route.duration / 60 + (a.paveMeters / 1000) * penaltyMinutesPerKm[avoidance];
      const scoreB = b.route.duration / 60 + (b.paveMeters / 1000) * penaltyMinutesPerKm[avoidance];
      return scoreA - scoreB;
    })[0];

    const relevantPave = paveDetails
      .filter((way) => {
        const fastCoordinates = fast.route.geometry.coordinates;
        return fastCoordinates.some((point) =>
          way.coordinates.some((_, index) =>
            index > 0 && pointToSegmentDistance(point, way.coordinates[index - 1], way.coordinates[index]) <= 26,
          ),
        );
      })
      .slice(0, 40);

    return NextResponse.json({
      fast: routePayload(fast.route, fast.paveMeters),
      safe: routePayload(safe.route, safe.paveMeters),
      problemSegments: relevantPave.map((way) => way.coordinates),
      alternativesAnalyzed: scored.length,
      surfaceDataAvailable: paveWays.length > 0,
      dataNotice: paveWays.length
        ? `${paveWays.length} tratti OSM con superficie critica analizzati`
        : "Nessun tratto critico OSM disponibile in quest’area",
    }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch {
    return NextResponse.json(
      { error: "Il routing gratuito è temporaneamente indisponibile. Riprova tra poco." },
      { status: 503 },
    );
  }
}
