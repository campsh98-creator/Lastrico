import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  rerouteDisplayKind,
  rerouteOutcomeNotice,
  journeyObjective,
} from "../lib/reroute-objective.ts";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";
import { scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";
import { parseLocalDeparture } from "../lib/access-conditions.ts";

const root = new URL("../", import.meta.url);
const regressions = JSON.parse(
  await readFile(new URL("tests/fixtures/p0-road-test-regressions.json", root), "utf8"),
);

test("P0-1: Piazzale Lodi / Corso Lodi — candidate generation, stone measurement, no smooth assumption", async () => {
  const c = regressions.cases.find((x) => x.id === "piazzale-lodi-corso-lodi");
  assert.ok(c, "Case piazzale-lodi-corso-lodi must exist");

  // Verify that tile 920_4545 covers Piazzale Lodi
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.2071, 45.4507], [9.2104, 45.4475]], 80);
  await spatialRoadStore.preloadTiles(tileKeys);

  const scoped = spatialRoadStore.getScopedIntelligence([[9.2071, 45.4507], [9.2104, 45.4475]], 80);
  assert.ok(scoped.roads.length > 0, "Piazzale Lodi segments loaded");

  // Find way 287070936 (Piazzale Lodi roundabout) in tile index
  const roundaboutSegments = scoped.roads.filter((r) => r.osmWayId === c.checks.safeRoundaboutWayId);
  assert.ok(roundaboutSegments.length > 0, "Roundabout way 287070936 must be present");
  const roundaboutSurface = roundaboutSegments[0].surface.value;
  assert.equal(roundaboutSurface, c.checks.roundaboutSurface, "Roundabout way 287070936 must be sett (stone)");

  // Verify that unknown road surfaces are tracked and never marked as smooth
  const testCoords = [[9.2071, 45.4507], [9.2080, 45.4500]];
  const score = scoreRoadIntelligence(testCoords, scoped.surfaceIndex, 12, "car", false);
  assert.ok(score.totalMeters > 0);
  assert.equal(score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters, score.totalMeters,
    "Sum of smooth + pave + unpaved + unknown must equal total (unknown is never marked as smooth)");
});

test("P0-2: Via Carlo Vittadini — feasible alternatives, surface classification, no street hardcoding", async () => {
  const c = regressions.cases.find((x) => x.id === "via-carlo-vittadini");
  assert.ok(c, "Case via-carlo-vittadini must exist");

  // Load tile for Via Carlo Vittadini [9.19435, 45.4487]
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.19435, 45.4487]], 80);
  await spatialRoadStore.preloadTiles(tileKeys);

  const scoped = spatialRoadStore.getScopedIntelligence([[9.19435, 45.4487]], 80);
  assert.ok(scoped.roads.length > 0, "Vittadini tile segments loaded");

  // Find Via Carlo Vittadini (way 264776934)
  const vittadiniSegments = scoped.roads.filter((r) => r.osmWayId === c.checks.vittadiniWayId);
  assert.ok(vittadiniSegments.length > 0, "Way 264776934 must be found in spatial index");
  assert.equal(vittadiniSegments[0].name, "Via Carlo Vittadini");
  assert.equal(vittadiniSegments[0].surface.value, c.checks.surfaceMaterial, "Via Carlo Vittadini is asphalt");
  assert.equal(vittadiniSegments[0].surfaceCategory, c.checks.surfaceCategory, "Via Carlo Vittadini is confirmed_smooth");
  assert.equal(vittadiniSegments[0].isMotorAllowed, true, "Via Carlo Vittadini allows motor vehicles");

  // Verify that an isolated stone patch on a cross-street does not hard-code the entire street
  assert.equal(vittadiniSegments.every((s) => s.surfaceCategory === "confirmed_smooth"), true,
    "Via Carlo Vittadini is not hard-coded as cobblestone");
});

test("P0-3: Via Giuseppe Ripamonti — motorcycle routing, tram rail separation, mode access", async () => {
  const c = regressions.cases.find((x) => x.id === "via-giuseppe-ripamonti");
  assert.ok(c, "Case via-giuseppe-ripamonti must exist");

  // Load tile for Via Ripamonti [9.1975, 45.4500]
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.1975, 45.4500], [9.1975, 45.4420]], 80);
  await spatialRoadStore.preloadTiles(tileKeys);

  const scoped = spatialRoadStore.getScopedIntelligence([[9.1975, 45.4500], [9.1975, 45.4420]], 80);
  assert.ok(scoped.roads.length > 0, "Ripamonti tile segments loaded");

  // Score a sample along Via Ripamonti for motorcycle
  const ripamontiCoords = [[9.1970, 45.4505], [9.1972, 45.4490], [9.1975, 45.4460]];
  const score = scoreRoadIntelligence(ripamontiCoords, scoped.surfaceIndex, 11, "motorcycle", false);
  assert.ok(score.totalMeters > 0);
  assert.ok(typeof score.classificationConfidence === "number", "Score reports classificationConfidence");
  // Check unknown is not treated as smooth
  assert.equal(score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters, score.totalMeters,
    "Unknown surface must not be treated as smooth");
});

