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

// Polyfill window.localStorage for Node tests
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

test("Phase 4.3: RouteComparisonPanel renders accurate trade-off comparison & metrics", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  const fastRoute = {
    distance: 4.8,
    minutes: 14.0,
    paveMeters: 850,
    smoothSurfaceMeters: 3500,
    unknownSurfaceMeters: 450,
    surfaceTotalMeters: 4800,
  };

  const safeRoute = {
    distance: 5.2,
    minutes: 16.5,
    paveMeters: 120,
    smoothSurfaceMeters: 4600,
    unknownSurfaceMeters: 480,
    surfaceTotalMeters: 5200,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: true,
    activeRoute: "safe",
    transportMode: "motorcycle",
    extraTimeBudgetMinutes: 5,
  });

  const html = renderToStaticMarkup(el);

  // Verification 1: Header and mode title
  assert.match(html, /Confronto Percorsi · Moto/);
  assert.match(html, /Budget extra: max \+5 min/);

  // Verification 2: Trade-off sentence
  // Phase 4.21 replaced the two-metric banner ("Pavé evitato -730 m (-86%) | Tempo extra +2,5 min") with
  // one visible sentence from lib/route-tradeoff.ts (panel = one sentence + the two cards). These routes
  // carry no confirmed/probable split, so the 730 m (850 - 120) may only be called "pavé noto", never
  // "confermato". The percentage is no longer displayed (both absolute values are on the cards), so the
  // banner assertions are replaced by an exact match of the sentence plus the card's time cost.
  assert.match(html, /data-testid="p43-selection-rationale"><p class="p43-rationale-text">Evita 730 m di pavé noto, con 2,5 minuti in più\.<\/p>/);
  assert.doesNotMatch(html, /pavé confermato/);
  assert.match(html, /<em>\+(?:<!-- -->)?2,5(?:<!-- -->)? min<\/em>/);

  // Verification 3: Route cards & selection
  assert.match(html, /data-testid="p43-card-safe"/);
  assert.match(html, /data-testid="p43-card-fast"/);
  assert.match(html, /p43-selected/);
  assert.match(html, /aria-checked="true"/);

  // Verification 4: Transparency on unknown surface
  // Safe unknown: 480 / 5200 = 9%
  // Fast unknown: 450 / 4800 = 9%
  assert.match(html, /Fondo non censito:/);
  assert.match(html, /480 m \(9%\)/);
  assert.match(html, /450 m \(9%\)/);
});

test("Phase 4.3: RouteComparisonPanel handles 'no distinct alternative' state cleanly", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  const fastRoute = {
    distance: 3.5,
    minutes: 10.0,
    paveMeters: 400,
  };

  const safeRoute = {
    distance: 3.5,
    minutes: 10.0,
    paveMeters: 400,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: false,
    activeRoute: "fast",
    transportMode: "bicycle",
  });

  const html = renderToStaticMarkup(el);

  // Verification 1: Absence of trade-off banner
  assert.doesNotMatch(html, /class="p43-tradeoff-banner"/);

  // Verification 2: Clear empty state
  // Phase 4.21 replaced "Nessuna deviazione migliore rilevata" and its hidden explanation with one
  // visible sentence. The old claim that the fast route "presenta già la minima esposizione a pavé noto"
  // is not always true (an alternative can be rejected for time or for unmapped stretches), so the
  // sentence now states the server's criterion. No saving or time cost may appear without an alternative.
  assert.match(html, /data-testid="p43-selection-rationale"><p class="p43-rationale-text">Nessuna alternativa migliora il compromesso tra tempo, pavé noto e tratti senza dati\.<\/p>/);
  assert.doesNotMatch(html, /evita|in più/i);

  // Verification 3: Disabled safe card
  assert.match(html, /p43-card-disabled/);
  assert.match(html, /Anti-pavé non disponibile/);
  assert.match(html, /Nessun percorso alternativo valido/);
});

