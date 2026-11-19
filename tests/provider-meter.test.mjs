import assert from "node:assert/strict";
import test from "node:test";
import { fetchEngineRoutes, fetchValhallaCustomizedRoute, fetchValhallaRouteExcluding } from "../lib/routing-providers.ts";

const points = [[9.19, 45.464], [9.2, 45.47]];

test("the meter counts every real request, the OSRM fallback included, and stops at the limit", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  try {
    const meter = { requests: 0, limit: 3 };
    await fetchEngineRoutes(points, "car", true, Date.now() + 20_000, new AbortController().signal, meter);
    assert.equal(meter.requests, 2, "Valhalla plus the OSRM fallback");
    assert.equal(calls, 2);
    await fetchValhallaCustomizedRoute(points, "car", [{ shape: "abc", factor: 8 }], Date.now() + 20_000, new AbortController().signal, meter);
    assert.equal(meter.requests, 3);
    // limit reached: nothing else leaves the server
    const before = calls;
    await fetchEngineRoutes(points, "car", false, Date.now() + 20_000, new AbortController().signal, meter);
    await fetchValhallaRouteExcluding(points, "car", [[[9.19, 45.46], [9.2, 45.46], [9.2, 45.47]]], Date.now() + 20_000, new AbortController().signal, meter);
    assert.equal(calls, before);
    assert.equal(meter.requests, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