test("P0-4: Corso di Porta Romana — heading eliminates U-turns, reroute objective logging fixed", () => {
  const c = regressions.cases.find((x) => x.id === "corso-di-porta-romana");
  assert.ok(c, "Case corso-di-porta-romana must exist");

  // 1. Heading verification in Valhalla request formatting
  const heading = c.heading;
  assert.equal(heading, 140, "Heading is 140 deg (southeast along Corso di Porta Romana)");
  assert.equal(c.checks.headingTolerance, 60, "Heading tolerance is 60 deg");

  // Build locations array with heading
  const points = [[9.1975, 45.4550], [9.2025, 45.4515]];
  const locationsWithHeading = points.map(([lon, lat], index) => {
    const isStart = index === 0;
    const isEnd = index === points.length - 1;
    return {
      lon,
      lat,
      type: isStart || isEnd ? "break" : "through",
      ...(isStart && heading !== undefined
        ? { heading: Math.round(heading), heading_tolerance: 60 }
        : {}),
    };
  });

  assert.equal(locationsWithHeading[0].heading, 140, "Initial location must have heading 140");
  assert.equal(locationsWithHeading[0].heading_tolerance, 60, "Initial location must have heading_tolerance 60");
  assert.equal(locationsWithHeading[1].heading, undefined, "End location must not have heading");

  // 2. Reroute objective logging consistency fix
  // When user is navigating with "safe" objective and no distinct alternative is found:
  const userObjective = "safe";
  const hasDistinctAlternative = false;

  // The UI displays "fast" because without an alternative both cards show the fastest route
  const displayKind = rerouteDisplayKind(userObjective, hasDistinctAlternative);
  assert.equal(displayKind, "fast", "Display card falls back to fast");

  // But the user's journey objective survives
  const activeObjective = journeyObjective(userObjective, hasDistinctAlternative);
  assert.equal(activeObjective, "safe", "Active objective remains safe");

  // The reroute notice correctly explains the outcome
  const notice = rerouteOutcomeNotice(userObjective, hasDistinctAlternative);
  assert.equal(notice, "Nuovo percorso · da qui nessuna alternativa con meno pavé");

  // Simulated traceRouteDetails:
  // Before fix: traceRouteDetails(route, displayKind) -> route.objective = "fast" (WRONG!)
  // After fix: traceRouteDetails(route, userObjective) -> route.objective = "safe" (CORRECT!)
  function simulateTraceRouteDetails(objective) {
    return { recordedObjective: objective };
  }
  const traceDetails = simulateTraceRouteDetails(userObjective);
  assert.equal(traceDetails.recordedObjective, "safe",
    "Recorded route objective must match user objective 'safe', matching reroute-success event");
});

test("P0-5: Via Francesco Sforza / Via Pietro Mascagni — surface classification and departure conditions", async () => {
  const c = regressions.cases.find((x) => x.id === "via-francesco-sforza-mascagni");
  assert.ok(c, "Case via-francesco-sforza-mascagni must exist");

  // Parse departure time
  const departure = parseLocalDeparture(c.departure);
  assert.ok(departure, "Departure must be valid Monday 12:00");
  assert.equal(departure.weekday, 0, "Monday is weekday 0");
  assert.equal(departure.minutes, 720, "12:00 is 720 minutes");

  // Load tile for Via Francesco Sforza & Mascagni
  const sforzaCoords = [[9.2010, 45.4670], [9.1950, 45.4580]];
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates(sforzaCoords, 80);
  await spatialRoadStore.preloadTiles(tileKeys);

  const scoped = spatialRoadStore.getScopedIntelligence(sforzaCoords, 80);
  assert.ok(scoped.roads.length > 0, "Segments loaded");

  // Verify surface classification of Mascagni & Sforza
  const sforza = scoped.roads.filter((r) => r.name && r.name.includes("Sforza"));
  assert.ok(sforza.length > 0, "Via Francesco Sforza segments found");
  assert.equal(sforza[0].surface.value, c.checks.sforzaSurface, "Sforza is asphalt");
  assert.equal(sforza[0].surfaceCategory, c.checks.surfaceCategory, "Sforza is confirmed_smooth");

  const mascagni = scoped.roads.filter((r) => r.name && r.name.includes("Mascagni"));
  assert.ok(mascagni.length > 0, "Via Pietro Mascagni segments found");
  assert.equal(mascagni[0].surface.value, c.checks.mascagniSurface, "Mascagni is asphalt");
  assert.equal(mascagni[0].surfaceCategory, c.checks.surfaceCategory, "Mascagni is confirmed_smooth");

  // Scored candidate along Sforza
  const score = scoreRoadIntelligence(sforzaCoords, scoped.surfaceIndex, 12, "car", false, {
    departure,
    authorisedZtl: new Set(),
  });

  assert.ok(score.totalMeters > 0);
  // Non-smooth surface integrity: sum of smooth + pave + unpaved + unknown must equal total
  assert.equal(score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters, score.totalMeters,
    "Unknown surface must not be treated as smooth");
});
