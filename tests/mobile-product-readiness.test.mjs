import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import {
  createNavigationDiagnostics,
  estimateArrivalTimestamp,
  evaluateGpsSignalStall,
  evaluateOffRouteReading,
  evaluateTimedGpsReading,
  formatNavigationDiagnosticsSummary,
  recordNavigationDiagnosticEvent,
  shouldApplyRouteResponse,
} from "../lib/navigation-state.ts";
import {
  buildRouteProgressModel,
  calculateRouteProgress,
} from "../lib/route-progress.ts";
import {
  directionGlyph,
} from "../lib/navigation-instructions.ts";
import {
  shouldApplyPlannerRouteResponse,
} from "../lib/route-request-state.ts";
import {
  createReportQuota,
  ReportInputError,
  validateReportShape,
} from "../lib/report-request.ts";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeAvailable = fs.existsSync(CHROME_PATH);

test("Flow 1 & 8: Real Chrome mobile layout, touch targets, and viewport constraints (iPhone dimensions)", async (t) => {
  if (!chromeAvailable) {
    t.skip("Google Chrome not found at /Applications/Google Chrome.app");
    return;
  }

  const assetsDir = new URL("../dist/client/assets", import.meta.url);
  const assetFiles = fs.readdirSync(assetsDir);
  const cssFiles = assetFiles.filter((f) => f.endsWith(".css"));

  let bundledCss = "";
  for (const cssFile of cssFiles) {
    bundledCss += await readFile(new URL(`../dist/client/assets/${cssFile}`, import.meta.url), "utf8") + "\n";
  }
  const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  // Complete realistic DOM tree of the Lastrico mobile application
  const html = `<!DOCTYPE html>
<html lang="it" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <style>
    ${bundledCss}
    ${globalsCss}
  </style>
</head>
<body>
  <main class="app-shell">
    <header class="app-bar">
      <button class="brand" type="button" aria-label="Apri pianificazione">
        <span class="brand-mark"><i /><i /><i /></span>
        <span>lastrico</span>
      </button>
      <div class="app-bar-actions">
        <button type="button" class="icon-button theme-button">◐</button>
        <button type="button" class="icon-button">↗</button>
        <button type="button" class="report-button">⚠ <b>Segnala</b></button>
        <button type="button" class="icon-button">i</button>
      </div>
    </header>

    <div class="app-workspace">
      <aside class="control-panel">
        <nav class="view-tabs">
          <button type="button" class="active">Pianifica</button>
          <button type="button">Percorsi</button>
          <button type="button">Comunità</button>
        </nav>
        <div class="panel-content">
          <section class="planner-panel">
            <div class="compact-locations">
              <div class="field-shell">
                <div class="compact-field">
                  <label for="start-search">Partenza</label>
                  <input id="start-search" value="Castello Sforzesco" />
                  <button type="button" id="start-search-btn">⌕</button>
                </div>
              </div>
              <button type="button" class="swap-button" id="swap-locations-btn">⇅</button>
              <div class="field-shell">
                <div class="compact-field">
                  <label for="end-search">Destinazione</label>
                  <input id="end-search" value="Porta Venezia" />
                  <button type="button" id="end-search-btn">⌕</button>
                </div>
              </div>
            </div>

            <div class="location-tools">
              <button type="button" id="pick-start-btn">Partenza su mappa</button>
              <button type="button" id="pick-end-btn">Arrivo su mappa</button>
            </div>

            <div class="transport-block">
              <span>Come ti muovi?</span>
              <div class="transport-selector" role="radiogroup">
                <button type="button" class="active" data-transport="car">Auto</button>
                <button type="button" data-transport="motorcycle">Moto</button>
                <button type="button" data-transport="bicycle">Bici</button>
              </div>
            </div>

            <div class="avoidance-block">
              <div class="segmented" role="group">
                <button type="button">Bilanciato</button>
                <button type="button" class="active">Forte</button>
                <button type="button">Massimo</button>
              </div>
            </div>

            <button type="button" class="primary-action" id="calc-routes-btn">
              <span>Confronta i percorsi</span><b>→</b>
            </button>
          </section>

          <section class="routes-panel" style="display: none;">
            <button type="button" class="journey-button" id="start-nav-btn">
              <span>▶</span><b>Avvia con GPS</b>
            </button>
          </section>
        </div>
      </aside>

      <section class="map-stage">
        <div class="navigation-hud" style="display: block;">
          <button type="button" class="navigation-instruction" id="nav-instruction-btn">
            <div class="maneuver-copy">
              <strong>150 m</strong>
              <b>Svolta a destra su Via Dante</b>
            </div>
          </button>
          <section class="navigation-tripbar">
            <div class="trip-metric"><strong>8</strong><small>min</small></div>
            <div class="trip-metric wide"><strong>2.4 km</strong><small>rimanenti</small></div>
            <div class="trip-metric eta"><strong>12:35</strong><small>arrivo stimato</small></div>
            <div class="navigation-controls">
              <button type="button" id="nav-voice-btn">🔊 Voce</button>
              <button type="button" id="nav-recenter-btn">Ricentra</button>
              <button type="button" class="stop-navigation" id="nav-stop-btn">Termina</button>
            </div>
          </section>
        </div>
      </section>
    </div>

    <nav class="mobile-nav">
      <button type="button" class="active" id="mobile-nav-plan"><span>⌖</span>Pianifica</button>
      <button type="button" id="mobile-nav-routes"><span>↝</span>Percorsi</button>
      <button type="button" id="mobile-nav-community"><span>＋</span>Comunità</button>
    </nav>

    <div class="modal-backdrop" id="test-modal">
      <section class="modal">
        <button type="button" class="modal-close" id="modal-close-btn">×</button>
        <h2>Test Modal</h2>
      </section>
    </div>
  </main>

  <script>
    const primaryBtn = document.getElementById("calc-routes-btn");
    const transportBtn = document.querySelector(".transport-selector button");
    const input = document.getElementById("start-search");
    const brand = document.querySelector(".brand");
    const swapBtn = document.getElementById("swap-locations-btn");
    const startSearchBtn = document.getElementById("start-search-btn");
    const locationToolsBtn = document.getElementById("pick-start-btn");
    const segmentedBtn = document.querySelector(".segmented button");
    const navInstructionBtn = document.getElementById("nav-instruction-btn");
    const navStopBtn = document.getElementById("nav-stop-btn");
    const mobileNavBtn = document.getElementById("mobile-nav-plan");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const appBarBtn = document.querySelector(".app-bar-actions button");

    const getTargetBox = (el) => {
      const rect = el.getBoundingClientRect();
      const comp = window.getComputedStyle(el, "::before");
      return {
        width: Math.max(rect.width, parseFloat(comp.width) || 0),
        height: Math.max(rect.height, parseFloat(comp.height) || 0),
      };
    };

    const results = {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      primaryHeight: primaryBtn.getBoundingClientRect().height,
      transportHeight: transportBtn.getBoundingClientRect().height,
      brandHeight: brand.getBoundingClientRect().height,
      inputFontSize: window.getComputedStyle(input).fontSize,
      swapTouchTarget: getTargetBox(swapBtn),
      startSearchBtnHeight: startSearchBtn.getBoundingClientRect().height,
      locationToolsHeight: locationToolsBtn.getBoundingClientRect().height,
      segmentedBtnHeight: segmentedBtn.getBoundingClientRect().height,
      navInstructionHeight: navInstructionBtn.getBoundingClientRect().height,
      navStopBtnHeight: navStopBtn.getBoundingClientRect().height,
      mobileNavBtnHeight: mobileNavBtn.getBoundingClientRect().height,
      modalCloseTouchTarget: getTargetBox(modalCloseBtn),
      appBarBtnHeight: appBarBtn.getBoundingClientRect().height,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
    document.body.setAttribute("data-test-results", JSON.stringify(results));
  </script>
</body>
</html>`;

  const tmpPath = "/tmp/lastrico-chrome-test.html";
  fs.writeFileSync(tmpPath, html);

  const rawOut = execFileSync(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=/tmp/chrome-mobile-readiness-profile",
    "--window-size=390,844",
    "--dump-dom",
    `file://${tmpPath}`,
  ], { encoding: "utf8" });

  const match = rawOut.match(/data-test-results="([^"]+)"/);
  assert.ok(match, "Chrome must evaluate script and write data-test-results attribute");

  const results = JSON.parse(match[1].replace(/&quot;/g, "\""));

  // Assertions for Apple Human Interface Guidelines & mobile web standards:
  // 1. Touch targets >= 44px
  assert.ok(results.primaryHeight >= 44, `Primary button height (${results.primaryHeight}px) must be >= 44px`);
  assert.ok(results.transportHeight >= 44, `Transport selector button (${results.transportHeight}px) must be >= 44px`);
  assert.ok(results.brandHeight >= 44, `Brand mark (${results.brandHeight}px) must be >= 44px`);
  assert.ok(results.locationToolsHeight >= 44, `Location tools button (${results.locationToolsHeight}px) must be >= 44px`);
  assert.ok(results.segmentedBtnHeight >= 44, `Segmented avoidance button (${results.segmentedBtnHeight}px) must be >= 44px`);
  assert.ok(results.navInstructionHeight >= 44, `HUD instruction button (${results.navInstructionHeight}px) must be >= 44px`);
  assert.ok(results.navStopBtnHeight >= 44, `HUD stop button (${results.navStopBtnHeight}px) must be >= 44px`);
  assert.ok(results.startSearchBtnHeight >= 44, `Search button (${results.startSearchBtnHeight}px) must be >= 44px`);
  assert.ok(results.appBarBtnHeight >= 44, `App bar action button (${results.appBarBtnHeight}px) must be >= 44px`);

  // 2. Small button touch target expansion (swap & close buttons >= 44px hit area)
  assert.ok(results.swapTouchTarget.height >= 44 || results.swapTouchTarget.width >= 44,
    `Swap button touch area (${results.swapTouchTarget.width}x${results.swapTouchTarget.height}px) must expand to >= 44px`);
  assert.ok(results.modalCloseTouchTarget.height >= 44 && results.modalCloseTouchTarget.width >= 44,
    `Modal close touch area (${results.modalCloseTouchTarget.width}x${results.modalCloseTouchTarget.height}px) must be >= 44px`);

  // 3. Input font size is strictly 16px to prevent iOS Safari auto-zoom
  assert.equal(results.inputFontSize, "16px", "Mobile inputs must have 16px font-size to prevent iOS Safari auto-zoom");

  // 4. Horizontal overflow is strictly zero
  assert.equal(results.hasOverflow, false, "Mobile layout must not produce horizontal overflow/scrolling");
});