test("Phase 4.3: RouteComparisonPanel triggers uncertainty alert when unknown surface > 25%", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  const fastRoute = {
    distance: 4.0,
    minutes: 12.0,
    paveMeters: 500,
    unknownSurfaceMeters: 1400, // 35% of 4000m
    surfaceTotalMeters: 4000,
  };

  const safeRoute = {
    distance: 4.2,
    minutes: 13.0,
    paveMeters: 200,
    unknownSurfaceMeters: 1200, // 28.5% of 4200m
    surfaceTotalMeters: 4200,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: true,
    activeRoute: "safe",
    transportMode: "car",
  });

  const html = renderToStaticMarkup(el);

  // Verification: Advisory note is rendered
  assert.match(html, /p43-uncertainty-alert/);
  assert.match(html, /Oltre il 25% del percorso include tratti privi di etichetta superficie su OpenStreetMap/);
  assert.match(html, /Lastrico non assume che le strade non censite siano lisce/);
});

test("Phase 4.3: LocalFieldFeedback manages local storage and renders modal dialog", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const {
    LocalFieldFeedback,
    saveLocalFeedback,
    getLocalFeedbackList,
    clearLocalFeedback,
    exportLocalFeedbackJson,
  } = mod;

  // Set up isolated localStorage
  const mockStorage = createMockLocalStorage();
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: mockStorage };

  try {
    // 1. Initial state: empty
    assert.deepEqual(getLocalFeedbackList(), []);

    // 2. Save items
    const item1 = {
      id: "fb-1",
      timestamp: 1730100000000,
      category: "surface",
      kind: "unmapped_pave",
      transportMode: "motorcycle",
      coordinate: [9.19138, 45.46421],
      note: "Pavé ruvido non segnalato vicino a piazza Cordusio",
    };
    saveLocalFeedback(item1);

    const listAfter1 = getLocalFeedbackList();
    assert.equal(listAfter1.length, 1);
    assert.equal(listAfter1[0].id, "fb-1");
    assert.equal(listAfter1[0].kind, "unmapped_pave");

    const item2 = {
      id: "fb-2",
      timestamp: 1730100005000,
      category: "navigation",
      kind: "incorrect_maneuver",
      transportMode: "car",
      coordinate: [9.18592, 45.46894],
      note: "Svolta vietata per isola pedonale",
    };
    saveLocalFeedback(item2);

    // Newer item should be prepended
    const listAfter2 = getLocalFeedbackList();
    assert.equal(listAfter2.length, 2);
    assert.equal(listAfter2[0].id, "fb-2");
    assert.equal(listAfter2[1].id, "fb-1");

    // 3. Export JSON
    const exportedJson = exportLocalFeedbackJson();
    assert.ok(typeof exportedJson === "string");
    const parsedExport = JSON.parse(exportedJson);
    assert.equal(parsedExport.length, 2);
    assert.equal(parsedExport[0].id, "fb-2");

    // 4. Cap at 100 items FIFO
    for (let i = 3; i <= 120; i++) {
      saveLocalFeedback({
        id: `fb-${i}`,
        timestamp: Date.now() + i,
        category: "surface",
        kind: "hazardous_surface",
        transportMode: "bicycle",
        note: `Test item ${i}`,
      });
    }
    const listAfterOverflow = getLocalFeedbackList();
    assert.equal(listAfterOverflow.length, 100, "Must be capped at 100 items");
    assert.equal(listAfterOverflow[0].id, "fb-120");

    // 5. Clear storage
    clearLocalFeedback();
    assert.deepEqual(getLocalFeedbackList(), []);

    // 6. Component rendering in modal open state
    const el = React.createElement(LocalFieldFeedback, {
      isOpen: true,
      onClose: () => {},
      coordinate: [9.19138, 45.46421],
      transportMode: "motorcycle",
    });

    const html = renderToStaticMarkup(el);

    // Accessible modal attributes
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-labelledby="p43-feedback-title"/);
    assert.match(html, /id="p43-feedback-title"/);
    assert.match(html, /Segnala anomalia/);

    // Privacy notice
    assert.match(html, /Privacy totale/);
    assert.match(html, /questa segnalazione rimane esclusivamente sul tuo dispositivo/);
    assert.match(html, /Nessun dato viene inviato a server esterni né modifica la mappa pubblica/);

    // Options and coordinates
    assert.match(html, /Pavé non segnalato/);
    assert.match(html, /Punto: 45.46421, 9.19138/);
    assert.match(html, /Salva nel dispositivo/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Phase 4.3: LocalFieldFeedback renders nothing when isOpen is false", async () => {
  const mod = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const { LocalFieldFeedback } = mod;

  const el = React.createElement(LocalFieldFeedback, {
    isOpen: false,
    onClose: () => {},
    transportMode: "car",
  });

  const html = renderToStaticMarkup(el);
  assert.equal(html, "");
});

