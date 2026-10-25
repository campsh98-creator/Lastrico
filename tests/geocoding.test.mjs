import assert from "node:assert/strict";
import test from "node:test";
import { createGeocodeFetcher, validMilanGeocodeResult } from "../lib/geocoding.ts";

const url = new URL("https://nominatim.test/search?q=Milano");
const drain = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("cancelled queued searches return promptly without letting successors overtake", async (t) => {
  const first = deferred();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) await first.promise;
    return Response.json([]);
  });
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 0 });
  const active = fetcher(url, new AbortController().signal);
  await drain();
  const abort = new AbortController();
  const queued = fetcher(url, abort.signal);
  const rejected = assert.rejects(queued, { name: "AbortError" });
  abort.abort();
  await rejected;
  const successor = fetcher(url, new AbortController().signal);
  await drain();
  assert.equal(calls, 1);
  first.resolve();
  await Promise.all([active, successor]);
  assert.equal(calls, 2);
});

test("the total deadline includes queue waiting and never starts expired searches", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const first = deferred();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    await first.promise;
    return Response.json([]);
  });
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 0, timeoutMs: 8000 });
  const active = fetcher(url, new AbortController().signal);
  const activeRejected = assert.rejects(active, { name: "TimeoutError" });
  await drain();
  const queued = fetcher(url, new AbortController().signal);
  const queuedRejected = assert.rejects(queued, { name: "TimeoutError" });
  t.mock.timers.tick(8000);
  await Promise.all([activeRejected, queuedRejected]);
  first.resolve();
  await drain();
  assert.equal(calls, 1);
});

test("Nominatim starts remain separated even after a provider failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const starts = [];
  t.mock.method(globalThis, "fetch", async () => {
    starts.push(Date.now());
    return starts.length === 1 ? new Response(null, { status: 503 }) : Response.json([]);
  });
  const fetcher = createGeocodeFetcher();
  await assert.rejects(fetcher(url, new AbortController().signal));
  const second = fetcher(url, new AbortController().signal);
  await drain();
  t.mock.timers.tick(1049);
  await drain();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await second;
  assert.deepEqual(starts, [10000, 11050]);
});

test("cancel during the minimum-interval wait prevents the upstream call", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return Response.json([]); });
  const fetcher = createGeocodeFetcher();
  await fetcher(url, new AbortController().signal);
  const abort = new AbortController();
  const queued = fetcher(url, abort.signal);
  await drain();
  const rejected = assert.rejects(queued, { name: "AbortError" });
  abort.abort();
  await rejected;
  t.mock.timers.tick(1050);
  await drain();
  assert.equal(calls, 1);
});

test("upstream result validation rejects malformed coordinates and out-of-area rows", () => {
  const valid = { place_id: 1, display_name: "Via Milano", lat: "45.46", lon: "9.19", address: { city: "Milano" } };
  assert.equal(validMilanGeocodeResult(valid), true);
  for (const row of [null, {}, { ...valid, lat: "NaN" }, { ...valid, lon: Infinity }, { ...valid, lon: "12.49" },
    { ...valid, lat: null }, { ...valid, lat: [] }, { ...valid, address: { city: 3 } }, { ...valid, name: {} }]) {
    assert.equal(validMilanGeocodeResult(row), false);
  }
});