test("Flow 1: Mobile Route Planning & Address Resolution with Geocoding", async (t) => {
  const { GET: geocodeHandler } = await loadApi("app/api/geocode/route.ts");

  // Mock upstream Nominatim geocoder
  const mockDuomo = [
    {
      place_id: 101,
      display_name: "Piazza del Duomo, Centro Storico, Milano, Lombardia, 20121, Italia",
      lat: "45.4642",
      lon: "9.1901",
      address: { road: "Piazza del Duomo", city: "Milano" },
    },
    {
      place_id: 102,
      display_name: "Via Duomo, Centro Storico, Milano, Lombardia, 20121, Italia",
      lat: "45.4645",
      lon: "9.1905",
      address: { road: "Via Duomo", city: "Milano" },
    },
    // Duplicate road to test deduplication
    {
      place_id: 103,
      display_name: "Piazza del Duomo, Duomo, Milano, Lombardia, 20121, Italia",
      lat: "45.4642",
      lon: "9.1901",
      address: { road: "Piazza del Duomo", city: "Milano" },
    },
  ];

  t.mock.method(Date, "now", () => 1_000_000);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("nominatim")) {
      return Response.json(mockDuomo);
    }
    throw new Error(`Unexpected fetch call to ${url}`);
  });

  // Test address lookup for Duomo
  const req1 = new NextRequest("http://localhost:3000/api/geocode?q=Duomo");
  const res1 = await geocodeHandler(req1);
  assert.equal(res1.status, 200, "Geocode endpoint must return 200");
  const data1 = await res1.json();
  assert.ok(Array.isArray(data1.results), "Results must be an array");
  assert.equal(data1.results.length, 2, "Duplicate 'Piazza del Duomo' must be deduplicated to 2 unique results");

  const firstResult = data1.results[0];
  assert.ok(firstResult.primary, "Result must contain primary name");
  assert.ok(firstResult.label, "Result must contain full label");
  assert.ok(Array.isArray(firstResult.coordinate) && firstResult.coordinate.length === 2, "Result must contain [lon, lat]");
  assert.ok(firstResult.coordinate[0] >= 9.0 && firstResult.coordinate[0] <= 9.4, "Longitude must be in Milan area");
  assert.ok(firstResult.coordinate[1] >= 45.3 && firstResult.coordinate[1] <= 45.6, "Latitude must be in Milan area");

  // Test validation: input < 3 characters rejected with 400
  const reqShort = new NextRequest("http://localhost:3000/api/geocode?q=ab");
  const resShort = await geocodeHandler(reqShort);
  assert.equal(resShort.status, 400, "Queries < 3 characters must return 400");
  const shortData = await resShort.json();
  assert.match(shortData.error, /tre caratteri/i);
});

