import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeAvailable = fs.existsSync(CHROME_PATH);
const root = new URL("../", import.meta.url);

test("Phase 4.8: Roccella Road Intelligence coverage recovery with authentic provenance", async () => {
  const manifestPath = new URL("data/surfaces/roccella-pilot.manifest.json", root);
  const segmentsPath = new URL("data/surfaces/roccella-pilot.json", root);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const segments = JSON.parse(await readFile(segmentsPath, "utf8"));

  assert.equal(manifest.area.zoneId, "ROCCELLA_PILOT");
  assert.equal(manifest.statistics.totalLengthMeters, 176542);

  const breakdown = manifest.statistics.surfaceBreakdownMeters;
  assert.equal(breakdown.confirmed_rough, 0, "No confirmed rough pavé in Roccella pilot bounds (0 m)");
  assert.equal(breakdown.probable_rough, 390, "Paving stones must be probable rough (390 m)");
  assert.equal(breakdown.confirmed_smooth, 30921, "Asphalt with explicit tags must be confirmed smooth (30921 m)");
  assert.equal(breakdown.unpaved_loose, 8160, "Explicit unpaved tags must be unpaved loose (8160 m)");
  assert.equal(breakdown.unknown, 137071, "Unknown must faithfully reflect untagged roads without fabrication (137071 m, 77.64%)");

  const unknownPercent = (breakdown.unknown / manifest.statistics.totalLengthMeters) * 100;
  assert.ok(Math.abs(unknownPercent - 77.64) < 0.1, `Unknown percentage (${unknownPercent.toFixed(2)}%) must match authentic OSM baseline 77.64%`);

  // Verify track without explicit surface: remains strictly unknown without overstating certainty
  const trackUnknownSeg = segments.find((s) => s.highwayClass === "track" && (!s.rawTags || (!s.rawTags.surface && !s.rawTags.tracktype)));
  assert.ok(trackUnknownSeg, "Track segment without surface must exist");
  assert.equal(trackUnknownSeg.surfaceCategory, "unknown");
  assert.equal(trackUnknownSeg.surface.state, "unknown");
  assert.equal(trackUnknownSeg.surface.value, "unknown");

  // Verify track with explicit surface: correctly classified with known provenance
  const trackTaggedSeg = segments.find((s) => s.highwayClass === "track" && s.rawTags?.surface === "unpaved");
  assert.ok(trackTaggedSeg, "Track segment with explicit surface=unpaved must exist");
  assert.equal(trackTaggedSeg.surfaceCategory, "unpaved_loose");
  assert.equal(trackTaggedSeg.surface.state, "known");
  assert.equal(trackTaggedSeg.surface.authority, "osm_curated");

  // Verify steps: handled as structural obstacle with modal restrictions, not a surface material
  const stepSeg = segments.find((s) => s.highwayClass === "steps");
  assert.ok(stepSeg, "Step segment must exist");
  assert.equal(stepSeg.surfaceCategory, "unknown");
  assert.equal(stepSeg.surface.value, "unknown");
  assert.equal(stepSeg.roughnessWeight, 0.0);
  assert.equal(stepSeg.isMotorAllowed, false, "Motor vehicles strictly prohibited on steps");
  assert.equal(stepSeg.isBicycleAllowed, false, "Bicycles prohibited on steps without explicit ramp");
  assert.equal(stepSeg.modeAccess.car, false);
  assert.equal(stepSeg.modeAccess.motorcycle, false);
  assert.equal(stepSeg.modeAccess.bicycle, false);

  // Verify cycleway without explicit surface: infrastructure known, surface strictly unknown
  const cycleSeg = segments.find((s) => s.highwayClass === "cycleway" && (!s.rawTags || !s.rawTags.surface));
  assert.ok(cycleSeg, "Cycleway segment must exist");
  assert.equal(cycleSeg.surfaceCategory, "unknown");
  assert.equal(cycleSeg.surface.state, "unknown");
  assert.equal(cycleSeg.surface.value, "unknown");
  assert.equal(cycleSeg.cycling.value.hasFacility, true);
  assert.equal(cycleSeg.cycling.value.typology, "sede_propria");
  assert.equal(cycleSeg.isBicycleAllowed, true);

  // Verify unclassified and residential without surface remain strictly unknown
  const unclassUnknown = segments.filter((s) => s.highwayClass === "unclassified" && (!s.rawTags || !s.rawTags.surface));
  assert.ok(unclassUnknown.length > 0, "Unclassified ways without surface must exist");
  assert.ok(unclassUnknown.every((s) => s.surfaceCategory === "unknown"), "Untagged unclassified streets must NEVER be guessed as smooth");

  const residUnknown = segments.filter((s) => s.highwayClass === "residential" && (!s.rawTags || !s.rawTags.surface));
  assert.ok(residUnknown.length > 0, "Residential ways without surface must exist");
  assert.ok(residUnknown.every((s) => s.surfaceCategory === "unknown"), "Untagged residential streets must NEVER be guessed as smooth");
});

