import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { FLOW_TTL_MS, MemoryLedgerStorage, SqlLedgerStorage, TrafficHub, tileUrl } from "../worker/traffic-hub.ts";
import { DEFAULT_TRAFFIC_CAPS, reserve, rolled } from "../lib/traffic/quota.ts";

/**
 * The traffic ledger: hard quotas, the circuit breaker, caching and secrecy of the key. The provider is a stub: no
 * request leaves the machine. `SqlLedgerStorage` runs on node:sqlite, the same SQLite dialect Durable Objects use.
 */
const KEY = "test-key-never-printed-0123456789";
const DAY = Date.UTC(2026, 10, 19, 10, 0, 0);

function stubFetch(handler = () => new Response(Uint8Array.of(1, 2, 3), { status: 200 })) {
  const calls = [];
  const fn = async (url, init) => { calls.push(String(url)); return handler(String(url), init, calls.length); };
  fn.calls = calls;
  return fn;
}
function hubWith({ key = KEY, fetch = stubFetch(), caps = DEFAULT_TRAFFIC_CAPS, storage = new MemoryLedgerStorage(), clock = { now: DAY } } = {}) {
  const hub = new TrafficHub({ storage, key, fetch, caps, now: () => clock.now });
  return { hub, fetch, storage, clock };
}
const sqlOf = (db) => ({
  exec(query, ...bindings) {
    const statement = db.prepare(query);
    const rows = /^\s*SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows };
  },
});

test("quota maths: all or nothing, daily and monthly caps, an overlay share, and a new day or month starts fresh", () => {
  const caps = { dailyTiles: 10, monthlyTiles: 15, dailyOverlayTiles: 4, perCalculationTiles: 24 };
  let usage = null;
  for (let i = 0; i < 4; i += 1) { const r = reserve(usage, DAY, 1, "overlay", caps); assert.equal(r.ok, true); usage = r.usage; }
  assert.deepEqual(reserve(usage, DAY, 1, "overlay", caps), { ok: false, reason: "overlay", usage });
  for (let i = 0; i < 6; i += 1) { const r = reserve(usage, DAY, 1, "route", caps); assert.equal(r.ok, true, "route requests are not limited by the overlay share"); usage = r.usage; }
  assert.equal(reserve(usage, DAY, 1, "route", caps).reason, "daily");
  assert.equal(reserve(usage, DAY, 11, "route", caps).ok, false);
  const tomorrow = DAY + 24 * 3600_000;
  assert.equal(rolled(usage, tomorrow).dayUsed, 0);
  assert.equal(rolled(usage, tomorrow).monthUsed, 10, "the month keeps counting");
  usage = reserve(usage, tomorrow, 5, "route", caps).usage;
  assert.equal(reserve(usage, tomorrow, 1, "route", caps).reason, "monthly", "15 a month, spent");
  assert.equal(rolled(usage, Date.UTC(2026, 11, 1)).monthUsed, 0);
});

test("without a key nothing leaves the Worker and the status says so", async () => {
  const { hub, fetch } = hubWith({ key: "" });
  assert.deepEqual(await hub.tile("flow", 14, 8744, 5693, "route"), { ok: false, reason: "no-key" });
  const status = hub.status();
  assert.equal(status.configured, false);
  assert.equal(status.available, false);
  assert.equal(status.reason, "no-key");
  assert.equal(fetch.calls.length, 0);
});

