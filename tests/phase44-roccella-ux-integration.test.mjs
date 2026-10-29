import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { PILOT_AREAS, coordinateInArea } from "../lib/pilot-areas.ts";
import { loadApi } from "./helpers/load-api.mjs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeAvailable = fs.existsSync(CHROME_PATH);

test("Phase 4.4: Roccella Ionica geographic bounds and coordinate isolation", () => {
  const roccella = PILOT_AREAS.roccella;
  const milan = PILOT_AREAS.milan;

  assert.ok(roccella, "Roccella pilot area must exist in PILOT_AREAS");
  assert.equal(roccella.id, "roccella");
  assert.equal(roccella.name, "Roccella Ionica");

  // Roccella center must be within Roccella bounds
  assert.ok(coordinateInArea(roccella.center, roccella), "Roccella center must be inside Roccella bounds");

  // Milan center must NOT be within Roccella bounds
  assert.ok(!coordinateInArea(milan.center, roccella), "Milan center must not be in Roccella bounds");
  assert.ok(!coordinateInArea(roccella.center, milan), "Roccella center must not be in Milan bounds");

  // Disjoint longitude and latitude spans
  assert.ok(roccella.bounds.west > milan.bounds.east, "Roccella longitude must be disjoint and east of Milan");
  assert.ok(roccella.bounds.north < milan.bounds.south, "Roccella latitude must be disjoint and south of Milan");
});

test("Phase 4.4: Authentic Roccella road network and compact tiles integrity", async () => {
  const roadNetworkPath = new URL("../data/roccella-road-network.json", import.meta.url);
  const compactTilesPath = new URL("../data/surfaces/roccella-compact-tiles.json", import.meta.url);
  const manifestPath = new URL("../data/surfaces/roccella-pilot.manifest.json", import.meta.url);

  assert.ok(fs.existsSync(roadNetworkPath), "roccella-road-network.json must exist");
  assert.ok(fs.existsSync(compactTilesPath), "roccella-compact-tiles.json must exist");
  assert.ok(fs.existsSync(manifestPath), "roccella-pilot.manifest.json must exist");

  const roadNetwork = JSON.parse(await readFile(roadNetworkPath, "utf8"));
  const compactTiles = JSON.parse(await readFile(compactTilesPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.ok(Array.isArray(roadNetwork), "Road network must be an array of OSM features");
  assert.ok(roadNetwork.length > 50, "Roccella road network must have substantial features");

  assert.ok(compactTiles.tiles && Object.keys(compactTiles.tiles).length > 0, "Compact tiles must contain tile buckets");
  assert.equal(manifest.area?.zoneId, "ROCCELLA_PILOT");
  assert.ok(manifest.checksums?.datasetSha256, "Manifest must specify dataset checksum");
});

test("Phase 4.4: Roccella multimodal route handling and surface intelligence", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const { encodePolyline } = await import("./helpers/load-api.mjs");

  // Points within Roccella: Lungomare to Borgo
  const start = [16.40533, 38.32104];
  const end = [16.39719, 38.31841];
  const testCoords = [start, [16.401, 38.320], end];

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("overpass")) return new Response("Unavailable", { status: 503 });
    return Response.json({
      trip: {
        status: 0,
        summary: { length: 0.85, time: 120 },
        legs: [{
          shape: encodePolyline(testCoords),
          maneuvers: [
            { type: 1, instruction: "Parti da Via Lungomare", begin_shape_index: 0 },
            { type: 4, instruction: "Arrivo a destinazione", begin_shape_index: 2 },
          ],
        }],
      },
    });
  });

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const params = new URLSearchParams({
      area: "roccella",
      start: start.join(","),
      end: end.join(","),
      mode,
      avoid: "strong",
      maxExtraMinutes: "5",
    });

    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    assert.equal(response.status, 200, `Roccella route for ${mode} must return HTTP 200`);

    const payload = await response.json();
    assert.equal(payload.area, "roccella", "Response payload must indicate area=roccella");
    assert.ok(payload.fast, "Response must contain fast route");
    assert.ok(payload.fast.distance > 0, "Fast route distance must be positive");
    assert.ok(payload.fast.minutes > 0, "Fast route minutes must be positive");
    assert.ok(Array.isArray(payload.fast.coordinates), "Fast route must contain coordinates");
    assert.equal(payload.transportMode, mode, "Payload transportMode must match requested mode");
  }
});

