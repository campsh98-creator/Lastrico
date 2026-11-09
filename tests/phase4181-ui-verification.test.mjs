import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import path from "node:path";
import { launchChrome } from "./e2e/chrome-session.mjs";

const projectRoot = new URL("../", import.meta.url).pathname;

// Phase 4.21: `--window-size` with `--dump-dom` did not give the named viewports (headless Chrome
// rendered 320x568 as 500x425 and 667x375 as 667x232), so each viewport is now emulated exactly
// through the DevTools protocol, as in the browser acceptance suite.
async function openAt(width, height) {
  const first = 9600 + Math.floor(Math.random() * 100);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await launchChrome({ port: 9600 + ((first - 9600 + attempt) % 100), width, height, mobile: width < 1000 });
    } catch (error) {
      if (!/already has a Chrome debugging session/.test(error.message)) throw error;
    }
  }
  throw new Error("No free Chrome debugging port between 9600 and 9699");
}

// Text-spill checks measure glyph widths. The interface uses the system font stack, which is
// Apple's on macOS and on the iPhone, so those measurements are representative only on macOS. A
// Linux CI runner substitutes a wider fallback font, which can push a label 2 px past its box.
// The other checks hold everywhere: map visibility, touch targets, font sizes and page overflow.
const FONT_METRICS_REPRESENTATIVE = process.platform === "darwin";

