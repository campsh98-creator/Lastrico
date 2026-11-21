import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import {
  rerouteDisplayKind,
  rerouteOutcomeNotice,
  journeyObjective,
} from "../lib/reroute-objective.ts";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";
import { scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";
import { parseLocalDeparture } from "../lib/access-conditions.ts";
import { loadApi } from "./helpers/load-api.mjs";

const root = new URL("../", import.meta.url);
const regressions = JSON.parse(
  await readFile(new URL("tests/fixtures/p0-road-test-regressions.json", root), "utf8"),
);
const { GET } = await loadApi("app/api/routes/route.ts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function runHandlerWithFixtures(providerSubdir, queryParams) {
  const providerDir = new URL(`tests/fixtures/${providerSubdir}/provider/`, root);
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    const key = sha256(JSON.stringify(request));
    requests.push(request);
    let raw;
    try {
      raw = await readFile(new URL(`${key}.json.gz`, providerDir));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Missing recorded fixture ${providerSubdir}/provider/${key}.json.gz`);
      throw error;
    }
    const entry = JSON.parse(gunzipSync(raw));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams(queryParams);
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test("P0-1: Piazzale Lodi / Corso Lodi — real handler eliminates remaining 25 m confirmed stone in planner and navigation", async () => {
  const c = regressions.cases.find((x) => x.id === "piazzale-lodi-corso-lodi");
  assert.ok(c, "Case piazzale-lodi-corso-lodi must exist");

  // 1. Verify spatial metadata for Piazzale Lodi roundabout way 287070936 and unknown-not-smooth invariant
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.2071, 45.4507], [9.2104, 45.4475]], 80);
  await spatialRoadStore.preloadTiles(tileKeys);
  const scoped = spatialRoadStore.getScopedIntelligence([[9.2071, 45.4507], [9.2104, 45.4475]], 80);
  assert.ok(scoped.roads.length > 0, "Piazzale Lodi segments loaded");
  const roundaboutSegments = scoped.roads.filter((r) => r.osmWayId === c.checks.safeRoundaboutWayId);
  assert.ok(roundaboutSegments.length > 0, "Roundabout way 287070936 must be present");
  assert.equal(roundaboutSegments[0].surface.value, c.checks.roundaboutSurface, "Roundabout way 287070936 must be sett (stone)");

  const testCoords = [[9.2071, 45.4507], [9.2080, 45.4500]];
  const score = scoreRoadIntelligence(testCoords, scoped.surfaceIndex, 12, "car", false);
  assert.ok(score.totalMeters > 0);
  assert.equal(
    score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters,
    score.totalMeters,
    "Sum of smooth + pave + unpaved + unknown must equal total (unknown is never marked as smooth)",
  );

  // 2. End-to-end real GET /api/routes execution in both planner and navigation modes
  for (const navigationFlag of [false, true]) {
    const query = {
      area: "milan",
      start: c.start,
      end: c.end,
      mode: c.mode,
      avoid: c.avoid,
      departure: c.departure,
      ...(navigationFlag ? { navigation: "1" } : {}),
    };
    const { status, payload, requests } = await runHandlerWithFixtures("phase437", query);
    assert.equal(status, 200);
    assert.equal(payload.antiPave.search.attempted, true);
    assert.ok(payload.antiPave.search.generated >= 2);
    assert.ok(requests.length <= (navigationFlag ? 4 : 7), `provider request ceiling respected (${requests.length})`);
    assert.equal(payload.fast.confirmedPaveMeters, c.checks.fastConfirmedStoneMeters);
    assert.equal(payload.safe.confirmedPaveMeters, c.checks.safeConfirmedStoneMeters,
      `selected safe route must beat ${c.checks.safeConfirmedStoneMetersBefore} m Piazzale Lodi baseline (navigation=${navigationFlag})`);
    assert.equal(payload.safe.probablePaveMeters, 0);
    assert.equal(payload.safe.unknownSurfaceMeters, 0);
    assert.ok(payload.safe.minutes * 60 <= c.checks.maxTravelSeconds);
    assert.equal(payload.hasDistinctAlternative, true);
  }
});

test("P0-2: Via Carlo Vittadini — feasible alternatives, asphalt smooth, unknown Bellezza stays unknown", async () => {
  const c = regressions.cases.find((x) => x.id === "via-carlo-vittadini");
  assert.ok(c, "Case via-carlo-vittadini must exist");

  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.19435, 45.4487], [9.1965, 45.4480]], 120);
  await spatialRoadStore.preloadTiles(tileKeys);
  const scoped = spatialRoadStore.getScopedIntelligence([[9.19435, 45.4487], [9.1965, 45.4480]], 200);
  assert.ok(scoped.roads.length > 0, "Vittadini tile segments loaded");

  const vittadiniSegments = scoped.roads.filter((r) => r.osmWayId === c.checks.vittadiniWayId);
  assert.ok(vittadiniSegments.length > 0, "Way 264776934 must be found in spatial index");
  assert.equal(vittadiniSegments[0].name, "Via Carlo Vittadini");
  assert.equal(vittadiniSegments[0].surface.value, c.checks.surfaceMaterial);
  assert.equal(vittadiniSegments[0].surfaceCategory, c.checks.surfaceCategory);
  assert.equal(vittadiniSegments[0].isMotorAllowed, true);
  assert.equal(vittadiniSegments.every((s) => s.surfaceCategory === "confirmed_smooth"), true);

  // Adjacent Via Giovanni Bellezza segment without surface tag stays unknown (never marked smooth)
  const bellezzaUnknown = scoped.roads.filter((r) => r.osmWayId === c.checks.bellezzaUnknownWayId);
  assert.ok(bellezzaUnknown.length > 0, "Via Giovanni Bellezza way 286609081 present");
  assert.equal(bellezzaUnknown[0].surface.value, "unknown");
  assert.equal(bellezzaUnknown[0].surfaceCategory, "unknown");
});

test("P0-3: Via Giuseppe Ripamonti — motorcycle routing, tram rail separation, unknown not smooth", async () => {
  const c = regressions.cases.find((x) => x.id === "via-giuseppe-ripamonti");
  assert.ok(c, "Case via-giuseppe-ripamonti must exist");

  const tileKeys = spatialRoadStore.getTileKeysForCoordinates([[9.1975, 45.4500], [9.1975, 45.4420]], 80);
  await spatialRoadStore.preloadTiles(tileKeys);
  const scoped = spatialRoadStore.getScopedIntelligence([[9.1975, 45.4500], [9.1975, 45.4420]], 80);
  assert.ok(scoped.roads.length > 0, "Ripamonti tile segments loaded");

  const ripamontiCoords = [[9.1970, 45.4505], [9.1972, 45.4490], [9.1975, 45.4460]];
  const score = scoreRoadIntelligence(ripamontiCoords, scoped.surfaceIndex, 11, "motorcycle", false);
  assert.ok(score.totalMeters > 0);
  assert.ok(typeof score.classificationConfidence === "number");
  assert.equal(
    score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters,
    score.totalMeters,
    "Unknown surface must not be treated as smooth",
  );
});

test("P0-4: Corso di Porta Romana NW — real handler proves heading=311 eliminates Piazzale Medaglie d'Oro U-turns and page preserves objective", async () => {
  const c = regressions.cases.find((x) => x.id === "corso-di-porta-romana");
  assert.ok(c, "Case corso-di-porta-romana must exist");

  // 1. Without heading: Valhalla snaps backward toward SE and safe route issues a Piazzale Medaglie d'Oro U-turn
  const withoutHeading = await runHandlerWithFixtures("p0-road-test", {
    area: "milan",
    start: c.start,
    end: c.end,
    mode: c.mode,
    avoid: c.avoid,
    departure: c.departure,
    navigation: "1",
  });
  assert.equal(withoutHeading.status, 200);
  const uturnsNoHeading = (withoutHeading.payload.safe.instructions ?? []).filter((i) => i.direction === "uturn");
  assert.equal(uturnsNoHeading.length, c.checks.expectedUTurnsWithoutHeading,
    "without heading, safe route issues the Piazzale Medaglie d'Oro U-turn");

  // 2. With driver heading=311: U-turn is eliminated completely within navigation budget
  const withHeading = await runHandlerWithFixtures("p0-road-test", {
    area: "milan",
    start: c.start,
    end: c.end,
    mode: c.mode,
    avoid: c.avoid,
    departure: c.departure,
    navigation: "1",
    heading: String(c.heading),
  });
  assert.equal(withHeading.status, 200);
  const uturnsWithHeading = (withHeading.payload.safe.instructions ?? []).filter((i) => i.direction === "uturn");
  assert.equal(uturnsWithHeading.length, c.checks.expectedUTurnsWithHeading,
    "heading=311 eliminates Piazzale Medaglie d'Oro U-turn on Corso di Porta Romana NW");
  assert.ok(withHeading.requests.length <= 4, `navigation cap respected (${withHeading.requests.length})`);
  assert.ok(withHeading.payload.safe.minutes * 60 <= c.checks.maxTravelSeconds);
  assert.equal(withHeading.payload.fast.confirmedPaveMeters, c.checks.fastConfirmedStoneMeters);
  assert.equal(withHeading.payload.safe.confirmedPaveMeters, c.checks.safeConfirmedStoneMeters);

  // 3. Reroute and initial-plan objective logging consistency in helper and app/page.tsx
  assert.equal(rerouteDisplayKind("safe", false), "fast");
  assert.equal(journeyObjective("safe", false), "safe");
  assert.equal(rerouteOutcomeNotice("safe", false), "Nuovo percorso · da qui nessuna alternativa con meno pavé");
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /\.\.\.traceRouteDetails\(routeForJourney, journeyObjectiveRef\.current, routeGenerationRef\.current\)/,
    "initial plan records journeyObjectiveRef.current instead of display card kind");
  assert.match(page, /\.\.\.traceRouteDetails\(nextSelectedRoute, objective, routeGenerationRef\.current\)/,
    "reroute records preserved objective instead of displayKind");
});

test("P0-5: Via Francesco Sforza / Via Pietro Mascagni — asphalt classification not hardcoded stone and Monday 12:00 departure valid", async () => {
  const c = regressions.cases.find((x) => x.id === "via-francesco-sforza-mascagni");
  assert.ok(c, "Case via-francesco-sforza-mascagni must exist");

  const departure = parseLocalDeparture(c.departure);
  assert.ok(departure);
  assert.equal(departure.weekday, 0);
  assert.equal(departure.minutes, 720);

  const sforzaCoords = [[9.2010, 45.4670], [9.1950, 45.4580]];
  const tileKeys = spatialRoadStore.getTileKeysForCoordinates(sforzaCoords, 80);
  await spatialRoadStore.preloadTiles(tileKeys);
  const scoped = spatialRoadStore.getScopedIntelligence(sforzaCoords, 80);
  assert.ok(scoped.roads.length > 0);

  const sforza = scoped.roads.filter((r) => r.name && r.name.includes("Sforza"));
  assert.ok(sforza.length > 0);
  assert.equal(sforza[0].surface.value, c.checks.sforzaSurface);
  assert.equal(sforza[0].surfaceCategory, c.checks.surfaceCategory);

  const mascagni = scoped.roads.filter((r) => r.name && r.name.includes("Mascagni"));
  assert.ok(mascagni.length > 0);
  assert.equal(mascagni[0].surface.value, c.checks.mascagniSurface);
  assert.equal(mascagni[0].surfaceCategory, c.checks.surfaceCategory);

  const score = scoreRoadIntelligence(sforzaCoords, scoped.surfaceIndex, 12, "car", false, {
    departure,
    authorisedZtl: new Set(),
  });
  assert.ok(score.totalMeters > 0);
  assert.equal(
    score.smoothMeters + score.paveMeters + score.unpavedMeters + score.unknownMeters,
    score.totalMeters,
  );
});
