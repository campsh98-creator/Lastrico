import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fetchEngineRoutes, normalizeOsrmResponse, normalizeValhallaResponse } from "../lib/routing-providers.ts";

const coordinates = [[9.18, 45.46], [9.181, 45.461]];
function encode(points) {
  let previous = [0, 0];
  return points.map(([lon, lat]) => [lat, lon].map((value, index) => {
    const next = Math.round(value * 1e6);
    const delta = next - previous[index];
    previous[index] = next;
    let number = delta < 0 ? -delta * 2 - 1 : delta * 2;
    let encoded = "";
    while (number >= 32) { encoded += String.fromCharCode((number % 32) + 95); number = Math.floor(number / 32); }
    return encoded + String.fromCharCode(number + 63);
  }).join("")).join("");
}
function trip() {
  return { status: 0, summary: { length: 0.14, time: 60 }, legs: [{ shape: encode(coordinates), maneuvers: [
    { type: 1, instruction: "Parti", begin_shape_index: 0, end_shape_index: 1, length: 0.14 },
    { type: 4, instruction: "Sei arrivato", begin_shape_index: 1, end_shape_index: 1, length: 0 },
  ] }] };
}
function osrmRoute() {
  return { distance: 140, duration: 60, geometry: { coordinates }, legs: [{ steps: [
    { distance: 140, duration: 60, name: "Via Test", maneuver: { type: "depart", location: coordinates[0] } },
    { distance: 0, duration: 0, maneuver: { type: "arrive", location: coordinates[1] } },
  ] }] };
}
const json = (value) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
let fakeNow = Date.now();
function skipInterval(t) {
  fakeNow += 100_000;
  t.mock.method(Date, "now", () => fakeNow);
}

test("normalizes provider units, coordinates, maneuvers and bicycle walking instructions", () => {
  const source = trip();
  source.legs[0].maneuvers[0].travel_mode = "pedestrian";
  const [route] = normalizeValhallaResponse({ trip: source }, "bicycle");
  assert.equal(route.distance, 140);
  assert.equal(route.duration, 60);
  assert.deepEqual(route.coordinates, coordinates);
  assert.equal(route.profile, "bicycle");
  assert.equal(route.instructions[0].text, "Parti (bici a mano)");
  assert.equal(route.instructions[1].direction, "arrive");
  assert.deepEqual(route.instructions[1].location, coordinates[1]);
  const [fallback] = normalizeOsrmResponse({ code: "Ok", routes: [osrmRoute()] });
  assert.equal(fallback.profile, "driving");
  assert.equal(fallback.instructions[0].text, "Parti su Via Test");
});

test("rejects invalid Valhalla status, metrics, geometry and instructions without losing valid alternatives", () => {
  const mutations = [
    (value) => { value.status = 400; },
    (value) => { value.summary = {}; },
    (value) => { value.summary.time = NaN; },
    (value) => { value.summary.length = -1; },
    (value) => { value.summary.length = 0; },
    (value) => { value.summary.time = 0; },
    (value) => { value.summary.length = Number.MAX_VALUE; },
    (value) => { value.legs[0].shape += "_"; },
    (value) => { value.legs[0].shape = "~~~~~~~~~~~~?"; },
    (value) => { value.legs[0].shape = encode([[181, 45], [181.1, 45]]); },
    (value) => { value.legs[0].maneuvers[0].begin_shape_index = 100; },
    (value) => { value.legs[0].maneuvers[0].length = Infinity; },
    (value) => { value.legs[0].maneuvers[0].street_names = [null]; },
  ];
  for (const mutate of mutations) {
    const invalid = trip(); mutate(invalid);
    assert.deepEqual(normalizeValhallaResponse({ trip: invalid }, "car"), []);
    assert.equal(normalizeValhallaResponse({ trip: invalid, alternates: [null, { trip: trip() }] }, "car").length, 1);
  }
  assert.deepEqual(normalizeValhallaResponse(null, "car"), []);
});

test("rejects invalid OSRM payloads and individually filters malformed alternatives", () => {
  const mutations = [
    (value) => { value.distance = -1; },
    (value) => { value.distance = 0; },
    (value) => { value.duration = 0; },
    (value) => { value.duration = Infinity; },
    (value) => { value.geometry.coordinates = []; },
    (value) => { value.geometry.coordinates = [[9, 45], [NaN, 45]]; },
    (value) => { value.legs[0].steps[0].maneuver.location = [200, 45]; },
    (value) => { value.legs[0].steps[0].distance = "140"; },
  ];
  for (const mutate of mutations) {
    const invalid = osrmRoute(); mutate(invalid);
    assert.deepEqual(normalizeOsrmResponse({ code: "Ok", routes: [invalid] }), []);
    assert.equal(normalizeOsrmResponse({ code: "Ok", routes: [invalid, osrmRoute()] }).length, 1);
  }
  assert.deepEqual(normalizeOsrmResponse({ code: "NoRoute", routes: [osrmRoute()] }), []);
  assert.deepEqual(normalizeOsrmResponse(null), []);
});

test("requests each real profile and falls back to OSRM only for cars", async (t) => {
  skipInterval(t);
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    fakeNow += 100_000;
    const calls = [];
    const mock = t.mock.method(globalThis, "fetch", async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).includes("valhalla") ? new Response("unavailable", { status: 503 }) : json({ code: "Ok", routes: [osrmRoute()] });
    });
    const routes = await fetchEngineRoutes(coordinates, mode);
    assert.equal(JSON.parse(calls[0].init.body).costing, mode === "car" ? "auto" : mode);
    assert.equal(calls.length, mode === "car" ? 2 : 1);
    assert.equal(routes.length, mode === "car" ? 1 : 0);
    mock.mock.restore();
  }
});

