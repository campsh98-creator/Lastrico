import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import {
  PILOT_AREAS,
  coordinateInArea,
  getPilotJourneys,
} from "../lib/pilot-areas.ts";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

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

test("Phase 4.6: Pilot journeys catalog integrity across Milan and Roccella", () => {
  const milanJourneys = getPilotJourneys("milan");
  const roccellaJourneys = getPilotJourneys("roccella");

  assert.equal(milanJourneys.length, 3, "Milan must define exactly 3 verified pilot journeys");
  assert.equal(roccellaJourneys.length, 3, "Roccella must define exactly 3 verified pilot journeys");

  // Validate Milan coordinates
  for (const j of milanJourneys) {
    assert.equal(j.areaId, "milan");
    assert.ok(coordinateInArea(j.start.coordinate, PILOT_AREAS.milan), `Milan journey ${j.id} start must be in Milan`);
    assert.ok(coordinateInArea(j.end.coordinate, PILOT_AREAS.milan), `Milan journey ${j.id} end must be in Milan`);
    assert.deepEqual(j.modes, ["car", "motorcycle", "bicycle"]);
    assert.ok(j.name.length > 0);
    assert.ok(j.description.length > 0);
  }

  // Validate Roccella coordinates
  for (const j of roccellaJourneys) {
    assert.equal(j.areaId, "roccella");
    assert.ok(coordinateInArea(j.start.coordinate, PILOT_AREAS.roccella), `Roccella journey ${j.id} start must be in Roccella`);
    assert.ok(coordinateInArea(j.end.coordinate, PILOT_AREAS.roccella), `Roccella journey ${j.id} end must be in Roccella`);
    assert.deepEqual(j.modes, ["car", "motorcycle", "bicycle"]);
    assert.ok(j.name.length > 0);
    assert.ok(j.description.length > 0);
  }
});

test("Phase 4.6: RouteComparisonPanel renders selection rationale and surface breakdown transparently", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  const fastRoute = {
    distance: 4.0,
    minutes: 12.0,
    paveMeters: 600,
    smoothSurfaceMeters: 3000,
    unknownSurfaceMeters: 400,
    surfaceTotalMeters: 4000,
  };

  const safeRoute = {
    distance: 4.4,
    minutes: 14.0,
    paveMeters: 100,
    smoothSurfaceMeters: 3800,
    unknownSurfaceMeters: 500,
    surfaceTotalMeters: 4400,
  };

  // Case 1: Safe route active with distinct alternative
  const elSafe = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: true,
    activeRoute: "safe",
    transportMode: "motorcycle",
    extraTimeBudgetMinutes: 5,
  });

  const htmlSafe = renderToStaticMarkup(elSafe);

  // Verification: Rationale explains pavé reduction and extra time within budget
  assert.match(htmlSafe, /data-testid="p43-selection-rationale"/);
  assert.match(htmlSafe, /Motivo selezione:/);
  assert.match(htmlSafe, /Alternativa Anti-pavé attiva/);
  assert.match(htmlSafe, /riduce il pavé confermato di 500 m \(-83%\)/);
  assert.match(htmlSafe, /\+2,0 min di percorrenza/);

  // Verification: Surface breakdown shows Rough, Smooth, and Unknown
  assert.match(htmlSafe, /Pavé: <b>100 m<\/b>/);
  assert.match(htmlSafe, /Liscio: <b>3,8 km<\/b>/);
  assert.match(htmlSafe, /Non censito: <b>500 m \(11%\)<\/b>/);

  // Case 2: Fast route active with distinct alternative
  const elFast = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: true,
    activeRoute: "fast",
    transportMode: "car",
    extraTimeBudgetMinutes: 5,
  });

  const htmlFast = renderToStaticMarkup(elFast);
  assert.match(htmlFast, /Percorso più rapido attivo: privilegia la velocità minima \(12,0 min\)/);

  // Case 3: No distinct alternative
  const elNoAlt = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute: fastRoute,
    hasDistinctAlternative: false,
    activeRoute: "fast",
    transportMode: "bicycle",
    extraTimeBudgetMinutes: 5,
  });

  const htmlNoAlt = renderToStaticMarkup(elNoAlt);
  assert.match(htmlNoAlt, /presenta già la minima esposizione a pavé noto/);
});