test("Phase 4.3: NavigationDiagnosticsCard visualizes session metrics and privacy assurance", async () => {
  const mod = await loadComponent("components/phase43/NavigationDiagnosticsCard.tsx");
  const { NavigationDiagnosticsCard } = mod;

  const diagnostics = {
    acceptedFixes: 128,
    rejectedFixes: {
      outside: 2,
      implausible: 1,
      stale: 3,
      invalid: 1,
      duplicate: 4,
    },
    offRouteEvents: 2,
    rerouteAttempts: 3,
    rerouteSuccesses: 3,
    signalLossCount: 1,
    wakeLockActive: true,
    foregroundResumes: 2,
  };

  let resetCount = 0;
  const onReset = () => {
    resetCount += 1;
  };
  const el = React.createElement(NavigationDiagnosticsCard, {
    diagnostics,
    gpsState: "live",
    journeyMode: "gps",
    isOnline: true,
    onResetDiagnostics: onReset,
  });

  onReset();
  assert.equal(resetCount, 1);

  const html = renderToStaticMarkup(el);

  // Total rejected sum: 2 + 1 + 3 + 1 + 4 = 11
  assert.match(html, /GPS LIVE AGGANCIATO/);
  assert.match(html, /p43-dot-live/);
  assert.match(html, /Fix validi/);
  assert.match(html, /128/);
  assert.match(html, /Fix scartati/);
  assert.match(html, /11/);
  assert.match(html, /Fuori percorso/);
  assert.match(html, /2/);
  assert.match(html, /Ricalcoli/);
  assert.match(html, /3\/3/);

  // Hardware and signals
  assert.match(html, /Perdite segnale:/);
  assert.match(html, /<b>1<\/b>/);
  assert.match(html, /Schermo attivo:/);
  assert.match(html, /Sì \(WakeLock\)/);
  assert.match(html, /Ripristini foreground:/);
  assert.match(html, /<b>2<\/b>/);

  // Rejections collapsible toggle
  assert.match(html, /Mostra dettaglio fix scartati/);

  // Privacy notice
  assert.match(html, /p43-privacy-badge/);
  // Reroutes send the live position to routing providers, so the card must not deny it.
  assert.match(html, /la posizione usata come partenza viene inviata ai servizi di routing/);
  assert.doesNotMatch(html, /Zero tracciamento|Nessuna coordinata GPS/);

  // Reset button
  assert.match(html, /Azzera contatori sessione/);
});