test("one provider call per tile: cached for the TTL, shared by simultaneous callers, refreshed after it", async () => {
  const { hub, fetch, clock } = hubWith();
  const [a, b] = await Promise.all([hub.tile("flow", 14, 8744, 5693, "route"), hub.tile("flow", 14, 8744, 5693, "overlay")]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(fetch.calls.length, 1, "two callers, one request");
  assert.equal(hub.status().remainingToday, DEFAULT_TRAFFIC_CAPS.dailyTiles - 1, "one quota unit");
  const again = await hub.tile("flow", 14, 8744, 5693, "route");
  assert.equal(again.ok && again.cached, true);
  assert.equal(fetch.calls.length, 1);
  clock.now += FLOW_TTL_MS + 1;
  const refreshed = await hub.tile("flow", 14, 8744, 5693, "route");
  assert.equal(refreshed.ok && refreshed.cached, false);
  assert.equal(fetch.calls.length, 2);
  assert.match(fetch.calls[0], /^https:\/\/api\.tomtom\.com\/traffic\/map\/4\/tile\/flow\/relative\/14\/8744\/5693\.pbf\?key=/);
  await hub.tile("incidents", 12, 2186, 1423, "route");
  assert.match(fetch.calls[2], /\/tile\/incidents\/12\/2186\/1423\.pbf\?key=.*&t=-1$/);
});

test("the daily cap stops provider calls for good: the cap is spent before the call, cached tiles stay free", async () => {
  const caps = { ...DEFAULT_TRAFFIC_CAPS, dailyTiles: 3, dailyOverlayTiles: 2 };
  const { hub, fetch } = hubWith({ caps });
  for (const x of [1, 2]) assert.equal((await hub.tile("flow", 14, x, 1, "overlay")).ok, true);
  assert.deepEqual(await hub.tile("flow", 14, 3, 1, "overlay"), { ok: false, reason: "quota-overlay" }, "the overlay share is spent first");
  assert.equal((await hub.tile("flow", 14, 4, 1, "route")).ok, true, "a route calculation can still use the rest");
  assert.deepEqual(await hub.tile("flow", 14, 5, 1, "route"), { ok: false, reason: "quota-daily" });
  assert.equal(fetch.calls.length, 3, "never a request past the cap");
  assert.equal((await hub.tile("flow", 14, 1, 1, "route")).ok, true, "a cached tile needs no quota");
  const status = hub.status();
  assert.equal(status.available, false);
  assert.equal(status.reason, "quota-daily");
  assert.equal(status.remainingToday, 0);
});

test("the monthly cap and the day rollover", async () => {
  const caps = { ...DEFAULT_TRAFFIC_CAPS, dailyTiles: 2, monthlyTiles: 3 };
  const { hub, fetch, clock } = hubWith({ caps });
  await hub.tile("flow", 14, 1, 1, "route"); await hub.tile("flow", 14, 2, 1, "route");
  assert.equal((await hub.tile("flow", 14, 3, 1, "route")).reason, "quota-daily");
  clock.now += 24 * 3600_000;
  assert.equal((await hub.tile("flow", 14, 3, 1, "route")).ok, true, "a new day, a new daily quota");
  assert.equal((await hub.tile("flow", 14, 4, 1, "route")).reason, "quota-monthly", "the month is spent");
  assert.equal(hub.status().reason, "quota-monthly");
  assert.equal(fetch.calls.length, 3);
});

test("the circuit breaker: a rejected key closes it for hours, 429 for minutes, three failures for minutes; a success closes it", async () => {
  const forbidden = hubWith({ fetch: stubFetch(() => new Response("no", { status: 403 })) });
  assert.equal((await forbidden.hub.tile("flow", 14, 1, 1, "route")).reason, "key-rejected");
  assert.equal((await forbidden.hub.tile("flow", 14, 2, 1, "route")).reason, "key-rejected");
  assert.equal(forbidden.fetch.calls.length, 1, "no second call while the circuit is open");
  forbidden.clock.now += 5 * 3600_000;
  assert.equal(forbidden.hub.status().reason, "key-rejected", "still open after five hours");
  forbidden.clock.now += 2 * 3600_000;
  assert.equal(forbidden.hub.status().reason, "ok", "retried after six");

  const limited = hubWith({ fetch: stubFetch(() => new Response("slow down", { status: 429 })) });
  assert.equal((await limited.hub.tile("flow", 14, 1, 1, "route")).reason, "provider-limit");
  limited.clock.now += 16 * 60_000;
  assert.equal(limited.hub.status().reason, "ok");

  let healthy = false;
  const flaky = hubWith({ fetch: stubFetch(() => (healthy ? new Response(Uint8Array.of(9), { status: 200 }) : new Response("x", { status: 500 }))) });
  for (const x of [1, 2]) assert.equal((await flaky.hub.tile("flow", 14, x, 1, "route")).reason, "provider-failing");
  assert.equal(flaky.hub.status().available, true, "two failures do not open it");
  assert.equal((await flaky.hub.tile("flow", 14, 3, 1, "route")).reason, "provider-failing");
  assert.equal(flaky.hub.status().reason, "provider-failing");
  const before = flaky.fetch.calls.length;
  await flaky.hub.tile("flow", 14, 4, 1, "route");
  assert.equal(flaky.fetch.calls.length, before, "open: no call");
  flaky.clock.now += 6 * 60_000; healthy = true;
  assert.equal((await flaky.hub.tile("flow", 14, 5, 1, "route")).ok, true);
  assert.equal(flaky.hub.status().reason, "ok");
  assert.equal(flaky.storage.breaker.failures, 0);

  const missing = hubWith({ fetch: stubFetch(() => new Response("", { status: 404 })) });
  assert.equal((await missing.hub.tile("flow", 14, 1, 1, "route")).reason, "bad-request");
  assert.equal(missing.hub.status().available, true, "a bad tile is not the provider's failure");
  const timeout = hubWith({ fetch: async () => { throw new DOMException("aborted", "AbortError"); } });
  assert.equal((await timeout.hub.tile("flow", 14, 1, 1, "route")).reason, "provider-failing");
});

test("tile coordinates are validated before anything is spent", async () => {
  const { hub, fetch } = hubWith();
  for (const [z, x, y] of [[9, 1, 1], [15, 1, 1], [14, -1, 1], [14, 99999, 1], [14, 1.5, 1], [NaN, 1, 1]]) {
    assert.deepEqual(await hub.tile("flow", z, x, y, "route"), { ok: false, reason: "bad-request" }, `${z}/${x}/${y}`);
  }
  assert.equal(fetch.calls.length, 0);
  assert.equal(hub.status().remainingToday, DEFAULT_TRAFFIC_CAPS.dailyTiles);
});

test("the key is never returned, logged or put in an error; the internal endpoints answer plain JSON or bytes", async () => {
  const logged = [];
  const originals = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...args) => logged.push(args.join(" "));
  try {
    const { hub } = hubWith({ fetch: stubFetch(() => new Response("denied", { status: 403 })) });
    const failed = await hub.handle(new Request("https://traffic-hub.internal/tile?kind=flow&z=14&x=8744&y=5693&purpose=route"));
    assert.equal(failed.status, 503);
    const texts = [await failed.text(), JSON.stringify(hub.status()), JSON.stringify(await hub.tile("flow", 14, 1, 2, "route"))];
    assert.ok(texts.every((text) => !text.includes(KEY)), "no response carries the key");
    const ok = hubWith();
    const good = await ok.hub.handle(new Request("https://traffic-hub.internal/tile?kind=incidents&z=12&x=2186&y=1423&purpose=overlay"));
    assert.equal(good.status, 200);
    assert.equal(good.headers.get("content-type"), "application/x-protobuf");
    assert.equal(good.headers.get("x-traffic-cached"), "0");
    assert.deepEqual([...new Uint8Array(await good.arrayBuffer())], [1, 2, 3]);
    assert.equal((await ok.hub.handle(new Request("https://traffic-hub.internal/tile?kind=nope&z=14&x=1&y=1&purpose=route"))).status, 400);
    assert.equal((await ok.hub.handle(new Request("https://traffic-hub.internal/tile?kind=flow&z=3&x=1&y=1&purpose=route"))).status, 400);
    assert.equal((await ok.hub.handle(new Request("https://traffic-hub.internal/elsewhere"))).status, 404);
    const status = await (await ok.hub.handle(new Request("https://traffic-hub.internal/status"))).json();
    assert.deepEqual(Object.keys(status).sort(), ["available", "configured", "provider", "reason", "remainingThisMonth", "remainingToday"]);
  } finally {
    Object.assign(console, originals);
  }
  assert.ok(logged.every((line) => !line.includes(KEY)), "nothing logged contains the key");
  assert.ok(!tileUrl("flow", 14, 1, 1, "a b&c").includes("a b&c"), "the key is URL-encoded");
});

