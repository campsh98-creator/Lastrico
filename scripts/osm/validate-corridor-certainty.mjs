/**
 * Phase 3.11: Independent Road Coverage and Surface Certainty Validator
 *
 * Measures:
 * 1. Physical corridor length
 * 2. Physical geometry matched (present in dataset) vs missing (completely absent from dataset)
 * 3. Surface certainty of the present geometry (smooth, confirmed rough, probable rough, unpaved, unknown)
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spatialRoadStore } from "../../lib/spatial-road-store.ts";
import { scoreRoadIntelligence } from "../../lib/road-intelligence-scoring.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const CORRIDORS = [
  {
    id: "cadorna-darsena",
    name: "Cadorna -> Darsena",
    description: "Western Cerchia dei Navigli (Via Carducci, De Amicis, Conca del Naviglio, Darsena)",
    coordinates: [
      [9.1758, 45.4684],
      [9.1765, 45.4660],
      [9.1772, 45.4635],
      [9.1779, 45.4605],
      [9.1785, 45.4580],
      [9.1790, 45.4550],
      [9.1798, 45.4522],
    ],
  },
  {
    id: "moscova-porta-venezia",
    name: "Moscova -> Porta Venezia",
    description: "Northern Cerchia dei Bastioni / Giardini Pubblici (Via Fatebenefratelli, Palestro, Porta Venezia)",
    coordinates: [
      [9.1875, 45.4780],
      [9.1910, 45.4755],
      [9.1945, 45.4735],
      [9.1985, 45.4725],
      [9.2020, 45.4735],
      [9.2052, 45.4746],
    ],
  },
  {
    id: "sempione-porta-romana",
    name: "Sempione -> Porta Romana",
    description: "North-West to South-East diagonal corridor across historical center",
    coordinates: [
      [9.1718, 45.4758],
      [9.1790, 45.4705],
      [9.1825, 45.4680],
      [9.1865, 45.4655],
      [9.1895, 45.4600],
      [9.1950, 45.4560],
      [9.2018, 45.4518],
    ],
  },
  {
    id: "magenta-missori",
    name: "Magenta -> Missori",
    description: "Western historical axis (Corso Magenta, Santa Maria delle Grazie to center)",
    coordinates: [
      [9.1725, 45.4655],
      [9.1775, 45.4650],
      [9.1820, 45.4652],
      [9.1865, 45.4655],
      [9.1890, 45.4600],
    ],
  },
];

function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePathLength(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += haversineMeters(coords[i - 1], coords[i]);
  }
  return len;
}

async function main() {
  console.log("=== Lastrico Phase 3.11: Independent Corridor Coverage & Certainty Audit ===\n");
  const pilotData = JSON.parse(await readFile(join(root, "data/surfaces/milan-central.json"), "utf8"));
  console.log(`Pilot Monolithic Segments: ${pilotData.length}`);
  console.log(`Compact Store Unique Segments: ${spatialRoadStore.totalSegments} across ${spatialRoadStore.tileCount} tiles\n`);

  for (const corridor of CORRIDORS) {
    const totalLength = calculatePathLength(corridor.coordinates);
    const tileKeys = spatialRoadStore.getTileKeysForCoordinates(corridor.coordinates, 80);
    const scoped = spatialRoadStore.getScopedIntelligence(corridor.coordinates, 80);

    // Score on car mode with default matching tolerance (12m)
    const scoreCar = scoreRoadIntelligence(corridor.coordinates, scoped.surfaceIndex, 12, "car");
    // Also test motorcycle and bicycle
    const scoreMoto = scoreRoadIntelligence(corridor.coordinates, scoped.surfaceIndex, 12, "motorcycle");
    void scoreMoto;
    const scoreBike = scoreRoadIntelligence(corridor.coordinates, scoped.surfaceIndex, 9, "bicycle");

    // Breakdown
    const smooth = scoreCar.smoothMeters;
    const pave = scoreCar.paveMeters;
    const confirmed = scoreCar.confirmedMeters;
    const probable = scoreCar.probableMeters;
    const unknown = scoreCar.unknownMeters;
    const scoredTotal = scoreCar.totalMeters;
    const coveragePct = scoreCar.matchedCoveragePercent.toFixed(1);
    const unknownPct = scoredTotal > 0 ? ((unknown / scoredTotal) * 100).toFixed(1) : "100.0";

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Corridor: ${corridor.name} (${corridor.id})`);
    console.log(`  Description: ${corridor.description}`);
    console.log(`  Physical Corridor Length: ${Math.round(totalLength)} m`);
    console.log(`  Active Tile Keys: [ ${tileKeys.join(", ")} ]`);
    console.log(`  Hydrated Candidate Segments in Scoped View: ${scoped.roads.length}`);
    console.log(`  Surface Scoring Breakdown (Car):`);
    console.log(`    - Confirmed Smooth:  ${Math.round(smooth)} m (${((smooth / scoredTotal) * 100).toFixed(1)}%)`);
    console.log(`    - Rough Sett/Pave:   ${Math.round(pave)} m (confirmed: ${Math.round(confirmed)}m, probable: ${Math.round(probable)}m)`);
    console.log(`    - Unknown Surface:   ${Math.round(unknown)} m (${unknownPct}%)`);
    console.log(`    - Matched Coverage:  ${coveragePct}%`);
    console.log(`  Bicycle Specific Metrics (9m match tolerance):`);
    console.log(`    - Smooth: ${Math.round(scoreBike.smoothMeters)} m | Rough: ${Math.round(scoreBike.paveMeters)} m | Unknown: ${Math.round(scoreBike.unknownMeters)} m (${((scoreBike.unknownMeters / scoreBike.totalMeters) * 100).toFixed(1)}%) | Cycleway: ${Math.round(scoreBike.cyclewayMeters)} m`);
    console.log(`  Surface Certainty Verdict:`);
    if (Number(unknownPct) > 90) {
      console.log(`    ⚠️  HIGH UNCERTAINTY: > 90% of corridor route is unclassified in current data.`);
      console.log(`       Tiles are present, but local street geometries (e.g. western/northern Bastioni) await external OSM download.`);
    } else {
      console.log(`    ✅  PARTIAL/HIGH CERTAINTY: Significant genuine OSM coverage active.`);
    }
    console.log();
  }
}

main().catch(console.error);
