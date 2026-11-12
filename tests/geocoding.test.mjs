import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderBusyError,
  ProviderHttpError,
  classifyProviderFailure,
  createGeocodeFetcher,
  createProviderBreaker,
  retryAfterMilliseconds,
  validMilanGeocodeResult,
} from "../lib/geocoding.ts";

const url = new URL("https://nominatim.test/search?q=Milano");
const drain = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

// Phase 4.35: until Phase 4.34 these two tests required every call to wait for the previous one to
// settle, through one promise chained across requests. On Workers a cancelled request never settles
// its link, so that property is what froze address search on the pilot (12 November 2026). The
// replacements below keep what the old tests protected (cancellation returns promptly, a search
// never starts after its deadline, starts stay one interval apart) without that dependency.
test("a cancelled request whose fetch never settles does not block later searches (pilot regression)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    // The first request is the one Workers cancelled: its fetch neither answers nor rejects, even
    // when its signal aborts, because the runtime dropped that request's continuations.
    if (calls === 1) return new Promise(() => {});
    return Response.json([{ ok: calls }]);
  });
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 1050, timeoutMs: 3500 });
  const cancelled = new AbortController();
  void fetcher(url, cancelled.signal).catch(() => undefined);
  await drain();
  cancelled.abort();
  const next = fetcher(url, new AbortController().signal);
  await drain();
  t.mock.timers.tick(1050);
  await drain();
  assert.equal(calls, 2, "the next search starts one interval later instead of waiting for the dead one");
  assert.deepEqual(await next, [{ ok: 2 }]);
  t.mock.timers.tick(1050);
  assert.deepEqual(await fetcher(url, new AbortController().signal), [{ ok: 3 }]);
});

test("a caller cancelled while waiting for its slot returns promptly and gives the slot back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const starts = [];
  t.mock.method(globalThis, "fetch", async () => { starts.push(Date.now()); return Response.json([]); });
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 1050, timeoutMs: 3500 });
  await fetcher(url, new AbortController().signal);
  const abort = new AbortController();
  const queued = fetcher(url, abort.signal);
  const rejected = assert.rejects(queued, { name: "AbortError" });
  abort.abort();
  await rejected;
  const successor = fetcher(url, new AbortController().signal);
  await drain();
  t.mock.timers.tick(1050);
  await successor;
  assert.deepEqual(starts, [10000, 11050], "the freed slot is reused, not skipped");
});

test("a search whose slot would come after its deadline is refused at once and never starts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return Response.json([]); });
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 1050, timeoutMs: 3000 });
  const pending = [0, 1, 2].map(() => fetcher(url, new AbortController().signal));
  // Slots at +0, +1050 and +2100 ms fit a 3 s deadline; +3150 ms would start after it.
  await assert.rejects(fetcher(url, new AbortController().signal), (error) => error instanceof ProviderBusyError);
  t.mock.timers.tick(1050);
  await drain();
  t.mock.timers.tick(1050);
  await Promise.all(pending);
  assert.equal(calls, 3);
});

test("an upstream HTTP error keeps its status and Retry-After for the breaker", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
  const fetcher = createGeocodeFetcher({ minimumIntervalMs: 0 });
  await assert.rejects(fetcher(url, new AbortController().signal), (error) => error instanceof ProviderHttpError
    && error.status === 429 && error.retryAfterMs === 30000);
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

test("the provider breaker opens on 429 for Retry-After, on two timeouts, and closes on success", () => {
  const breaker = createProviderBreaker({ baseCooldownMs: 20000, maxCooldownMs: 300000 });
  breaker.failure("http", { status: 429, retryAfterMs: 60000, now: 0 });
  assert.equal(breaker.isOpen(59999), true);
  assert.equal(breaker.isOpen(60000), false);
  breaker.success();
  breaker.failure("timeout", { now: 100000 });
  assert.equal(breaker.isOpen(100001), false, "one timeout is not an outage");
  breaker.failure("timeout", { now: 100000 });
  assert.equal(breaker.isOpen(119999), true);
  assert.equal(breaker.retryAfterMs(110000), 10000);
  breaker.failure("busy", { now: 200000 });
  assert.equal(breaker.isOpen(200001), false, "a local busy refusal says nothing about the provider");
  breaker.failure("http", { status: 503, retryAfterMs: 999999999, now: 300000 });
  assert.equal(breaker.isOpen(300000 + 300000), false, "Retry-After is bounded");
});

test("a caller's own cancellation is not a provider failure", () => {
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(classifyProviderFailure(new DOMException("x", "AbortError"), aborted.signal), null);
  assert.deepEqual(classifyProviderFailure(new DOMException("x", "TimeoutError"), aborted.signal), { kind: "timeout" });
  assert.equal(classifyProviderFailure(new TypeError("network"), new AbortController().signal).kind, "network");
  assert.equal(retryAfterMilliseconds("120"), 120000);
  assert.equal(retryAfterMilliseconds(new Date(Date.now() + 5000).toUTCString()) > 0, true);
  assert.equal(retryAfterMilliseconds(null), null);
});