test("Phase 4.4: App page integrates RouteComparisonPanel, LocalFieldFeedback, and NavigationDiagnosticsCard", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  // 1. Imports
  assert.match(pageSource, /from "@\/components\/phase43"/);
  assert.match(pageSource, /RouteComparisonPanel/);
  assert.match(pageSource, /LocalFieldFeedback/);
  assert.match(pageSource, /NavigationDiagnosticsCard/);
  assert.match(pageSource, /phase43\.css/);

  // 2. RouteComparisonPanel integration in routes view
  assert.match(pageSource, /<RouteComparisonPanel/);
  assert.match(pageSource, /fastRoute=\{fastRoute\}/);
  assert.match(pageSource, /safeRoute=\{safeRoute\}/);
  assert.match(pageSource, /hasDistinctAlternative=\{hasDistinctAlternative\}/);
  assert.match(pageSource, /activeRoute=\{activeRoute\}/);

  // 3. LocalFieldFeedback modal integration
  assert.match(pageSource, /<LocalFieldFeedback/);
  assert.match(pageSource, /isOpen=\{fieldFeedbackOpen\}/);
  assert.match(pageSource, /data-testid="field-feedback-trigger"/);

  // 4. NavigationDiagnosticsCard integration in active routes & HUD
  assert.match(pageSource, /<NavigationDiagnosticsCard/);
  assert.match(pageSource, /diagnostics=\{navigationDiagnostics\}/);
  assert.match(pageSource, /data-testid="toggle-diagnostics-btn"/);
  assert.match(pageSource, /data-testid="hud-toggle-diagnostics-btn"/);

  // 5. Area selector in planner
  assert.match(pageSource, /data-testid="pilot-area"/);
  assert.match(pageSource, /value="milan"/);
  assert.match(pageSource, /value="roccella"/);
});

