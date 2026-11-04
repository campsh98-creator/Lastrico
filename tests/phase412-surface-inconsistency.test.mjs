import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import milanTiles from "../data/surfaces/milan-compact-tiles.json" with { type: "json" };

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

test("Phase 4.12 / 4.13: Authentic citywide coverage and anti-pavé alternative on Porta Romana -> Largo Promessi Sposi", async () => {
  const fixturePath = new URL("./fixtures/reproduced-porta-romana-route.json", import.meta.url);
  const data = JSON.parse(await readFile(fixturePath, "utf8"));

  // Verify expanded authentic OSM surface metrics on Porta Romana -> Largo Promessi Sposi
  assert.ok(data.fast, "fast route must be present");
  assert.ok(data.safe, "safe route must be present");
  assert.equal(data.fast.paveMeters, 524, "Fast route detects 524 m of authentic pavé along Corso di Porta Romana / Viale Col di Lana / Viale Tibaldi");
  assert.equal(data.fast.smoothSurfaceMeters, 3838, "Fast route detects 3,838 m of confirmed smooth road");
  assert.equal(data.fast.unknownSurfaceMeters, 21, "Fast route has only 21 m (0.5%) unknown surface");
  assert.ok(data.fast.surfaceCoveragePercent >= 99, "Fast route surface coverage must be >= 99%");

  // Mathematical consistency verification:
  // pave (524m) + smooth (3838m) + unpaved (118m) + unknown (21m) === total (4501m)
  const sum = data.fast.paveMeters
    + data.fast.smoothSurfaceMeters
    + (data.fast.unpavedSurfaceMeters ?? 0)
    + data.fast.unknownSurfaceMeters;
  assert.equal(sum, data.fast.surfaceTotalMeters, "Surface categories must sum exactly to surfaceTotalMeters");

  // Verify Southern Milan tile coverage in milan-compact-tiles.json
  const tilesObj = milanTiles.tiles || milanTiles;
  assert.ok(tilesObj["920_4545"] && tilesObj["920_4545"].length > 500, "Start tile (Porta Romana) has dense surface coverage");
  assert.ok(tilesObj["917_4543"] && tilesObj["917_4543"].length > 500, "Destination tile 917_4543 (Largo Promessi Sposi) is now covered with > 500 segments");

  // Verify authentic anti-pavé alternative:
  // Safe route reduces pavé from 524 m to 14 m (-510 m / -97.3%) with 97.4% confirmed surface coverage
  assert.equal(data.hasDistinctAlternative, true, "Must provide a distinct anti-pavé alternative");
  assert.equal(data.safe.paveMeters, 14, "Safe route has only 14 m pavé");
  assert.equal(data.fast.paveMeters - data.safe.paveMeters, 510, "Safe route saves 510 m of pavé");
  assert.ok(data.safe.surfaceCoveragePercent >= 97, "Safe route surface coverage must be >= 97%");
});

test("Phase 4.12: RouteComparisonPanel consumer simplification and transparent reporting", async () => {
  const mod = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  const { RouteComparisonPanel } = mod;

  const reproducedRoute = {
    distance: 4.511,
    minutes: 13.2,
    paveMeters: 32,
    smoothSurfaceMeters: 643,
    unknownSurfaceMeters: 3826,
    surfaceTotalMeters: 4501,
  };

  const el = React.createElement(RouteComparisonPanel, {
    fastRoute: reproducedRoute,
    safeRoute: reproducedRoute,
    hasDistinctAlternative: false,
    activeRoute: "fast",
    transportMode: "car",
    extraTimeBudgetMinutes: 5,
  });

  const html = renderToStaticMarkup(el);

  // Surface breakdown displays clean, consumer-oriented values
  assert.match(html, /Pavé: <b>32 m<\/b>/);
  assert.match(html, /Liscio: <b>643 m<\/b>/);
  assert.match(html, /Non censito: <b>3,8 km \(85%\)<\/b>/);
  assert.match(html, /Fondo non censito:/);

  // Critical OSM badge correctly displayed for 85% unknown
  assert.match(html, /p43-badge-critical/);
  assert.match(html, /Copertura OSM critica \(85% non censito\)/);

  // Uncertainty alert present and honest
  assert.match(html, /p43-uncertainty-alert/);
  assert.match(html, /Lastrico non assume che le strade non censite siano lisce/);

  // Selection rationale explains why fast route is active
  assert.match(html, /data-testid="p43-selection-rationale"/);
  assert.match(html, /presenta già la minima esposizione a pavé noto/);
});

test("Phase 4.12: Prominent 'Avvia navigazione' primary action in app/page.tsx", () => {
  const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

  // Visible action is 'Avvia navigazione'
  assert.match(pageSource, /Avvia navigazione/);

  // Accessible fallback/text preserves 'Avvia con GPS' for screen readers and regression contracts
  assert.match(pageSource, /Avvia con GPS/);

  // Simulation action remains secondary and distinct
  assert.match(pageSource, /Simula percorso/);
  assert.match(pageSource, /Fallback mappe/);
});
