import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server.js";
import ts from "typescript";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";
import bundledRoads from "../data/surfaces/milan-central.json" with { type: "json" };

const componentFile = new URL("../components/SurfaceBreakdown.tsx", import.meta.url);
const { outputText } = ts.transpileModule(await readFile(componentFile, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  fileName: componentFile.pathname,
});
const executable = outputText.replace('from "react/jsx-runtime"', `from "${new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href}"`);
const { SurfaceBreakdown, surfaceBreakdownModel } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
const render = (route, props = {}) => renderToStaticMarkup(createElement(SurfaceBreakdown, {
  route, isLiveResult: true, activeRoute: "safe", transportMode: "bicycle", ...props,
}));
const metric = (html, name) => html.split(`data-testid="metric-${name}"`)[1]?.split("</div>")[0] ?? "";
const sample = { distance: 2, surfaceTotalMeters: 1000, paveMeters: 123, smoothSurfaceMeters: 456, unpavedSurfaceMeters: 111, unknownSurfaceMeters: 310, surfaceSource: "osm" };

test("surface panel uses scorer length and includes unpaved without inventing unknown exposure", () => {
  const model = surfaceBreakdownModel(sample);
  assert.equal(model.total, 1000);
  assert.equal(model.roughPercent, 12.3);
  assert.equal(model.smoothPercent, 45.6);
  assert.equal(model.unpavedPercent, 11.1);
  assert.equal(model.unknownPercent, 31);
  const html = render(sample);
  assert.match(metric(html, "rough"), /123 m.*12,3%/);
  assert.match(metric(html, "unpaved"), /111 m.*11,1%/);
  assert.match(metric(html, "unknown"), /310 m.*31%/);
});

test("zero-length routes do not render 100 percent unknown", () => {
  const html = render({ distance: 0, surfaceTotalMeters: 0, paveMeters: 0, cyclewayMeters: 0 });
  assert.match(metric(html, "unknown"), /0 m.*0%/);
  assert.doesNotMatch(html, /100%/);
  assert.doesNotMatch(html, /metric-unpaved/);
});

test("missing cycling evidence differs from a measured zero", () => {
  assert.match(metric(render(sample), "cycleway"), /Non disponibile/);
  assert.doesNotMatch(metric(render(sample), "cycleway"), /0%|0 m/);
  assert.match(metric(render({ ...sample, cyclewayMeters: 0 }), "cycleway"), /0 m rilevati/);
});

test("demo values remain simulated even if a stale source or live-state flag disagrees", () => {
  for (const [route, props] of [[sample, { isLiveResult: false }], [{ ...sample, surfaceSource: "demo" }, {}]]) {
    const html = render(route, props);
    assert.match(html, /Fondo stradale · Demo/);
    assert.match(html, /Dati simulati per la demo/);
    assert.match(html, /Liscio simulato/);
    assert.match(html, /Pavé simulato/);
    assert.doesNotMatch(html, /Liscio noto|Pavé noto/);
  }
});

test("real route handler metrics render consistently through the shared React panel", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const coordinates = [0, 1, 2, 3, 4].map((i) => [9.29 + i * 0.001, 45.53]);
  const surfaces = ["asphalt", "sett", "compacted", undefined];
  const elements = surfaces.map((surface, i) => ({
    id: 900090001 + i,
    tags: { highway: "residential", ...(surface ? { surface } : {}), ...(i === 0 ? { cycleway: "lane" } : {}) },
    geometry: coordinates.slice(i, i + 2).map(([lon, lat]) => ({ lon, lat })),
  }));
  let now = Date.now() + 100_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url) => {
    now += 2000;
    if (String(url).includes("overpass")) return Response.json({ elements });
    assert.match(String(url), /valhalla/);
    return Response.json({ trip: { status: 0, summary: { length: 2, time: 120 }, legs: [{
      shape: encodePolyline(coordinates),
      maneuvers: [{ type: 1, instruction: "Parti", begin_shape_index: 0 }, { type: 4, instruction: "Arrivo", begin_shape_index: 4 }],
    }] } });
  });
  const params = new URLSearchParams({ start: coordinates[0].join(","), end: coordinates.at(-1).join(","), mode: "bicycle", avoid: "strong", maxExtraMinutes: "0" });
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  for (const [activeRoute, route] of [["fast", payload.fast], ["safe", payload.safe]]) {
    assert.equal(route.surfaceSource, "osm");
    assert.ok(route.surfaceTotalMeters > 0);
    assert.notEqual(route.surfaceTotalMeters, route.distance * 1000, "provider distance intentionally differs from scoring geometry");
    assert.ok(route.paveMeters > 0 && route.smoothSurfaceMeters > 0 && route.unpavedSurfaceMeters > 0 && route.unknownSurfaceMeters > 0 && route.cyclewayMeters > 0);
    const model = surfaceBreakdownModel(route);
    assert.equal(model.roughPercent, route.pavePercent);
    assert.equal(model.unknownMeters, route.unknownSurfaceMeters);
    assert.equal(model.unpavedMeters, route.unpavedSurfaceMeters);
    const html = render(route, { activeRoute });
    assert.match(html, /Fondo stradale · OSM/);
    assert.match(html, activeRoute === "fast" ? /Più rapido/ : /Anti-pavé/);
    for (const name of ["smooth", "rough", "unknown", "unpaved", "cycleway"]) assert.ok(metric(html, name));
    assert.doesNotMatch(html, /simulat|Non disponibile/);
  }
});

test("archived genuine OSM segment reaches planner and navigation UI without a live surface fetch", async (t) => {
  // Via Santa Sofia, from the archived official OSM API response. Only routing is mocked.
  const segment = bundledRoads.find((road) => road.osmWayId === 442754378
    && road.coordinates[0][0] === 9.1881135);
  assert.ok(segment, "retain this real-source regression location when refreshing the pilot");
  const { GET } = await loadApi("app/api/routes/route.ts");
  let now = Date.now() + 200_000;
  t.mock.method(Date, "now", () => now);
  let surfaceCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    now += 2000;
    if (String(url).includes("overpass")) { surfaceCalls++; return new Response("Unavailable", { status: 503 }); }
    assert.match(String(url), /valhalla/);
    return Response.json({ trip: { status: 0, summary: { length: segment.lengthMeters / 1000, time: 20 }, legs: [{
      shape: encodePolyline(segment.coordinates),
      maneuvers: [{ type: 1, begin_shape_index: 0, instruction: "Parti" }, { type: 4, begin_shape_index: 1, instruction: "Arrivo" }],
    }] } });
  });
  for (const navigation of ["0", "1"]) {
    const params = new URLSearchParams({ start: segment.coordinates[0].join(","), end: segment.coordinates[1].join(","), mode: "bicycle", navigation });
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    assert.equal(response.status, 200);
    const { fast } = await response.json();
    assert.equal(fast.surfaceTotalMeters, 33);
    assert.equal(fast.smoothSurfaceMeters, 33);
    assert.equal(fast.cyclewayMeters, 33);
    assert.equal(fast.unknownSurfaceMeters, 0);
    assert.equal(fast.surfaceCoveragePercent, 100);
    const html = render(fast);
    assert.match(metric(html, "smooth"), /33 m.*100%/);
    assert.match(metric(html, "cycleway"), /33 m.*100%/);
    assert.match(metric(html, "unknown"), /0 m.*0%/);
  }
  assert.equal(surfaceCalls, 1, "navigation uses only the local surface snapshot");
});