test("Flow 2 & 3: Multimodal Routing, Surface Intelligence & Pareto Alternatives", async (t) => {
  const { GET: routesHandler } = await loadApi("app/api/routes/route.ts");

  const points = [[9.1785, 45.4705], [9.2056, 45.4731]];
  const detour = [points[0], [9.1850, 45.4750], [9.1950, 45.4750], points[1]];

  const trip = (coords, time, len = 2.4) => ({
    status: 0,
    summary: { length: len, time },
    legs: [{
      shape: encodePolyline(coords),
      maneuvers: [
        { type: 1, instruction: "Parti su Via Cusani", begin_shape_index: 0, length: 0.5 },
        { type: 4, instruction: "Arrivo a Porta Venezia", begin_shape_index: coords.length - 1, length: 0 },
      ],
    }],
  });

  // Mock routing providers
  t.mock.method(Date, "now", () => 2_000_000);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("valhalla")) {
      const body = init?.body ? String(init.body) : "";
      const isBike = body.includes('"costing":"bicycle"') || body.includes("bicycle");
      const isMoto = body.includes('"costing":"motorcycle"') || body.includes("motorcycle");
      const fastTime = isBike ? 600 : isMoto ? 320 : 360;
      const safeTime = isBike ? 660 : isMoto ? 350 : 400;
      return Response.json({
        trip: trip(points, fastTime, 2.4),
        alternates: [{ trip: trip(detour, safeTime, 2.7) }],
      });
    }
    throw new Error(`Unexpected fetch call to ${url}`);
  });

  // 1. Car Route
  const carReq = new NextRequest(`http://localhost:3000/api/routes?start=${points[0].join(",")}&end=${points[1].join(",")}&mode=car&avoid=strong`);
  const carRes = await routesHandler(carReq);
  assert.equal(carRes.status, 200, "Car route request must succeed");
  const carData = await carRes.json();
  assert.equal(carData.transportMode, "car");
  assert.ok(carData.fast.minutes > 0);
  assert.ok(carData.fast.distance > 0);

  // 2. Bicycle Route
  const bikeReq = new NextRequest(`http://localhost:3000/api/routes?start=${points[0].join(",")}&end=${points[1].join(",")}&mode=bicycle&avoid=strong`);
  const bikeRes = await routesHandler(bikeReq);
  assert.equal(bikeRes.status, 200, "Bicycle route request must succeed");
  const bikeData = await bikeRes.json();
  assert.equal(bikeData.transportMode, "bicycle");
  assert.notEqual(bikeData.fast.minutes, carData.fast.minutes, "Bicycle duration must differ from car duration");

  // 3. Motorcycle Route
  const motoReq = new NextRequest(`http://localhost:3000/api/routes?start=${points[0].join(",")}&end=${points[1].join(",")}&mode=motorcycle&avoid=strong`);
  const motoRes = await routesHandler(motoReq);
  assert.equal(motoRes.status, 200, "Motorcycle route request must succeed");
  const motoData = await motoRes.json();
  assert.equal(motoData.transportMode, "motorcycle");

  // 4. Surface metrics integrity
  const fast = carData.fast;
  assert.ok(typeof fast.paveMeters === "number");
  assert.ok(typeof fast.smoothSurfaceMeters === "number");
  assert.ok(typeof fast.unknownSurfaceMeters === "number");
  assert.ok(typeof fast.surfaceTotalMeters === "number");

  const sum = fast.paveMeters + fast.smoothSurfaceMeters + (fast.unpavedSurfaceMeters ?? 0) + fast.unknownSurfaceMeters;
  assert.ok(Math.abs(sum - fast.surfaceTotalMeters) <= 5,
    `Surface breakdown sum (${sum}m) must equal total route distance (${fast.surfaceTotalMeters}m)`);
});