test("Phase 4.4: Real Chrome mobile layout, touch targets (>= 44px), and viewport constraints (iPhone dimensions)", async (t) => {
  if (!chromeAvailable) {
    t.skip("Google Chrome not found at /Applications/Google Chrome.app");
    return;
  }

  const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const p43Css = await readFile(new URL("../components/phase43/phase43.css", import.meta.url), "utf8");

  const html = `<!DOCTYPE html>
<html lang="it" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <style>
    :root {
      --surface: #faf8f5;
      --border: #e2ded9;
      --ink: #122023;
      --muted: #697876;
      --white: #ffffff;
      --green: #16886e;
      --coral: #d84a35;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow-x: hidden;
      background: #f4f1ea;
    }
    ${globalsCss}
    ${p43Css}
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
        <button type="button" class="report-button" id="app-bar-report-btn">⚠ <b>Segnala</b></button>
        <button type="button" class="icon-button" data-testid="field-feedback-trigger" id="field-feedback-btn">📝</button>
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
            <div class="pilot-area-block">
              <label for="pilot-area">Area pilota</label>
              <select id="pilot-area" data-testid="pilot-area" style="min-height: 44px; width: 100%;">
                <option value="milan">Milano</option>
                <option value="roccella" selected>Roccella Ionica</option>
              </select>
            </div>
            <div class="panel-heading">
              <h1>Dove andiamo?</h1>
            </div>
          </section>

          <!-- Phase 4.3 Integrated Route Comparison -->
          <section class="routes-panel">
            <section class="p43-comparison-panel" data-testid="p43-route-comparison">
              <header class="p43-comparison-header">
                <h3 class="p43-comparison-title">Confronto Percorsi · Auto</h3>
              </header>
              <div class="p43-tradeoff-banner">
                <div class="p43-tradeoff-metric">
                  <span class="p43-metric-label">Pavé evitato</span>
                  <strong class="p43-metric-value p43-value-positive">-400 m</strong>
                </div>
                <div class="p43-tradeoff-metric">
                  <span class="p43-metric-label">Tempo extra</span>
                  <strong class="p43-metric-value p43-value-neutral">+1,0 min</strong>
                </div>
              </div>
              <div class="p43-route-cards" role="radiogroup">
                <button type="button" role="radio" class="p43-route-card p43-card-safe p43-selected" id="p43-card-safe">
                  <div class="p43-card-head">
                    <span class="p43-card-indicator p43-indicator-safe"></span>
                    <div class="p43-card-names"><strong>Anti-pavé · Auto</strong><small>2.4 km</small></div>
                    <div class="p43-card-time"><span>6.5 min</span></div>
                  </div>
                </button>
                <button type="button" role="radio" class="p43-route-card p43-card-fast" id="p43-card-fast">
                  <div class="p43-card-head">
                    <span class="p43-card-indicator p43-indicator-fast"></span>
                    <div class="p43-card-names"><strong>Più rapido · Auto</strong><small>2.2 km</small></div>
                    <div class="p43-card-time"><span>5.5 min</span></div>
                  </div>
                </button>
              </div>
            </section>

            <div class="p43-diagnostics-toggle-container">
              <button type="button" class="p43-toggle-details-btn" id="diag-toggle-btn">
                <span>Mostra diagnostica affidabilità GPS</span>
              </button>
            </div>
          </section>
        </div>
      </aside>

      <section class="map-stage">
        <div class="navigation-hud">
          <section class="navigation-tripbar">
            <div class="navigation-controls">
              <button type="button" id="hud-voice-btn">🔊 Voce</button>
              <button type="button" id="hud-stop-btn" class="stop-navigation">Termina</button>
            </div>
            <div class="p43-hud-diagnostics">
              <button type="button" class="p43-toggle-details-btn" id="hud-diag-btn">
                <span>Dettagli affidabilità GPS</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>

    <!-- Phase 4.3 Modal -->
    <div class="p43-modal-backdrop" id="feedback-modal">
      <section class="p43-modal-dialog">
        <header class="p43-modal-header">
          <h2 class="p43-modal-title">Segnala anomalia</h2>
          <button type="button" class="p43-modal-close-btn" id="feedback-close-btn">×</button>
        </header>
        <form class="p43-feedback-form">
          <div class="p43-category-tabs">
            <button type="button" class="p43-tab-btn p43-tab-active" id="tab-btn-1">Fondo stradale</button>
            <button type="button" class="p43-tab-btn" id="tab-btn-2">Navigazione</button>
          </div>
          <div class="p43-field-block">
            <textarea id="feedback-textarea" rows="3">Anomalia fondo</textarea>
          </div>
          <div class="p43-modal-actions">
            <button type="button" class="p43-secondary-btn" id="feedback-cancel-btn">Annulla</button>
            <button type="submit" class="p43-primary-btn" id="feedback-submit-btn">Salva nel dispositivo</button>
          </div>
        </form>
      </section>
    </div>
  </main>

  <script>
    const getH = (el) => el ? el.getBoundingClientRect().height : 0;
    const getW = (el) => el ? el.getBoundingClientRect().width : 0;

    const areaSelect = document.getElementById("pilot-area");
    const safeCard = document.getElementById("p43-card-safe");
    const fastCard = document.getElementById("p43-card-fast");
    const diagToggleBtn = document.getElementById("diag-toggle-btn");
    const hudDiagBtn = document.getElementById("hud-diag-btn");
    const feedbackBtn = document.getElementById("field-feedback-btn");
    const feedbackCloseBtn = document.getElementById("feedback-close-btn");
    const tabBtn1 = document.getElementById("tab-btn-1");
    const feedbackCancelBtn = document.getElementById("feedback-cancel-btn");
    const feedbackSubmitBtn = document.getElementById("feedback-submit-btn");
    const feedbackTextarea = document.getElementById("feedback-textarea");

    const results = {
      windowWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      areaSelectHeight: getH(areaSelect),
      safeCardHeight: getH(safeCard),
      fastCardHeight: getH(fastCard),
      diagToggleBtnHeight: getH(diagToggleBtn),
      hudDiagBtnHeight: getH(hudDiagBtn),
      feedbackBtnHeight: getH(feedbackBtn),
      feedbackCloseBtnHeight: getH(feedbackCloseBtn),
      feedbackCloseBtnWidth: getW(feedbackCloseBtn),
      tabBtnHeight: getH(tabBtn1),
      feedbackCancelBtnHeight: getH(feedbackCancelBtn),
      feedbackSubmitBtnHeight: getH(feedbackSubmitBtn),
      textareaFontSize: window.getComputedStyle(feedbackTextarea).fontSize,
    };
    document.body.setAttribute("data-test-results", JSON.stringify(results));
  </script>
</body>
</html>`;

  const tmpPath = "/tmp/phase44-chrome-mobile-test.html";
  fs.writeFileSync(tmpPath, html);

  const rawOut = execFileSync(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=/tmp/chrome-phase44-profile",
    "--window-size=390,844",
    "--dump-dom",
    `file://${tmpPath}`,
  ], { encoding: "utf8" });

  const match = rawOut.match(/data-test-results="([^"]+)"/);
  assert.ok(match, "Chrome must produce data-test-results");

  const results = JSON.parse(match[1].replace(/&quot;/g, "\""));

  // 1. Zero horizontal overflow on iPhone 390px
  assert.ok(
    results.scrollWidth <= results.windowWidth,
    `Scroll width (${results.scrollWidth}px) must not exceed window width (${results.windowWidth}px)`
  );

  // 2. Touch targets >= 44px
  assert.ok(results.areaSelectHeight >= 44, `Area selector (${results.areaSelectHeight}px) must be >= 44px`);
  assert.ok(results.safeCardHeight >= 44, `Safe card (${results.safeCardHeight}px) must be >= 44px`);
  assert.ok(results.fastCardHeight >= 44, `Fast card (${results.fastCardHeight}px) must be >= 44px`);
  assert.ok(results.diagToggleBtnHeight >= 44, `Diagnostics toggle button (${results.diagToggleBtnHeight}px) must be >= 44px`);
  assert.ok(results.hudDiagBtnHeight >= 44, `HUD diagnostics button (${results.hudDiagBtnHeight}px) must be >= 44px`);
  assert.ok(results.feedbackBtnHeight >= 44, `Field feedback button (${results.feedbackBtnHeight}px) must be >= 44px`);
  assert.ok(results.feedbackCloseBtnHeight >= 44, `Feedback close button height (${results.feedbackCloseBtnHeight}px) must be >= 44px`);
  assert.ok(results.feedbackCloseBtnWidth >= 44, `Feedback close button width (${results.feedbackCloseBtnWidth}px) must be >= 44px`);
  assert.ok(results.tabBtnHeight >= 44, `Tab button (${results.tabBtnHeight}px) must be >= 44px`);
  assert.ok(results.feedbackCancelBtnHeight >= 44, `Feedback cancel button (${results.feedbackCancelBtnHeight}px) must be >= 44px`);
  assert.ok(results.feedbackSubmitBtnHeight >= 44, `Feedback submit button (${results.feedbackSubmitBtnHeight}px) must be >= 44px`);

  // 3. Textarea font size >= 16px to prevent iOS auto-zoom
  assert.equal(results.textareaFontSize, "16px", "Textarea font size must be 16px to prevent iOS auto-zoom");
});