test("Phase 4.8: Milan road intelligence and checksum reproducibility remain untouched", async () => {
  const milanManifestPath = new URL("data/surfaces/milan-central.manifest.json", root);
  const milanManifest = JSON.parse(await readFile(milanManifestPath, "utf8"));

  assert.equal(milanManifest.area.zoneId, "MIL_CENTRE_PILOT");
  assert.equal(milanManifest.checksums.datasetSha256, "267b01744a33146e5ec237dc1fa4df907d7427f7e121b3ba0cc3c3aaa67f5586");
});

test("Phase 4.8: Headless Chrome responsive testing across iPhone SE, 13/14/15, and Pro Max", async (t) => {
  if (!chromeAvailable) {
    t.skip("Google Chrome not available in environment");
    return;
  }

  const viewports = [
    { name: "iPhone SE", width: 375, height: 667 },
    { name: "iPhone 13/14/15/16", width: 390, height: 844 },
    { name: "iPhone Pro Max", width: 428, height: 926 },
  ];

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <link rel="stylesheet" href="file://${new URL("app/globals.css", root).pathname}" />
      <link rel="stylesheet" href="file://${new URL("components/phase43/phase43.css", root).pathname}" />
      <style>
        :root {
          --surface: #faf8f5;
          --border: #e2ded9;
          --ink: #122023;
          --muted: #697876;
          --green: #16886e;
          --green-soft: #e1f3ed;
          --white: #ffffff;
          --metric-value: #122023;
          --metric-label: #697876;
          --metric-accent: #16886e;
          --surface-2: #ffffff;
          --overlay-bg: rgba(255, 255, 255, 0.95);
        }
      </style>
    </head>
    <body>
      <main class="app-shell journey-active" id="test-shell">
        <header class="app-bar">
          <button class="brand" type="button">Lastrico</button>
          <div class="app-bar-actions">
            <button type="button" class="icon-button">T</button>
            <button type="button" class="icon-button">↗</button>
            <button type="button" class="report-button">Segnala</button>
          </div>
        </header>
        <div class="app-workspace">
          <aside class="control-panel">
            <div class="panel-content">
              <input type="text" class="compact-field" value="Via Roma" style="font-size: 16px;" />
            </div>
          </aside>
          <section class="map-stage">
            <div class="navigation-hud">
              <div class="navigation-instruction">
                <span class="maneuver-glyph">↑</span>
                <div class="maneuver-copy">
                  <b>Tra 150m</b>
                  <p>Svolta a destra su Via Garibaldi</p>
                </div>
              </div>
              <div class="navigation-tripbar">
                <div class="trip-metric"><strong>12</strong><span>min</span></div>
                <div class="trip-metric wide"><strong>2.4</strong><span>km</span></div>
                <div class="trip-metric eta"><strong>18:45</strong><span>arrivo</span></div>
                <div class="navigation-controls">
                  <button type="button" class="stop-nav" style="min-height: 44px;">Termina</button>
                  <button type="button" style="min-height: 44px;">Dettagli</button>
                  <button type="button" style="min-height: 44px;">Voce</button>
                </div>
              </div>
              <div class="driving-safety">Fermati in sicurezza prima di usare lo schermo</div>
            </div>
          </section>
        </div>
      </main>

      <script>
        const appBar = document.querySelector(".app-bar");
        const navInstruction = document.querySelector(".navigation-instruction");
        const stopBtn = document.querySelector(".stop-nav");

        const appBarDisplay = window.getComputedStyle(appBar).display;
        const instructionRect = navInstruction.getBoundingClientRect();
        const stopBtnRect = stopBtn.getBoundingClientRect();

        const results = {
          appBarHiddenInJourney: appBarDisplay === "none",
          instructionTop: instructionRect.top,
          instructionHeight: instructionRect.height,
          stopBtnHeight: stopBtnRect.height,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
        document.body.setAttribute("data-test-results", JSON.stringify(results));
      </script>
    </body>
    </html>
  `;

  for (const vp of viewports) {
    const tmpHtmlPath = `/tmp/phase48-responsive-test-${vp.width}.html`;
    fs.writeFileSync(tmpHtmlPath, htmlContent);

    const evaluatedDom = execFileSync(CHROME_PATH, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=/tmp/chrome-phase48-${vp.width}`,
      `--window-size=${vp.width},${vp.height}`,
      "--dump-dom",
      `file://${tmpHtmlPath}`,
    ], { encoding: "utf8" });

    const match = evaluatedDom.match(/data-test-results="([^"]+)"/);
    assert.ok(match, `Chrome must produce evaluation results for ${vp.name}`);
    const results = JSON.parse(match[1].replace(/&quot;/g, '"'));

    assert.equal(results.appBarHiddenInJourney, true, `App bar must auto-hide during journey-active on ${vp.name}`);
    assert.ok(results.instructionHeight >= 44, `Navigation instruction height (${results.instructionHeight}px) must be >= 44px on ${vp.name}`);
    assert.ok(results.stopBtnHeight >= 44, `Stop navigation button height (${results.stopBtnHeight}px) must be >= 44px on ${vp.name}`);
    assert.equal(results.hasHorizontalOverflow, false, `Viewport ${vp.name} (${vp.width}x${vp.height}) must have zero horizontal overflow`);

    fs.unlinkSync(tmpHtmlPath);
  }
});