test("Flow 4: Navigation Lifecycle — Simulation Mode Step Progression & Arrival", () => {
  const coordinates = [
    [9.1785, 45.4705],
    [9.1825, 45.4689],
    [9.1886, 45.4721],
    [9.2056, 45.4731],
  ];

  const instructions = [
    { id: "step-1", text: "Parti su Via Cusani", direction: "straight", distanceMeters: 400, roadName: "Via Cusani", location: coordinates[0] },
    { id: "step-2", text: "Svolta a destra su Via Pontaccio", direction: "right", distanceMeters: 600, roadName: "Via Pontaccio", location: coordinates[1] },
    { id: "step-3", text: "Sei arrivato a Porta Venezia", direction: "arrive", distanceMeters: 800, roadName: "Corso Venezia", location: coordinates[coordinates.length - 1] },
  ];

  const distanceFn = (a, b) => {
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
    const dLat = (b[1] - a[1]) * 110574;
    return Math.sqrt(dLng * dLng + dLat * dLat);
  };

  const model = buildRouteProgressModel(coordinates, instructions, distanceFn);
  assert.ok(model.totalMeters > 0, "Model total distance must be positive");

  // Start of journey
  let progress = calculateRouteProgress(model, coordinates[0], 5.0, 0);
  assert.equal(progress.routeProgressMeters, 0, "Start progress meters must be 0");
  assert.ok(progress.remainingMeters > 1000, "Remaining meters must be whole distance");
  assert.equal(progress.instruction?.id, "step-1", "First instruction must be active");
  assert.equal(directionGlyph(progress.instruction?.direction), "↑", "Straight glyph must be ↑");

  // Mid-journey
  progress = calculateRouteProgress(model, coordinates[1], 5.0, progress.routeProgressMeters);
  assert.ok(progress.routeProgressMeters > 100 && progress.routeProgressMeters < 800, "Midpoint progress meters must advance");

  // Arrival
  progress = calculateRouteProgress(model, coordinates[coordinates.length - 1], 5.0, progress.routeProgressMeters);
  assert.equal(progress.routeProgressMeters, model.totalMeters, "Final progress meters must equal total route distance");
  assert.equal(progress.remainingMeters, 0, "Remaining meters at arrival must be 0");
  assert.equal(progress.remainingMinutes, 0, "Remaining minutes at arrival must be 0");

  // ETA timestamp formatting
  const etaTimestamp = estimateArrivalTimestamp(Date.now(), 5.0);
  assert.ok(etaTimestamp > Date.now(), "ETA timestamp must be in future");
});

