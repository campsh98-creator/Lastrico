/**
 * Phase 4.35: /api/geocode by purpose. Typing (`purpose=suggest`) never reaches Nominatim, whose
 * public policy forbids search-as-you-type; an explicit search does, once, with Photon as
 * fallback. Failing providers are skipped for a cool-down, so an outage answers at once, and an
 * error answer says it is retryable and why.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";

const request = (params, signal) => new NextRequest(`http://localhost/api/geocode?${new URLSearchParams({ area: "milan", ...params })}`, signal ? { signal } : undefined);
const hostOf = (input) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname;
const photonFeature = (name, coordinates = [9.1696, 45.4487], extra = {}) => ({
  type: "Feature",
  properties: { osm_id: Math.floor(Math.random() * 1e9), name, city: "Milano", locality: "Navigli", postcode: "20143", ...extra },
  geometry: { type: "Point", coordinates },
});
const nominatimRow = (id, road, extra = {}) => ({
  place_id: id, display_name: `${road}, Milano`, lat: "45.4487", lon: "9.1696", addresstype: "road",
  address: { road, city: "Milano", quarter: "Navigli", postcode: "20143" }, ...extra,
});

test("typing asks Photon only, never Nominatim", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    hosts.push(hostOf(input));
    return Response.json({ features: [photonFeature("Darsena")] });
  });
  const response = await GET(request({ q: "Darsena", purpose: "suggest" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].primary, "Darsena");
  assert.deepEqual(hosts, ["photon.komoot.io"]);
});

test("a failed typing search answers 503, retryable, never cached, and never falls back to Nominatim", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    hosts.push(hostOf(input));
    return new Response("busy", { status: 502 });
  });
  const response = await GET(request({ q: "Stazione Centrale", purpose: "suggest" }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.retryable, true);
  assert.equal(typeof body.reason, "string");
  assert.deepEqual(hosts, ["photon.komoot.io"]);
});

test("after two Photon failures typing is answered at once, without calling Photon, until the cool-down ends", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new DOMException("Photon timed out", "TimeoutError");
  });
  for (const q of ["Via Tortona", "Corso Lodi"]) assert.equal((await GET(request({ q, purpose: "suggest" }))).status, 503);
  const started = Date.now();
  const third = await GET(request({ q: "Viale Monza", purpose: "suggest" }));
  assert.equal(third.status, 503);
  assert.ok(Date.now() - started < 100, "answered at once");
  assert.equal(calls, 2, "Photon was not called during the cool-down");
  assert.equal((await third.json()).reason, "photon_cooling_down");
  assert.ok(Number(third.headers.get("retry-after")) > 0);
});

test("an explicit search asks Nominatim and does not also ask Photon when Nominatim answers", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    hosts.push(hostOf(input));
    return Response.json([nominatimRow(1, "Via Filippo Argelati")]);
  });
  const response = await GET(request({ q: "Via Filippo Argelati, Milano", purpose: "search" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].primary, "Via Filippo Argelati");
  assert.deepEqual(hosts, ["nominatim.openstreetmap.org"]);
});

test("a Nominatim 429 falls back to Photon, then Nominatim is skipped for its Retry-After", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const host = hostOf(input);
    hosts.push(host);
    if (host === "nominatim.openstreetmap.org") return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
    return Response.json({ features: [photonFeature("Via Savona", [9.155, 45.455])] });
  });
  const first = await GET(request({ q: "Via Savona", purpose: "search" }));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).results[0].primary, "Via Savona");
  hosts.length = 0;
  const second = await GET(request({ q: "Via Tortona", purpose: "search" }));
  assert.equal(second.status, 200);
  assert.deepEqual(hosts, ["photon.komoot.io"], "Nominatim is not asked again during its Retry-After");
});

test("an explicit search with every provider failing answers 503 retryable", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 503 }));
  const response = await GET(request({ q: "Piazzale Loreto", purpose: "search" }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.retryable, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("an empty answer is a short, private cache entry, not five public minutes", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  t.mock.method(globalThis, "fetch", async (input) => (hostOf(input) === "photon.komoot.io" ? Response.json({ features: [] }) : Response.json([])));
  for (const purpose of ["suggest", "search", undefined]) {
    const response = await GET(request(purpose ? { q: "Via Filippo Argel", purpose } : { q: "Via Filippo Argel" }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).results, []);
    assert.equal(response.headers.get("cache-control"), "private, max-age=60");
  }
});

test("a request cancelled by its client is not counted against the provider", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls += 1;
    if (calls <= 2) {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    return Response.json({ features: [photonFeature("Via Bergognone")] });
  });
  for (let index = 0; index < 2; index += 1) {
    const controller = new AbortController();
    const pending = GET(request({ q: `Via Ber${"g".repeat(index + 1)}`, purpose: "suggest" }, controller.signal));
    controller.abort();
    await pending;
  }
  const response = await GET(request({ q: "Via Bergognone", purpose: "suggest" }));
  assert.equal(response.status, 200, "two cancellations did not open the breaker");
  assert.equal((await response.json()).results[0].primary, "Via Bergognone");
});

test("after a cancelled search whose upstream never settles, the next explicit search still reaches Nominatim", async (t) => {
  const { GET } = await loadApi("app/api/geocode/route.ts", { fresh: true });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const host = hostOf(input);
    calls.push(host);
    // The first Nominatim call belongs to a request Workers cancelled: it never settles.
    if (host === "nominatim.openstreetmap.org" && calls.filter((item) => item === host).length === 1) return new Promise(() => {});
    if (host === "photon.komoot.io") return new Promise(() => {});
    return Response.json([nominatimRow(7, "Via Ripamonti")]);
  });
  const cancelled = new AbortController();
  void GET(request({ q: "Via Rip", purpose: "search" }, cancelled.signal));
  await new Promise((done) => setTimeout(done, 20));
  cancelled.abort();
  const started = Date.now();
  const response = await GET(request({ q: "Via Ripamonti", purpose: "search" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].primary, "Via Ripamonti");
  assert.ok(Date.now() - started < 2_000, `answered in ${Date.now() - started} ms, within one Nominatim interval`);
});