test("Phase 4.6: Insufficient OSM surface information is explicitly marked without claiming smooth or safe", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  // Route with > 50% unknown surface (e.g. typical in historic borgo of Roccella)
  const routeCritical = {
    distance: 2.0,
    minutes: 6.0,
    paveMeters: 50,
    smoothSurfaceMeters: 400,
    unknownSurfaceMeters: 1550, // 77.5% unknown!
    surfaceTotalMeters: 2000,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute: routeCritical,
    safeRoute: routeCritical,
    hasDistinctAlternative: false,
    activeRoute: "fast",
    transportMode: "car",
  });

  const html = renderToStaticMarkup(el);

  // Must show critical OSM badge
  assert.match(html, /p43-badge-critical/);
  assert.match(html, /⚠️ Copertura OSM critica \(78% non censito\)/);

  // Must render advisory notice explaining neutrality
  assert.match(html, /p43-uncertainty-alert/);
  assert.match(html, /Lastrico non assume che le strade non censite siano lisce né prive di pavé/);
  assert.match(html, /la stima di riduzione riflette esclusivamente i tratti verificati/);

  // Route with 30% unknown (moderate)
  const routeModerate = {
    distance: 2.0,
    minutes: 6.0,
    paveMeters: 50,
    smoothSurfaceMeters: 1350,
    unknownSurfaceMeters: 600, // 30% unknown
    surfaceTotalMeters: 2000,
  };

  const elMod = React.createElement(RouteComparisonPanel, {
    fastRoute: routeModerate,
    safeRoute: routeModerate,
    hasDistinctAlternative: false,
    activeRoute: "fast",
    transportMode: "motorcycle",
  });

  const htmlMod = renderToStaticMarkup(elMod);
  assert.match(htmlMod, /p43-badge-moderate/);
  assert.match(htmlMod, /ℹ️ Copertura OSM parziale \(30% non censito\)/);
});

test("Phase 4.6: Multi-modal route calculation and surface intelligence for pilot journeys", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");

  // Roccella Borgo to Marina: Castello Carafa -> Lungomare
  const roccellaStart = [16.4068, 38.3260];
  const roccellaEnd = [16.3959, 38.3182];
  const roccellaTestCoords = [roccellaStart, [16.401, 38.322], roccellaEnd];

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("overpass")) return new Response("Unavailable", { status: 503 });
    return Response.json({
      trip: {
        status: 0,
        summary: { length: 1.45, time: 240 },
        legs: [{
          shape: encodePolyline(roccellaTestCoords),
          maneuvers: [
            { type: 1, instruction: "Parti da Castello Carafa", begin_shape_index: 0 },
            { type: 4, instruction: "Arrivo al Lungomare Sisinio Zito", begin_shape_index: 2 },
          ],
        }],
      },
    });
  });

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const params = new URLSearchParams({
      area: "roccella",
      start: roccellaStart.join(","),
      end: roccellaEnd.join(","),
      mode,
      avoid: "strong",
      maxExtraMinutes: "5",
    });

    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    assert.equal(response.status, 200);
    const data = await response.json();

    assert.equal(data.area, "roccella");
    assert.equal(data.transportMode, mode);
    assert.ok(data.fast);
    assert.ok(typeof data.fast.paveMeters === "number");
    assert.ok(typeof data.fast.unknownSurfaceMeters === "number");
    assert.ok(data.fast.coordinates.length > 0);
  }
});

