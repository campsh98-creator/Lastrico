import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

const { GET } = await loadApi("app/api/routes/route.ts");
const start = [9.1886, 45.4721];
const end = [9.1887, 45.4607];
const request = (mode = "car") => new NextRequest(`http://localhost/api/routes?${new URLSearchParams({
  start: start.join(","), end: end.join(","), mode, avoid: "strong",
})}`);
const validTrip = {
  status: 0, summary: { length: 1, time: 60 },
  legs: [{ shape: encodePolyline([start, end]), maneuvers: [] }],
};
const coordinatePattern = /9\.18\d*|45\.4\d+|overpass|valhalla1|project-osrm/;

function captureLogs(t) {
  const lines = [];
  for (const method of ["error", "warn"]) {
    t.mock.method(console, method, (line) => { lines.push(String(line)); });
  }
  return lines;
}

test("an internal failure logs its cause without location data and keeps the public 503", async (t) => {
  const lines = captureLogs(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ trip: validTrip, alternates: [] }));
  t.mock.method(spatialRoadStore, "getScopedIntelligence", () => {
    throw new TypeError(`cannot read tile near ${start.join(",")} from https://example.test/?start=${start.join(",")}`);
  });
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Il routing gratuito è temporaneamente indisponibile. Riprova tra poco.",
    mode: "car",
    transportMode: "car",
  });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, "routes_failed");
  assert.equal(entry.errorName, "TypeError");
  assert.equal(entry.mode, "car");
  assert.equal(entry.area, "milan");
  assert.equal(entry.calculationMode, "planner");
  assert.doesNotMatch(lines[0], coordinatePattern);
});

test("provider failures log status or error class, never request details", async (t) => {
  const lines = captureLogs(t);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("valhalla")) return new Response("busy", { status: 429 });
    throw new TypeError(`fetch failed for ${url}`);
  });
  const response = await GET(request());
  assert.equal(response.status, 503);
  const entries = lines.map((line) => JSON.parse(line));
  assert.deepEqual(entries[0], { event: "provider_failed", provider: "valhalla", mode: "car", status: 429 });
  assert.deepEqual(entries[1], { event: "provider_failed", provider: "osrm", mode: "car", errorName: "TypeError" });
  assert.equal(entries[2].event, "routes_failed");
  for (const line of lines) assert.doesNotMatch(line, coordinatePattern);
});
