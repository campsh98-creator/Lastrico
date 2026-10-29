/**
 * Measure coverage for the four Milan expansion corridors against:
 * 1. Current clipped Road Intelligence pilot bounds: [9.180, 45.455, 9.200, 45.475]
 * 2. Raw unclipped representative network in data/milan-road-network-representative.json
 * 3. Proposed expanded bounds including western tiles: [9.169, 45.450, 9.206, 45.480]
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PILOT_BOUNDS = { west: 9.180, south: 45.455, east: 9.200, north: 45.475 };

const CORRIDORS = [
  {
    id: "cadorna-darsena",
    name: "Cadorna -> Darsena",
    start: [9.1758, 45.4684],
    end: [9.1798, 45.4522],
    description: "Western Cerchia dei Navigli (Via Carducci, De Amicis, Conca del Naviglio)",
  },
  {
    id: "moscova-porta-venezia",
    name: "Moscova -> Porta Venezia",
    start: [9.1875, 45.4780],
    end: [9.2052, 45.4746],
    description: "Northern Cerchia dei Bastioni / Giardini Pubblici (Via Fatebenefratelli, Palestro)",
  },
  {
    id: "sempione-porta-romana",
    name: "Sempione -> Porta Romana",
    start: [9.1718, 45.4758],
    end: [9.2018, 45.4518],
    description: "North-West to South-East diagonal corridor across historical center",
  },
  {
    id: "magenta-missori",
    name: "Magenta -> Missori",
    start: [9.1725, 45.4655],
    end: [9.1890, 45.4600],
    description: "Western historical axis (Corso Magenta, Santa Maria delle Grazie to center)",
  },
];

function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInside([lon, lat], bounds) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

// Bounding box of corridor plus margin
function getCorridorBbox(start, end, marginDeg = 0.002) {
  return {
    west: Math.min(start[0], end[0]) - marginDeg,
    south: Math.min(start[1], end[1]) - marginDeg,
    east: Math.max(start[0], end[0]) + marginDeg,
    north: Math.max(start[1], end[1]) + marginDeg,
  };
}

async function main() {
  console.log("=== Lastrico Phase 3.7: Milan Corridor Coverage Analysis ===");
  console.log(`Current Pilot Bounds: [${PILOT_BOUNDS.west}, ${PILOT_BOUNDS.south}, ${PILOT_BOUNDS.east}, ${PILOT_BOUNDS.north}]`);

  // Load datasets
  const surfaceSegments = JSON.parse(await readFile(join(root, "data/surfaces/milan-central.json"), "utf8"));
  const rawWays = JSON.parse(await readFile(join(root, "data/milan-road-network-representative.json"), "utf8"));

  console.log(`Loaded milan-central.json: ${surfaceSegments.length} segments`);
  console.log(`Loaded milan-road-network-representative.json: ${rawWays.length} raw ways\n`);

  for (const corridor of CORRIDORS) {
    const directDistance = Math.round(haversineMeters(corridor.start, corridor.end));
    const startIn = isInside(corridor.start, PILOT_BOUNDS);
    const endIn = isInside(corridor.end, PILOT_BOUNDS);
    const corridorBbox = getCorridorBbox(corridor.start, corridor.end);

    // Approximate corridor straight line discretization (100 steps)
    let outsidePoints = 0;
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = [
        corridor.start[0] + t * (corridor.end[0] - corridor.start[0]),
        corridor.start[1] + t * (corridor.end[1] - corridor.start[1]),
      ];
      if (!isInside(pt, PILOT_BOUNDS)) outsidePoints++;
    }
    const directOutsidePercent = Math.round((outsidePoints / (steps + 1)) * 100);

    // Find segments near this corridor in current surface dataset
    const segmentsInCorridorBox = surfaceSegments.filter((seg) => {
      const midLon = (seg.coordinates[0][0] + seg.coordinates[1][0]) / 2;
      const midLat = (seg.coordinates[0][1] + seg.coordinates[1][1]) / 2;
      return midLon >= corridorBbox.west && midLon <= corridorBbox.east &&
             midLat >= corridorBbox.south && midLat <= corridorBbox.north;
    });

    // Find raw ways intersecting this corridor box
    const rawWaysInCorridorBox = rawWays.filter((way) => {
      return way.coordinates.some(([lon, lat]) =>
        lon >= corridorBbox.west && lon <= corridorBbox.east &&
        lat >= corridorBbox.south && lat <= corridorBbox.north
      );
    });

    console.log(`--- ${corridor.name} (${corridor.id}) ---`);
    console.log(`  Description: ${corridor.description}`);
    console.log(`  Start: [${corridor.start.join(", ")}] -> In Pilot: ${startIn ? "YES" : "NO"}`);
    console.log(`  End:   [${corridor.end.join(", ")}] -> In Pilot: ${endIn ? "YES" : "NO"}`);
    console.log(`  Direct Euclidean distance: ${directDistance} m`);
    console.log(`  Straight line outside pilot: ${directOutsidePercent}%`);
    console.log(`  Corridor bounding box: [${corridorBbox.west.toFixed(4)}, ${corridorBbox.south.toFixed(4)}, ${corridorBbox.east.toFixed(4)}, ${corridorBbox.north.toFixed(4)}]`);
    console.log(`  Segments in current milan-central.json bbox: ${segmentsInCorridorBox.length}`);
    console.log(`  Raw ways in unclipped network bbox: ${rawWaysInCorridorBox.length}`);

    // Break down where the gap is
    const westernDeficit = Math.max(0, PILOT_BOUNDS.west - corridorBbox.west);
    const easternDeficit = Math.max(0, corridorBbox.east - PILOT_BOUNDS.east);
    const southernDeficit = Math.max(0, PILOT_BOUNDS.south - corridorBbox.south);
    const northernDeficit = Math.max(0, corridorBbox.north - PILOT_BOUNDS.north);

    const deficits = [];
    if (westernDeficit > 0) deficits.push(`WEST by ${(westernDeficit * 111320 * Math.cos(45.46 * Math.PI / 180)).toFixed(0)}m (lon ${corridorBbox.west.toFixed(4)} < ${PILOT_BOUNDS.west})`);
    if (easternDeficit > 0) deficits.push(`EAST by ${(easternDeficit * 111320 * Math.cos(45.46 * Math.PI / 180)).toFixed(0)}m (lon ${corridorBbox.east.toFixed(4)} > ${PILOT_BOUNDS.east})`);
    if (southernDeficit > 0) deficits.push(`SOUTH by ${(southernDeficit * 111320).toFixed(0)}m (lat ${corridorBbox.south.toFixed(4)} < ${PILOT_BOUNDS.south})`);
    if (northernDeficit > 0) deficits.push(`NORTH by ${(northernDeficit * 111320).toFixed(0)}m (lat ${corridorBbox.north.toFixed(4)} > ${PILOT_BOUNDS.north})`);

    console.log(`  Geographic Gaps: ${deficits.length > 0 ? deficits.join(", ") : "None (fully within pilot)"}\n`);
  }
}

main().catch(console.error);