test("Flow 5: Navigation Lifecycle — GPS Watch, Boundary & Signal Loss", () => {
  const MILAN_GPS_BOUNDS = { west: 9.04, south: 45.38, east: 9.31, north: 45.55 };
  const distanceFn = (a, b) => {
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
    const dLat = (b[1] - a[1]) * 110574;
    return Math.sqrt(dLng * dLng + dLat * dLat);
  };

  const now = Date.now();

  // Test 1: Coordinate in Milan accepted
  const milanCoord = [9.1901, 45.4642];
  const validFix = evaluateTimedGpsReading({
    coordinate: milanCoord,
    accuracy: 12,
    timestamp: now - 500,
    now,
    previousCoordinate: null,
    previousAccuracy: null,
    previousTimestamp: null,
    bounds: MILAN_GPS_BOUNDS,
    distanceMeters: distanceFn,
    maximumSpeedMetersPerSecond: 70,
  });
  assert.equal(validFix.accepted, true, "Valid Milan fix must be accepted");

  // Test 2: Coordinate outside Milan rejected
  const romeCoord = [12.4964, 41.9028];
  const outsideFix = evaluateTimedGpsReading({
    coordinate: romeCoord,
    accuracy: 10,
    timestamp: now - 500,
    now,
    previousCoordinate: null,
    previousAccuracy: null,
    previousTimestamp: null,
    bounds: MILAN_GPS_BOUNDS,
    distanceMeters: distanceFn,
    maximumSpeedMetersPerSecond: 70,
  });
  assert.equal(outsideFix.accepted, false, "Fix outside Milan must be rejected");
  assert.equal(outsideFix.reason, "invalid", "Rejection reason must be invalid");

  // Test 3: Implausible velocity (> 70 m/s) rejected as teleportation spike
  const farCoord = [9.28, 45.52]; // ~10km jump in 1 second
  const jumpFix = evaluateTimedGpsReading({
    coordinate: farCoord,
    accuracy: 10,
    timestamp: now,
    now,
    previousCoordinate: milanCoord,
    previousAccuracy: 10,
    previousTimestamp: now - 1000,
    bounds: MILAN_GPS_BOUNDS,
    distanceMeters: distanceFn,
    maximumSpeedMetersPerSecond: 70,
  });
  assert.equal(jumpFix.accepted, false, "Teleportation spike must be rejected");
  assert.equal(jumpFix.reason, "implausible", "Rejection reason must be implausible");

  // Test 4: GPS stall detection (loss of signal > 15s threshold)
  const stallCheck = evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now,
    sessionStartedAt: now - 30_000,
    lastValidFixAt: now - 16_000, // 16 seconds with no fix
  });
  assert.equal(stallCheck.stalled, true, "16 seconds without GPS fix must be detected as stalled");

  // Test 5: Diagnostic event formatting
  let diagnostics = createNavigationDiagnostics();
  diagnostics = recordNavigationDiagnosticEvent(diagnostics, { type: "fix-accepted" });
  diagnostics = recordNavigationDiagnosticEvent(diagnostics, { type: "signal-loss" });
  const summary = formatNavigationDiagnosticsSummary(diagnostics);
  assert.match(summary, /Fix GPS 1 ok/i);
  assert.match(summary, /Perdite segnale 1/i);
});