test("the ledger survives a restart: usage, breaker and tiles live in SQLite, so a restart cannot reset the quota", async () => {
  const db = new DatabaseSync(":memory:");
  const clock = { now: DAY };
  const caps = { ...DEFAULT_TRAFFIC_CAPS, dailyTiles: 2 };
  const first = hubWith({ storage: new SqlLedgerStorage(sqlOf(db)), caps, clock });
  await first.hub.tile("flow", 14, 1, 1, "route");
  await first.hub.tile("flow", 14, 2, 1, "route");
  const second = hubWith({ storage: new SqlLedgerStorage(sqlOf(db)), caps, clock });
  assert.equal(second.hub.status().remainingToday, 0, "the new instance reads the spent quota");
  assert.deepEqual(await second.hub.tile("flow", 14, 3, 1, "route"), { ok: false, reason: "quota-daily" });
  assert.equal(second.fetch.calls.length, 0);
  const cached = await second.hub.tile("flow", 14, 1, 1, "route");
  assert.equal(cached.ok && cached.cached, true, "the tile cache is persisted too");
  assert.deepEqual([...cached.bytes], [1, 2, 3], "bytes round-trip through the BLOB column");
  const rejected = hubWith({ storage: new SqlLedgerStorage(sqlOf(db)), fetch: stubFetch(() => new Response("", { status: 401 })), clock });
  clock.now += 24 * 3600_000;
  await rejected.hub.tile("flow", 14, 9, 9, "route");
  const afterRestart = hubWith({ storage: new SqlLedgerStorage(sqlOf(db)), clock });
  assert.equal(afterRestart.hub.status().reason, "key-rejected", "an open breaker is remembered");
  db.close();
});