test("Phase 4.18.1 DOM Verification: Landscape map visibility, touch targets, and typography", async (t) => {
  const fallbackFontSpills = [];
  const assetsDir = path.join(projectRoot, "dist/client/assets");
  const assetFiles = fs.readdirSync(assetsDir);
  const cssFiles = assetFiles.filter((f) => f.endsWith(".css"));

  let bundledCss = "";
  for (const cssFile of cssFiles) {
    bundledCss += await readFile(path.join(assetsDir, cssFile), "utf8") + "\n";
  }
  const globalsCss = await readFile(path.join(projectRoot, "app/globals.css"), "utf8");
  const phase43Css = await readFile(path.join(projectRoot, "components/phase43/phase43.css"), "utf8");

  const buildHtmlDoc = (theme = "dark") => `<!DOCTYPE html>
<html lang="it" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <style>
    ${bundledCss}
    ${globalsCss}
    ${phase43Css}
  </style>
</head>
<body>
  <main class="app-shell sheet-expanded">
    <header class="app-bar">
      <button class="brand" type="button"><span class="brand-mark"><i /><i /><i /></span><span>lastrico</span></button>
      <div class="app-bar-actions">
        <button type="button" class="icon-button">◐</button>
        <button type="button" class="report-button">⚠ Segnala</button>
      </div>
    </header>
    <section class="map-stage" id="test-map-stage">
      <div class="navigation-hud">
        <!-- Phase 4.21: the real trip bar has three metrics; a single one hid labels that ran into their neighbour. -->
        <section class="navigation-tripbar">
          <div class="trip-metric"><strong>12</strong><small id="test-trip-small">min</small></div>
          <div class="trip-metric"><strong>2,8 km</strong><small>rimanenti</small></div>
          <div class="trip-metric"><strong>18:45</strong><small>arrivo stimato</small></div>
          <button type="button" class="stop-navigation" id="test-stop-btn">Termina</button>
        </section>
      </div>
    </section>
    <aside class="control-panel">
      <div class="panel-content">
        <section class="planner-panel">
          <div class="transport-selector" role="radiogroup">
            <button type="button" class="active" id="test-transport-btn">Auto</button>
            <button type="button">Moto</button>
            <button type="button">Bici</button>
          </div>
          <div class="segmented" role="group">
            <button type="button" id="test-segmented-btn">Forte</button>
          </div>
          <button type="button" class="primary-action" id="test-primary-btn">Confronta</button>
        </section>
        <section class="p43-comparison-panel">
          <!-- Phase 4.21: the trade-off banner became one visible sentence; this 147-character one is about the longest. -->
          <div class="p43-selection-rationale" role="status" data-testid="p43-selection-rationale"><p class="p43-rationale-text" id="test-rationale">L’alternativa evita 1,2 km di pavé confermato e 300 m probabili, con 12,5 minuti, 1,4 km, 830 m di fondo non verificato e 420 m di sterrato in più.</p></div>
          <div class="p43-route-cards">
            <button type="button" class="p43-route-card p43-card-safe p43-selected" id="test-route-card">
              <div class="p43-card-head">
                <span class="p43-card-indicator p43-indicator-safe"></span>
                <div class="p43-card-names" id="test-card-names">
                  <strong>Anti-pavé · Auto</strong>
                  <small id="test-card-small">3.8 km · solo 480 m di pavé verificato</small>
                </div>
                <div class="p43-card-time">
                  <span>14<small> min</small></span>
                  <em>+3 min</em>
                </div>
              </div>
              <div class="p43-surface-breakdown">
                <span class="p43-breakdown-item" id="test-breakdown-item">Asfalto: <b>3.1 km</b></span>
              </div>
            </button>
          </div>
          <button type="button" class="primary-action journey-button" id="test-journey-btn">Avvia con GPS</button>
        </section>
      </div>
    </aside>
  </main>
  <script>
    const mapStage = document.getElementById("test-map-stage");
    const transportBtn = document.getElementById("test-transport-btn");
    const segmentedBtn = document.getElementById("test-segmented-btn");
    const primaryBtn = document.getElementById("test-primary-btn");
    const journeyBtn = document.getElementById("test-journey-btn");
    const stopBtn = document.getElementById("test-stop-btn");
    const rationale = document.getElementById("test-rationale");
    const cardSmall = document.getElementById("test-card-small");
    const breakdownItem = document.getElementById("test-breakdown-item");
    const tripSmall = document.getElementById("test-trip-small");

    const compMap = window.getComputedStyle(mapStage);
    const rectMap = mapStage.getBoundingClientRect();

    const evaluation = {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      mapVisibility: compMap.visibility,
      mapDisplay: compMap.display,
      mapWidth: rectMap.width,
      mapHeight: rectMap.height,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
      transportBtnHeight: transportBtn.getBoundingClientRect().height,
      segmentedBtnHeight: segmentedBtn.getBoundingClientRect().height,
      primaryBtnHeight: primaryBtn.getBoundingClientRect().height,
      journeyBtnHeight: journeyBtn.getBoundingClientRect().height,
      stopBtnHeight: stopBtn.getBoundingClientRect().height,
      cardSmallFontSize: parseFloat(window.getComputedStyle(cardSmall).fontSize),
      breakdownItemFontSize: parseFloat(window.getComputedStyle(breakdownItem).fontSize),
      tripSmallFontSize: parseFloat(window.getComputedStyle(tripSmall).fontSize),
      rationaleFontSize: parseFloat(window.getComputedStyle(rationale).fontSize),
      // Painted text that leaves its own box overlaps whatever sits next to it.
      // Text an ancestor clips (an ellipsis) is not painted outside, so the clip is applied first.
      textSpills: [...document.querySelectorAll(".trip-metric, .p43-selection-rationale, .p43-card-names, .p43-card-time")].flatMap((box) => {
        const outer = box.getBoundingClientRect();
        const spills = [];
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          let right = -Infinity;
          let left = Infinity;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (!rect.width) continue;
            right = Math.max(right, rect.right);
            left = Math.min(left, rect.left);
          }
          for (let element = node.parentElement; element && element !== box.parentElement; element = element.parentElement) {
            if (window.getComputedStyle(element).overflowX !== "visible") {
              const clip = element.getBoundingClientRect();
              right = Math.min(right, clip.right);
              left = Math.max(left, clip.left);
            }
          }
          if (right > outer.right + 1 || left < outer.left - 1) {
            spills.push(box.className + " '" + node.textContent.trim().slice(0, 24) + "' " + Math.round(left) + "-" + Math.round(right) + " outside " + Math.round(outer.left) + "-" + Math.round(outer.right));
          }
        }
        return spills;
      }),
    };
    document.body.setAttribute("data-test-eval", JSON.stringify(evaluation));
  </script>
</body>
</html>`;

  const viewports = [
    { name: "iPhone SE Landscape", width: 667, height: 375 },
    { name: "iPhone 14 Landscape", width: 844, height: 390 },
    { name: "Small iPhone Portrait", width: 320, height: 568 },
    { name: "iPhone SE Portrait", width: 375, height: 667 },
    { name: "iPhone 14 Portrait", width: 390, height: 844 },
    { name: "Desktop", width: 1200, height: 800 },
  ];

  const workDir = fs.mkdtempSync(path.join(tmpdir(), "lastrico-phase4181-"));
  const tmpHtml = path.join(workDir, "eval.html");
  fs.writeFileSync(tmpHtml, buildHtmlDoc("dark"), "utf8");

  for (const vp of viewports) {
    const session = await openAt(vp.width, vp.height);
    let raw;
    try {
      await session.goto(`file://${tmpHtml}`);
      raw = await session.evaluate(`document.body.getAttribute("data-test-eval")`);
    } finally {
      await session.close();
    }
    assert.ok(raw, `Must extract evaluation data for ${vp.name}`);
    const res = JSON.parse(raw);
    assert.equal(res.windowWidth, vp.width, `${vp.name} must render at its real width`);
    assert.equal(res.windowHeight, vp.height, `${vp.name} must render at its real height`);

    // 1. Verify Map is visible and non-zero in landscape! (Fix P1)
    if (vp.height <= 500) {
      assert.equal(res.mapVisibility, "visible", `Map MUST be visible in ${vp.name}`);
      assert.ok(res.mapWidth > 200, `Map width must be > 200px in ${vp.name}, got ${res.mapWidth}`);
      assert.ok(res.mapHeight >= 150, `Map height must be >= 150px in ${vp.name}, got ${res.mapHeight}`);
    }

    // 2. Verify touch targets meet 44px
    assert.ok(res.transportBtnHeight >= 44, `Transport button height must be >= 44 in ${vp.name}, got ${res.transportBtnHeight}`);
    assert.ok(res.segmentedBtnHeight >= 44, `Segmented button height must be >= 44 in ${vp.name}, got ${res.segmentedBtnHeight}`);
    assert.ok(res.primaryBtnHeight >= 44, `Primary button height must be >= 44 in ${vp.name}, got ${res.primaryBtnHeight}`);
    assert.ok(res.journeyBtnHeight >= 44, `Journey button height must be >= 44 in ${vp.name}, got ${res.journeyBtnHeight}`);
    assert.ok(res.stopBtnHeight >= 44, `Stop button height must be >= 44 in ${vp.name}, got ${res.stopBtnHeight}`);

    // 3. Verify typography readability (>= 12px for secondary metadata)
    // Phase 4.21: the banner's metric label no longer renders; its sentence replaces it, held to the 12px floor.
    assert.ok(res.rationaleFontSize >= 12, `Rationale font size must be >= 12px in ${vp.name}, got ${res.rationaleFontSize}`);
    assert.ok(res.cardSmallFontSize >= 12, `Card small font size must be >= 12px in ${vp.name}, got ${res.cardSmallFontSize}`);
    assert.ok(res.breakdownItemFontSize >= 12, `Breakdown item font size must be >= 12px in ${vp.name}, got ${res.breakdownItemFontSize}`);
    assert.ok(res.tripSmallFontSize >= 12, `Trip small font size must be >= 12px in ${vp.name}, got ${res.tripSmallFontSize}`);

    // 4. Verify no horizontal overflow
    assert.equal(res.hasOverflow, false, `Must have zero horizontal overflow in ${vp.name}`);
    if (FONT_METRICS_REPRESENTATIVE) {
      assert.deepEqual(res.textSpills, [], `No label or sentence may run outside its box in ${vp.name}`);
    } else if (res.textSpills.length) {
      fallbackFontSpills.push(`${vp.name}: ${res.textSpills.join("; ")}`);
    }
  }
  if (fallbackFontSpills.length) {
    t.diagnostic(`text spill not asserted with this platform's fallback font (run on macOS): ${fallbackFontSpills.join(" | ")}`);
  }
  fs.rmSync(workDir, { recursive: true, force: true });
});