test("Phase 4.6: App page contains pilot journey quick-select controls", async () => {
  const pageSource = await readFile(new URL("app/page.tsx", root), "utf8");

  // Verify presence of pilot journey controls and testids
  assert.match(pageSource, /role="region" aria-label="Itinerari di collaudo"/);
  assert.match(pageSource, /data-testid=\{`pilot-journey-\$\{journey\.id\}`\}/);
  assert.match(pageSource, /handleSelectPilotJourney/);
  assert.match(pageSource, /getPilotJourneys\(areaId\)/);
});

test("Phase 4.6: Real Chrome mobile layout, touch targets (>= 44px), and zero horizontal overflow", { skip: !chromeAvailable }, async () => {
  const compMod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = compMod;

  const fastRoute = {
    distance: 4.0,
    minutes: 12.0,
    paveMeters: 600,
    smoothSurfaceMeters: 2000,
    unknownSurfaceMeters: 1400,
    surfaceTotalMeters: 4000,
  };

  const safeRoute = {
    distance: 4.4,
    minutes: 14.0,
    paveMeters: 100,
    smoothSurfaceMeters: 2800,
    unknownSurfaceMeters: 1500,
    surfaceTotalMeters: 4400,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute,
    safeRoute,
    hasDistinctAlternative: true,
    activeRoute: "safe",
    transportMode: "motorcycle",
    extraTimeBudgetMinutes: 5,
  });

  const panelHtml = renderToStaticMarkup(el);
  const p43Css = await readFile(new URL("components/phase43/phase43.css", root), "utf8");

  const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Phase 4.6 Route Quality Mobile Test</title>
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
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    ${p43Css}
  </style>
</head>
<body>
  <div class="wrapper">
    <!-- Quick-select chips -->
    <div class="pilot-journeys-container" role="region" aria-label="Itinerari di collaudo">
      <span class="pilot-journeys-label">Itinerari di collaudo (Milano):</span>
      <div class="pilot-journeys-chips">
        <button type="button" class="pilot-journey-chip" data-testid="chip-1">Brera → Santa Sofia</button>
        <button type="button" class="pilot-journey-chip" data-testid="chip-2">Castello → Porta Venezia</button>
        <button type="button" class="pilot-journey-chip" data-testid="chip-3">Cadorna → Darsena</button>
      </div>
    </div>

    ${panelHtml}
  </div>

  <script>
    const chips = document.querySelectorAll(".pilot-journey-chip");
    const safeCard = document.querySelector(".p43-card-safe");
    const fastCard = document.querySelector(".p43-card-fast");
    const rationale = document.querySelector(".p43-selection-rationale");

    const getH = (el) => el ? el.getBoundingClientRect().height : 0;
    const getW = (el) => el ? el.getBoundingClientRect().width : 0;

    const results = {
      windowWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      chipHeights: Array.from(chips).map(getH),
      safeCardHeight: getH(safeCard),
      fastCardHeight: getH(fastCard),
      hasRationale: Boolean(rationale),
    };
    document.body.setAttribute("data-test-results", JSON.stringify(results));
  </script>
</body>
</html>`;

  const tmpPath = "/tmp/phase46-chrome-viewport.html";
  fs.writeFileSync(tmpPath, fullHtml);

  const rawOut = execFileSync(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=/tmp/chrome-phase46-profile",
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

  // Check 2: All pilot journey chips touch target >= 44px
  for (const h of results.chipHeights) {
    assert.ok(h >= 44, `Pilot journey chip height (${h}px) must be >= 44px`);
  }

  // Check 3: Route cards touch targets >= 44px
  assert.ok(results.safeCardHeight >= 44, `Safe card height (${results.safeCardHeight}px) must be >= 44px`);
  assert.ok(results.fastCardHeight >= 44, `Fast card height (${results.fastCardHeight}px) must be >= 44px`);

  // Check 4: Rationale is rendered
  assert.ok(results.hasRationale, "Selection rationale must be rendered");
});