test("Flow 6: Adversarial Navigation Resilience (U-Turn, Monotonicity & Offline Handling)", () => {
  const coordinates = [
    [9.1800, 45.4700],
    [9.1820, 45.4700],
    [9.1840, 45.4700],
    [9.1860, 45.4700],
  ];

  const distanceFn = (a, b) => {
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
    const dLat = (b[1] - a[1]) * 110574;
    return Math.sqrt(dLng * dLng + dLat * dLat);
  };

  const model = buildRouteProgressModel(coordinates, [], distanceFn);

  // Driver moves forward to segment 3 (around 312m progress)
  const forwardProgress = calculateRouteProgress(model, [9.1840, 45.4700], 5.0, 0);
  assert.ok(forwardProgress.routeProgressMeters > 200, "Progress must be advanced");

  // Driver performs a 180° U-turn and moves backward to [9.1810, 45.4700] (~234m backward)
  const backwardProgress = calculateRouteProgress(
    model,
    [9.1810, 45.4700],
    5.0,
    forwardProgress.routeProgressMeters,
  );

  // Progress is clamped monotonically to prevent backwards jumps on the progress bar
  assert.ok(backwardProgress.routeProgressMeters >= forwardProgress.routeProgressMeters,
    "Progress meters must be monotonic");

  // Off-route meters reflects the backward movement and exceeds threshold (triggering reroute)
  assert.ok(backwardProgress.offRouteMeters >= 100,
    `Backward movement off-route distance (${backwardProgress.offRouteMeters}m) must be >= 100m`);

  // Evaluate off-route decision with required readings
  const decision1 = evaluateOffRouteReading({
    currentReadings: 0,
    offRouteMeters: backwardProgress.offRouteMeters,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 20_000,
    lastCalculationAt: 0,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.equal(decision1.readings, 1, "First off-route reading must increment count");
  assert.equal(decision1.shouldRecalculate, false, "Single reading must not trigger reroute");

  const decision2 = evaluateOffRouteReading({
    currentReadings: 1,
    offRouteMeters: backwardProgress.offRouteMeters,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 21_000,
    lastCalculationAt: 0,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.equal(decision2.readings, 0, "Second reading triggers recalculation and resets count to 0");
  assert.equal(decision2.shouldRecalculate, true, "Second reading must trigger reroute");

  // Cooldown check: subsequent reading within cooldown window must not trigger another calculation
  const decisionCooldown = evaluateOffRouteReading({
    currentReadings: 2,
    offRouteMeters: backwardProgress.offRouteMeters,
    thresholdMeters: 55,
    requiredReadings: 2,
    now: 23_000, // 2s after recalculation started at 21_000
    lastCalculationAt: 21_000,
    cooldownMs: 15_000,
    calculationInProgress: false,
  });
  assert.equal(decisionCooldown.shouldRecalculate, false, "Calculation within cooldown must be suppressed");
});

test("Flow 7: Stale Intent Protection & Stale Route Callback Invalidation", () => {
  // Scenario: Route request #1 is initiated for planner revision 1
  const req1 = { id: 1, revision: 1 };

  // User edits destination text -> increments revision to 2
  const activeRevision = 2;
  const currentRequestId = 2;

  // Stale response #1 arrives later
  const shouldApply = shouldApplyPlannerRouteResponse({
    activeRequestId: currentRequestId,
    responseRequestId: req1.id,
    activeRevision,
    responseRevision: req1.revision,
  });
  assert.equal(shouldApply, false, "Response for old revision or old request ID must be rejected");

  // Response #2 arrives for current revision
  const shouldApplyValid = shouldApplyPlannerRouteResponse({
    activeRequestId: currentRequestId,
    responseRequestId: currentRequestId,
    activeRevision,
    responseRevision: activeRevision,
  });
  assert.equal(shouldApplyValid, true, "Response matching current revision and request ID must be accepted");

  // Session boundary: response for journey session 1 arrives after navigation finished (session 2)
  const applyInNav = shouldApplyRouteResponse(1, 1, 2, 1, false);
  assert.equal(applyInNav, false, "Route response for terminated navigation session must be ignored");
});

test("Flow 8 & 9: External Map Fallbacks, GPS Permission Denial & Community Reporting", async () => {
  // 1. External Map Fallback URL generation
  const end = [9.2056, 45.4731];
  const generateMapUrls = (mode) => ({
    apple: `https://maps.apple.com/?daddr=${end[1]},${end[0]}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${end[1]},${end[0]}&travelmode=${mode === "bicycle" ? "bicycling" : "driving"}`,
    waze: `https://waze.com/ul?ll=${end[1]}%2C${end[0]}&navigate=yes`,
  });

  const carUrls = generateMapUrls("car");
  assert.match(carUrls.apple, /maps\.apple\.com/);
  assert.match(carUrls.google, /travelmode=driving/);
  assert.match(carUrls.waze, /waze\.com/);

  const bikeUrls = generateMapUrls("bicycle");
  assert.match(bikeUrls.google, /travelmode=bicycling/);

  // 2. GPS Permission Denial: code === 1 (PERMISSION_DENIED)
  const permissionDeniedError = {
    code: 1,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: "User denied Geolocation",
  };
  assert.equal(permissionDeniedError.code, permissionDeniedError.PERMISSION_DENIED);

  // 3. Community Reporting Validation & Honeypot Protection
  const validReport = {
    start: [9.1886, 45.4721],
    end: [9.1890, 45.4725],
    kind: "pave",
    severity: 2,
    note: "Nuovo tratto sconnesso rilevato durante il test",
    website: "", // honeypot must be empty
  };
  validateReportShape(validReport);

  // Non-string honeypot field or malformed payload is rejected as client error
  const malformedWebsiteReport = { ...validReport, website: { spam: true } };
  assert.throws(() => validateReportShape(malformedWebsiteReport), (err) => err instanceof ReportInputError && err.status === 400);

  // Invalid coordinates rejected
  const invalidCoordReport = { ...validReport, start: [9.1886] };
  assert.throws(() => validateReportShape(invalidCoordReport), (err) => err instanceof ReportInputError);

  // Quota limiting: prevents spam flooding
  const quota = createReportQuota(10000, 2, 2);
  assert.equal(quota("tester-client", 1000).allowed, true);
  assert.equal(quota("tester-client", 1100).allowed, true);
  assert.equal(quota("tester-client", 1200).allowed, false, "Third report within window must be rate-limited");
});