test("invalid JSON and malformed Valhalla responses use the explicit car fallback", async (t) => {
  skipInterval(t);
  for (const response of [() => new Response("invalid json"), () => json({ trip: { ...trip(), summary: {} } })]) {
    fakeNow += 100_000;
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? response() : json({ code: "Ok", routes: [osrmRoute()] }));
    assert.equal((await fetchEngineRoutes(coordinates, "car"))[0].provider, "osrm-public-fallback");
    assert.equal(calls, 2);
    mock.mock.restore();
  }
});

test("an aborted queued request returns promptly without allowing another request to overtake", async (t) => {
  skipInterval(t);
  let release;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise((resolve) => { release = () => resolve(json({ trip: trip() })); }); });
  const first = fetchEngineRoutes(coordinates, "bicycle");
  await nextTurn();
  const cancellation = new AbortController();
  let settled = false;
  const second = fetchEngineRoutes(coordinates, "bicycle", false, Date.now() + 18_000, cancellation.signal).then((routes) => { settled = true; return routes; });
  cancellation.abort();
  await nextTurn();
  const thirdCancellation = new AbortController();
  const third = fetchEngineRoutes(coordinates, "bicycle", false, Date.now() + 18_000, thirdCancellation.signal);
  await nextTurn();
  const callsWhileBlocked = calls;
  const settledWhileBlocked = settled;
  thirdCancellation.abort();
  release();
  await first;
  assert.deepEqual(await second, []);
  assert.deepEqual(await third, []);
  assert.equal(settledWhileBlocked, true);
  assert.equal(callsWhileBlocked, 1);
});

test("queued requests honor the deadline even while a previous provider remains pending", { timeout: 2500 }, async (t) => {
  skipInterval(t);
  let release;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise((resolve) => { release = () => resolve(json({ trip: trip() })); }); });
  const first = fetchEngineRoutes(coordinates, "bicycle");
  await nextTurn();
  try {
    assert.deepEqual(await fetchEngineRoutes(coordinates, "bicycle", false, Date.now() + 500), []);
    assert.equal(calls, 1);
  } finally {
    release();
    await first;
  }
});

test("provider calls start at least one interval apart and in request order", async (t) => {
  const starts = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    starts.push({ at: performance.now(), lon: JSON.parse(init.body).locations[0].lon });
    return json({ trip: trip() });
  });
  const origins = [9.1, 9.2, 9.3];
  const routes = await Promise.all(origins.map((lon) =>
    fetchEngineRoutes([[lon, 45.46], coordinates[1]], "bicycle")));
  assert.ok(routes.every((result) => result.length === 1));
  assert.deepEqual(starts.map((start) => start.lon), origins);
  for (let index = 1; index < starts.length; index += 1) {
    // Timers may fire marginally early relative to the wall clock used for slots.
    assert.ok(starts[index].at - starts[index - 1].at >= 1_040, `gap ${index}: ${starts[index].at - starts[index - 1].at}`);
  }
});

// A cancelled Worker request might never run its cleanup, so later requests must not depend on it.
test("a provider call that never settles does not block later requests", { timeout: 5000 }, async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1 ? new Promise(() => {}) : json({ trip: trip() });
  });
  void fetchEngineRoutes(coordinates, "bicycle");
  await nextTurn();
  const routes = await fetchEngineRoutes(coordinates, "bicycle");
  assert.equal(routes.length, 1);
  assert.equal(calls, 2);
});

test("cancelled and expired requests make no network calls", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await fetchEngineRoutes(coordinates, "car", false, Date.now() + 18_000, controller.signal), []);
  assert.deepEqual(await fetchEngineRoutes(coordinates, "car", false, Date.now() - 1), []);
  assert.equal(mock.mock.callCount(), 0);
});


test("network aborts preserve car-only fallback and expose no fabricated route", async (t) => {
  skipInterval(t);
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    fakeNow += 100_000;
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      throw new DOMException("Provider timed out", "TimeoutError");
    });
    assert.deepEqual(await fetchEngineRoutes(coordinates, mode), []);
    assert.equal(calls, mode === "car" ? 2 : 1);
    mock.mock.restore();
  }
});


test("joins continuous Valhalla legs at their shared point and rejects gaps", () => {
  const source = trip();
  const thirdPoint = [9.182, 45.462];
  source.summary = { length: 0.28, time: 120 };
  source.legs.push({ shape: encode([coordinates[1], thirdPoint]), maneuvers: [{ type: 4, begin_shape_index: 1 }] });
  const [route] = normalizeValhallaResponse({ trip: source }, "car");
  assert.deepEqual(route.coordinates, [...coordinates, thirdPoint]);
  assert.deepEqual(route.instructions.at(-1).location, thirdPoint);
  source.legs[1].shape = encode([[9.2, 45.5], thirdPoint]);
  assert.deepEqual(normalizeValhallaResponse({ trip: source }, "car"), []);
});

test("permits genuinely stationary zero-metric geometry", () => {
  const source = trip();
  source.summary = { time: 0, length: 0 };
  source.legs[0].shape = encode([coordinates[0], coordinates[0]]);
  source.legs[0].maneuvers.forEach((maneuver) => { maneuver.length = 0; });
  assert.equal(normalizeValhallaResponse({ trip: source }, "car").length, 1);
  const fallback = osrmRoute();
  fallback.distance = 0; fallback.duration = 0;
  fallback.geometry.coordinates = [coordinates[0], coordinates[0]];
  fallback.legs[0].steps.forEach((step) => { step.distance = 0; step.duration = 0; step.maneuver.location = coordinates[0]; });
  assert.equal(normalizeOsrmResponse({ code: "Ok", routes: [fallback] }).length, 1);
});