test("Phase 4.3: NavigationDiagnosticsCard maps various GPS states correctly", async () => {
  const mod = await loadComponent("components/phase43/NavigationDiagnosticsCard.tsx");
  const { NavigationDiagnosticsCard } = mod;

  const emptyDiagnostics = {
    acceptedFixes: 0,
    rejectedFixes: { outside: 0, implausible: 0, stale: 0, invalid: 0, duplicate: 0 },
    offRouteEvents: 0,
    rerouteAttempts: 0,
    rerouteSuccesses: 0,
    signalLossCount: 0,
    wakeLockActive: false,
    foregroundResumes: 0,
  };

  const testCases = [
    { gpsState: "recalculating", journeyMode: "gps", expected: "RICALCOLO IN CORSO", dot: "p43-dot-warn" },
    { gpsState: "requesting", journeyMode: "gps", expected: "RICERCA FIX GPS", dot: "p43-dot-warn" },
    { gpsState: "weak", journeyMode: "gps", expected: "SEGNALE DEBOLE", dot: "p43-dot-warn" },
    { gpsState: "outside", journeyMode: "gps", expected: "FUORI AREA BETA", dot: "p43-dot-warn" },
    { gpsState: "temporarily-unavailable", journeyMode: "gps", expected: "SEGNALE TEMPORANEAMENTE ASSENTE", dot: "p43-dot-warn" },
    { gpsState: "offroute", journeyMode: "gps", expected: "FUORI PERCORSO", dot: "p43-dot-warn" },
    { gpsState: "unavailable", journeyMode: "gps", expected: "GPS NON DISPONIBILE", dot: "p43-dot-warn" },
    { gpsState: "live", journeyMode: "gps", expected: "GPS LIVE AGGANCIATO", dot: "p43-dot-live" },
    { gpsState: "requesting", journeyMode: "simulation", expected: "SIMULAZIONE ATTIVA", dot: "p43-dot-live" },
  ];

  for (const { gpsState, journeyMode, expected, dot } of testCases) {
    const el = React.createElement(NavigationDiagnosticsCard, {
      diagnostics: emptyDiagnostics,
      gpsState,
      journeyMode,
      isOnline: false,
    });
    const html = renderToStaticMarkup(el);
    assert.match(html, new RegExp(expected), `GPS state '${gpsState}' in mode '${journeyMode}' should render label '${expected}'`);
    assert.match(html, new RegExp(dot), `GPS state '${gpsState}' in mode '${journeyMode}' should have class '${dot}'`);
  }
});

