import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeAvailable = fs.existsSync(CHROME_PATH);

const root = new URL("../", import.meta.url);

async function loadComponent(relativePath) {
  const file = new URL(relativePath, root);
  let source = await readFile(file, "utf8");
  source = source.replace(/from "([^"]+)"/g, (original, specifier) => {
    if (specifier === "react") return `from "${new URL("node_modules/react/index.js", root).href}"`;
    if (specifier === "react/jsx-runtime") return `from "${new URL("node_modules/react/jsx-runtime.js", root).href}"`;
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root);
      return `from "${target.href}.ts"`;
    }
    if (specifier.startsWith(".")) {
      const target = new URL(specifier, file);
      return `from "${target.href}.ts"`;
    }
    return original;
  });

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file.pathname,
  });

  const resolvedCode = outputText
    .replace(/from "react\/jsx-runtime"/g, `from "${new URL("node_modules/react/jsx-runtime.js", root).href}"`)
    .replace(/from "react"/g, `from "${new URL("node_modules/react/index.js", root).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(resolvedCode).toString("base64")}`);
}

function createMockLocalStorage() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

test("Phase 4.5: Storage lifecycle - save, retrieve, single delete, clear all, and capacity cap", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const {
    saveLocalFeedback,
    getLocalFeedbackList,
    deleteLocalFeedback,
    clearLocalFeedback,
  } = mod;

  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  try {
    assert.deepEqual(getLocalFeedbackList(), []);

    const item1 = {
      id: "fb-alpha",
      timestamp: 1730100000000,
      category: "surface",
      kind: "unmapped_pave",
      transportMode: "motorcycle",
      coordinate: [9.19138, 45.46421],
      areaId: "milan",
      predictedSurfaceCategory: "smooth",
      routeSummary: {
        from: "Duomo",
        to: "Brera",
        activeRoute: "safe",
        distanceKm: 2.1,
        minutes: 7.5,
      },
      note: "Pavé non segnalato su via Mengoni",
    };

    const item2 = {
      id: "fb-beta",
      timestamp: 1730100010000,
      category: "navigation",
      kind: "incorrect_maneuver",
      transportMode: "car",
      coordinate: [16.40812, 38.32145],
      areaId: "roccella",
      predictedSurfaceCategory: "cobblestone",
      routeSummary: {
        from: "Castello Carafa",
        to: "Lungomare",
        activeRoute: "fast",
        distanceKm: 1.8,
        minutes: 5.0,
      },
      note: "Svolta a sinistra vietata per cantiere temporaneo",
    };

    saveLocalFeedback(item1);
    saveLocalFeedback(item2);

    let list = getLocalFeedbackList();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, "fb-beta", "Newest item must be prepended");
    assert.equal(list[1].id, "fb-alpha");

    // Single item deletion
    deleteLocalFeedback("fb-beta");
    list = getLocalFeedbackList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "fb-alpha", "Only fb-alpha must remain");

    // Clear all
    clearLocalFeedback();
    list = getLocalFeedbackList();
    assert.deepEqual(list, []);

    // Capacity cap at 100 items
    for (let i = 1; i <= 105; i++) {
      saveLocalFeedback({
        id: `fb-bulk-${i}`,
        timestamp: 1730100000000 + i * 1000,
        category: "surface",
        kind: "hazardous_surface",
        transportMode: "bicycle",
        note: `Anomalia ${i}`,
      });
    }

    list = getLocalFeedbackList();
    assert.equal(list.length, 100, "Storage must strictly cap at 100 entries");
    assert.equal(list[0].id, "fb-bulk-105");
    assert.equal(list[99].id, "fb-bulk-6");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Phase 4.5: JSON export produces schema-compliant structure with full context", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const {
    saveLocalFeedback,
    clearLocalFeedback,
    exportLocalFeedbackJson,
  } = mod;

  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  try {
    clearLocalFeedback();

    const item = {
      id: "fb-json-test",
      timestamp: 1730120000000,
      category: "surface",
      kind: "false_pave_smooth",
      transportMode: "bicycle",
      coordinate: [9.18592, 45.46894],
      areaId: "milan",
      predictedSurfaceCategory: "sett",
      routeSummary: {
        from: "Castello Sforzesco",
        to: "Missori",
        activeRoute: "safe",
        distanceKm: 3.2,
        minutes: 11.0,
      },
      note: "Asfalto recente perfetto, non è più pavé",
    };

    saveLocalFeedback(item);

    const jsonStr = exportLocalFeedbackJson();
    assert.ok(typeof jsonStr === "string");
    const parsed = JSON.parse(jsonStr);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);

    const exportedItem = parsed[0];
    assert.equal(exportedItem.id, "fb-json-test");
    assert.equal(exportedItem.timestamp, 1730120000000);
    assert.equal(exportedItem.areaId, "milan");
    assert.equal(exportedItem.predictedSurfaceCategory, "sett");
    assert.equal(exportedItem.transportMode, "bicycle");
    assert.deepEqual(exportedItem.coordinate, [9.18592, 45.46894]);
    assert.equal(exportedItem.routeSummary.activeRoute, "safe");
    assert.equal(exportedItem.routeSummary.distanceKm, 3.2);
    assert.equal(exportedItem.note, "Asfalto recente perfetto, non è più pavé");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Phase 4.5: CSV export formatting, header contract, and formula injection sanitization", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const {
    saveLocalFeedback,
    clearLocalFeedback,
    exportLocalFeedbackCsv,
  } = mod;

  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  try {
    clearLocalFeedback();

    // Item with malicious spreadsheet formula payloads in note and locations
    const maliciousItem = {
      id: "fb-csv-attack",
      timestamp: 1730130000000,
      category: "surface",
      kind: "hazardous_surface",
      transportMode: "motorcycle",
      coordinate: [9.19000, 45.46000],
      areaId: "milan",
      predictedSurfaceCategory: "cobblestone",
      routeSummary: {
        from: "=cmd|' /C calc'!A0", // Formula attempt in departure
        to: "+123456",             // Plus prefix formula attempt
        activeRoute: "safe",
      },
      note: "@SUM(1,2) - Pavé pericoloso con rotaia; nota con virgolette \"urgente\" e virgole, attenzione!",
    };

    const benignItemWithoutGps = {
      id: "fb-csv-nogps",
      timestamp: 1730131000000,
      category: "navigation",
      kind: "road_closure",
      transportMode: "car",
      coordinate: undefined,
      areaId: "roccella",
      predictedSurfaceCategory: "smooth",
      note: "Via Marina chiusa al traffico",
    };

    saveLocalFeedback(maliciousItem);
    saveLocalFeedback(benignItemWithoutGps);

    const csvOutput = exportLocalFeedbackCsv();
    const lines = csvOutput.split("\n");

    // Header validation
    const expectedHeaders = [
      "id",
      "timestamp_iso",
      "area",
      "transport_mode",
      "category",
      "kind",
      "predicted_surface",
      "latitude",
      "longitude",
      "departure",
      "destination",
      "active_route",
      "note",
      // Phase 4.34: the rough section a surface note refers to, appended so earlier columns keep their place.
      "segment_street",
      "segment_surface",
      "segment_start_latitude",
      "segment_start_longitude",
      "segment_end_latitude",
      "segment_end_longitude",
      "segment_confirmed_m",
      "segment_probable_m",
      "segment_warning_shown",
    ];
    assert.equal(lines[0], expectedHeaders.join(","));

    // Verify row counts (1 header + 2 data rows)
    assert.equal(lines.length >= 3, true);

    // Verify formula neutralization:
    // Any value starting with =, +, -, @ must be prefixed with a single quote (')
    // The note contains @SUM and double quotes and commas -> must be properly quoted
    assert.ok(csvOutput.includes("''=cmd|' /C calc'!A0") || csvOutput.includes("''=cmd") || csvOutput.includes("'+123456") || csvOutput.includes("'@SUM"));
    assert.ok(!csvOutput.match(/\n[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,=[a-zA-Z]/), "Raw = formula in departure forbidden");
    assert.ok(!csvOutput.match(/\n[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\+[0-9]/), "Raw + formula in destination forbidden");

    // Verify GPS omission formatting in benignItemWithoutGps row
    const noGpsLine = lines.find((l) => l.startsWith("fb-csv-nogps"));
    assert.ok(noGpsLine, "Must contain no-gps entry");
    const cells = noGpsLine.split(",");
    // latitude is index 7, longitude is index 8
    assert.equal(cells[7], "", "Latitude must be empty when coordinate is omitted");
    assert.equal(cells[8], "", "Longitude must be empty when coordinate is omitted");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Phase 4.5: LocalFieldFeedback renders UI tabs, context card, optional GPS toggle, and history list", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const {
    LocalFieldFeedback,
    saveLocalFeedback,
    clearLocalFeedback,
  } = mod;

  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  try {
    clearLocalFeedback();

    saveLocalFeedback({
      id: "fb-hist-1",
      timestamp: 1730100000000,
      category: "surface",
      kind: "unmapped_pave",
      transportMode: "motorcycle",
      coordinate: [9.19138, 45.46421],
      areaId: "milan",
      predictedSurfaceCategory: "smooth",
      note: "Lastre sconnesse",
    });

    // 1. Initial form rendering with context
    const elForm = React.createElement(LocalFieldFeedback, {
      isOpen: true,
      onClose: () => {},
      coordinate: [9.19138, 45.46421],
      transportMode: "motorcycle",
      areaId: "milan",
      activeRoute: "safe",
      predictedSurfaceCategory: "asfalto",
      routeSummary: {
        from: "Duomo",
        to: "Brera",
        distanceKm: 2.1,
        minutes: 7.5,
      },
    });

    const formHtml = renderToStaticMarkup(elForm);

    // Verify Tab navigation
    assert.match(formHtml, /role="tablist"/);
    assert.match(formHtml, /Nuova segnalazione/);
    assert.match(formHtml, /Storico \(1\)/);

    // Verify context card
    assert.match(formHtml, /p43-context-card/);
    assert.match(formHtml, /Milano/);
    assert.match(formHtml, /Moto/);
    assert.match(formHtml, /Percorso: Anti-pavé/);
    assert.match(formHtml, /Fondo stimato: asfalto/);

    // Verify optional location toggle
    assert.match(formHtml, /Allega posizione GPS/);
    assert.match(formHtml, /Punto: 45.46421, 9.19138/);
    assert.match(formHtml, /data-testid="toggle-location-checkbox"/);

    // Verify privacy notice
    assert.match(formHtml, /Privacy totale/);
    assert.match(formHtml, /questa segnalazione rimane esclusivamente sul tuo dispositivo/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Phase 4.5: Real Chrome mobile layout, touch targets (>= 44px), and zero horizontal overflow", { skip: !chromeAvailable }, async () => {
  const feedbackMod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const { LocalFieldFeedback, saveLocalFeedback, clearLocalFeedback } = feedbackMod;

  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  let formHtml = "";

  try {
    clearLocalFeedback();
    saveLocalFeedback({
      id: "fb-item-mobile",
      timestamp: Date.now(),
      category: "surface",
      kind: "unmapped_pave",
      transportMode: "motorcycle",
      coordinate: [9.19138, 45.46421],
      areaId: "milan",
      predictedSurfaceCategory: "smooth",
      note: "Test anomalia fondo pavé",
    });

    const elForm = React.createElement(LocalFieldFeedback, {
      isOpen: true,
      onClose: () => {},
      coordinate: [9.19138, 45.46421],
      transportMode: "motorcycle",
      areaId: "milan",
      activeRoute: "safe",
      predictedSurfaceCategory: "asfalto",
    });
    formHtml = renderToStaticMarkup(elForm);
  } finally {
    globalThis.window = originalWindow;
  }

  const p43Css = await readFile(new URL("components/phase43/phase43.css", root), "utf8");

  const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Phase 4.5 Mobile Layout Test</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100%;
      background: #f4f1ea;
    }
    .wrapper {
      width: 100%;
      max-width: 390px;
      margin: 0 auto;
      padding: 12px;
      position: relative;
    }
    ${p43Css}
  </style>
</head>
<body>
  <div class="wrapper">
    ${formHtml}
  </div>

  <script>
    const modalDialog = document.querySelector(".p43-modal-dialog");
    const modalCloseBtn = document.querySelector(".p43-modal-close-btn");
    const topTabs = document.querySelectorAll(".p43-top-view-tabs .p43-tab-btn");
    const catTabs = document.querySelectorAll(".p43-category-tabs .p43-tab-btn");
    const optionItems = document.querySelectorAll(".p43-option-item");
    const locationToggle = document.querySelector(".p43-location-toggle-label");
    const textarea = document.querySelector(".p43-field-block textarea");
    const primaryBtn = document.querySelector(".p43-primary-btn");
    const secondaryBtn = document.querySelector(".p43-secondary-btn");

    const getH = (el) => el ? el.getBoundingClientRect().height : 0;
    const getW = (el) => el ? el.getBoundingClientRect().width : 0;

    const results = {
      windowWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modalWidth: getW(modalDialog),
      modalCloseBtnHeight: getH(modalCloseBtn),
      modalCloseBtnWidth: getW(modalCloseBtn),
      topTabHeights: Array.from(topTabs).map(getH),
      catTabHeights: Array.from(catTabs).map(getH),
      optionItemHeights: Array.from(optionItems).map(getH),
      locationToggleHeight: getH(locationToggle),
      textareaFontSize: textarea ? window.getComputedStyle(textarea).fontSize : null,
      primaryBtnHeight: getH(primaryBtn),
      secondaryBtnHeight: getH(secondaryBtn),
    };
    document.body.setAttribute("data-test-results", JSON.stringify(results));
  </script>
</body>
</html>`;

  const tmpPath = "/tmp/phase45-chrome-viewport.html";
  fs.writeFileSync(tmpPath, fullHtml);

  const rawOut = execFileSync(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=/tmp/chrome-phase45-profile",
    "--window-size=390,844",
    "--dump-dom",
    `file://${tmpPath}`,
  ], { encoding: "utf8" });

  const match = rawOut.match(/data-test-results="([^"]+)"/);
  assert.ok(match, "Chrome must evaluate script and produce data-test-results attribute");

  const results = JSON.parse(match[1].replace(/&quot;/g, "\""));

  // Check 1: Zero horizontal overflow on iPhone 390px viewport
  assert.ok(
    results.scrollWidth <= results.windowWidth,
    `Scroll width (${results.scrollWidth}px) must not exceed window width (${results.windowWidth}px)`
  );

  // Check 2: Modal close button touch target >= 44x44px
  assert.ok(results.modalCloseBtnHeight >= 44, `Modal close button height (${results.modalCloseBtnHeight}px) must be >= 44px`);
  assert.ok(results.modalCloseBtnWidth >= 44, `Modal close button width (${results.modalCloseBtnWidth}px) must be >= 44px`);

  // Check 3: Top view switch tabs >= 44px
  for (const h of results.topTabHeights) {
    assert.ok(h >= 44, `Top tab button height (${h}px) must be >= 44px`);
  }

  // Check 4: Category tabs >= 44px
  for (const h of results.catTabHeights) {
    assert.ok(h >= 44, `Category tab button height (${h}px) must be >= 44px`);
  }

  // Check 5: Option selection items >= 44px
  for (const h of results.optionItemHeights) {
    assert.ok(h >= 44, `Option item height (${h}px) must be >= 44px`);
  }

  // Check 6: Location toggle label touch area >= 44px
  assert.ok(results.locationToggleHeight >= 44, `Location toggle height (${results.locationToggleHeight}px) must be >= 44px`);

  // Check 7: Textarea font size >= 16px to prevent iOS Safari auto-zoom
  assert.equal(results.textareaFontSize, "16px", "Textarea font size must be 16px to prevent iOS auto-zoom");

  // Check 8: Action buttons >= 44px
  assert.ok(results.primaryBtnHeight >= 44, `Primary button height (${results.primaryBtnHeight}px) must be >= 44px`);
  assert.ok(results.secondaryBtnHeight >= 44, `Secondary button height (${results.secondaryBtnHeight}px) must be >= 44px`);
});
