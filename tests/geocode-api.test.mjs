import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
const { GET } = await loadApi("app/api/geocode/route.ts");
const request = (q) => new NextRequest(`http://localhost/api/geocode?${new URLSearchParams({ q })}`);
let now = Date.now();

test("geocoding rejects empty, short and overlong queries before dispatch", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network"); });
  for (const q of ["", "ab", "a".repeat(301)]) assert.equal((await GET(request(q))).status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});

test("geocoding keeps valid Milan results and filters invalid, outside-area and duplicate rows", async (t) => {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  const valid = { place_id: 1, display_name: "Piazza test", lat: "45.46", lon: "9.19", address: { city: "Milano", road: "Piazza test" } };
  t.mock.method(globalThis, "fetch", async () => Response.json([
    valid, valid, null, { ...valid, lon: "12.49" }, { ...valid, lat: "NaN" }, { ...valid, address: { city: "Roma" } },
  ]));
  const response = await GET(request("Piazza test"));
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].coordinate, [9.19, 45.46]);
  assert.equal(results[0].primary, "Piazza test");
});

test("malformed upstream geocoding response returns the documented service error", async (t) => {
  now += 100_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "bad response" }));
  const response = await GET(request("Piazza test"));
  assert.equal(response.status, 503);
  assert.equal(typeof (await response.json()).error, "string");
});