test("Phase 4.3: Real Chrome mobile layout, touch targets (>= 44px), 16px inputs, and zero overflow", async (t) => {
  if (!chromeAvailable) {
    t.skip("Google Chrome not found at /Applications/Google Chrome.app");
    return;
  }

  const modPanel = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const modFeedback = await loadComponent("components/phase43/LocalFieldFeedback.tsx");
  const modDiag = await loadComponent("components/phase43/NavigationDiagnosticsCard.tsx");

  const p43Css = await readFile(new URL("../components/phase43/phase43.css", import.meta.url), "utf8");

  const panelHtml = renderToStaticMarkup(
    React.createElement(modPanel.RouteComparisonPanel, {
      fastRoute: { distance: 5.2, minutes: 14.5, paveMeters: 900, unknownSurfaceMeters: 400, surfaceTotalMeters: 5200 },
      safeRoute: { distance: 5.6, minutes: 16.0, paveMeters: 150, unknownSurfaceMeters: 420, surfaceTotalMeters: 5600 },
      hasDistinctAlternative: true,
      activeRoute: "safe",
      transportMode: "motorcycle",
      extraTimeBudgetMinutes: 4,
    })
  );

  const feedbackHtml = renderToStaticMarkup(
    React.createElement(modFeedback.LocalFieldFeedback, {
      isOpen: true,
      onClose: () => {},
      coordinate: [9.19138, 45.46421],
      transportMode: "motorcycle",
    })
  );

  const diagHtml = renderToStaticMarkup(
    React.createElement(modDiag.NavigationDiagnosticsCard, {
      diagnostics: {
        acceptedFixes: 45,
        rejectedFixes: { outside: 1, implausible: 0, stale: 2, invalid: 0, duplicate: 1 },
        offRouteEvents: 1,
        rerouteAttempts: 2,
        rerouteSuccesses: 2,
        signalLossCount: 0,
        wakeLockActive: true,
        foregroundResumes: 1,
      },
      gpsState: "live",
      journeyMode: "gps",
      isOnline: true,
      onResetDiagnostics: () => {},
    })
  );

  const html = `<!DOCTYPE html>
<html lang="it">
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
      min-height: 100%;
      background: #f4f1ea;
    }
    .wrapper {
      width: 100%;
      max-width: 390px;
      margin: 0 auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    ${p43Css}
  </style>
</head>
<body>
  <div class="wrapper">
    ${panelHtml}
    ${diagHtml}
    ${feedbackHtml}
  </div>

  <script>
    const safeCard = document.querySelector(".p43-card-safe");
    const fastCard = document.querySelector(".p43-card-fast");
    const modalCloseBtn = document.querySelector(".p43-modal-close-btn");
    const tabBtns = document.querySelectorAll(".p43-tab-btn");
    const optionItems = document.querySelectorAll(".p43-option-item");
    const textarea = document.querySelector(".p43-field-block textarea");
    const primaryBtn = document.querySelector(".p43-primary-btn");
    const secondaryBtn = document.querySelector(".p43-secondary-btn");
    const toggleDetailsBtn = document.querySelector(".p43-toggle-details-btn");
    const resetDiagBtn = document.querySelector(".p43-reset-diag-btn");

    const getH = (el) => el ? el.getBoundingClientRect().height : 0;
    const getW = (el) => el ? el.getBoundingClientRect().width : 0;

    const results = {
      windowWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      safeCardHeight: getH(safeCard),
      fastCardHeight: getH(fastCard),
      modalCloseBtnHeight: getH(modalCloseBtn),
      modalCloseBtnWidth: getW(modalCloseBtn),
      tabBtnHeights: Array.from(tabBtns).map(getH),
      optionItemHeights: Array.from(optionItems).map(getH),
      textareaFontSize: textarea ? window.getComputedStyle(textarea).fontSize : null,
      primaryBtnHeight: getH(primaryBtn),
      secondaryBtnHeight: getH(secondaryBtn),
      toggleDetailsBtnHeight: getH(toggleDetailsBtn),
      resetDiagBtnHeight: getH(resetDiagBtn),
    };
    document.body.setAttribute("data-test-results", JSON.stringify(results));
  </script>
</body>
</html>`;

  const tmpPath = "/tmp/phase43-chrome-viewport.html";
  fs.writeFileSync(tmpPath, html);

  const rawOut = execFileSync(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=/tmp/chrome-phase43-profile",
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

  // Check 2: Route cards touch target >= 44px
  assert.ok(results.safeCardHeight >= 44, `Safe route card height (${results.safeCardHeight}px) must be >= 44px`);
  assert.ok(results.fastCardHeight >= 44, `Fast route card height (${results.fastCardHeight}px) must be >= 44px`);

  // Check 3: Modal close button touch target >= 44x44px
  assert.ok(results.modalCloseBtnHeight >= 44, `Modal close button height (${results.modalCloseBtnHeight}px) must be >= 44px`);
  assert.ok(results.modalCloseBtnWidth >= 44, `Modal close button width (${results.modalCloseBtnWidth}px) must be >= 44px`);

  // Check 4: Modal category tabs >= 44px
  for (const h of results.tabBtnHeights) {
    assert.ok(h >= 44, `Tab button height (${h}px) must be >= 44px`);
  }

  // Check 5: Option selection items >= 44px
  for (const h of results.optionItemHeights) {
    assert.ok(h >= 44, `Option item height (${h}px) must be >= 44px`);
  }

  // Check 6: Textarea font size >= 16px to prevent iOS Safari auto-zoom
  assert.equal(results.textareaFontSize, "16px", "Textarea font size must be 16px to prevent iOS auto-zoom");

  // Check 7: Primary and secondary action buttons >= 44px
  assert.ok(results.primaryBtnHeight >= 44, `Primary button height (${results.primaryBtnHeight}px) must be >= 44px`);
  assert.ok(results.secondaryBtnHeight >= 44, `Secondary button height (${results.secondaryBtnHeight}px) must be >= 44px`);

  // Check 8: Diagnostics toggle & reset buttons >= 44px
  assert.ok(results.toggleDetailsBtnHeight >= 44, `Toggle details button height (${results.toggleDetailsBtnHeight}px) must be >= 44px`);
  assert.ok(results.resetDiagBtnHeight >= 44, `Reset diagnostics button height (${results.resetDiagBtnHeight}px) must be >= 44px`);
});
