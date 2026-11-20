import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { credentialFingerprint, MemoryLedgerStorage, SqlLedgerStorage, TrafficHub } from "../worker/traffic-hub.ts";
import { DEFAULT_TRAFFIC_CAPS, emptyUsage } from "../lib/traffic/quota.ts";
import { authorizeTrafficProbe } from "../worker/traffic-auth.ts";

// Synthetic credentials only. Every provider interaction in this file is a local mock.
const OLD = "synthetic-previous-credential";
const NEW = "synthetic-replacement-credential";
const NOW = Date.UTC(2026, 10, 20, 10);
const SIX_HOURS = 6 * 60 * 60_000;
const bytes = () => new Response(Uint8Array.of(1, 2, 3));
const tile = (hub, x = 1, purpose = "route") => hub.tile("flow", 14, x, 1, purpose);

function setup(storage = new MemoryLedgerStorage(), options = {}) {
  const calls = [];
  const hub = new TrafficHub({ storage, key: NEW, now: () => NOW,
    fetch: async (...args) => { calls.push(args); return bytes(); }, ...options });
  return { hub, calls, storage };
}
async function rejected(storage = new MemoryLedgerStorage(), extra = {}) {
  storage.writeUsage({ ...emptyUsage(NOW), dayUsed: 37, dayOverlayUsed: 9, monthUsed: 123 });
  storage.writeBreaker({ failures: 1, openUntil: NOW + SIX_HOURS, reason: "key-rejected",
    fingerprint: await credentialFingerprint(OLD), seenFingerprints: [await credentialFingerprint(OLD)], ...extra });
  return storage;
}
function sqlite() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...bindings) {
    const statement = db.prepare(query);
    const rows = /^\s*SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows };
  } };
  return { db, storage: () => new SqlLedgerStorage(sql) };
}

test("credential identity uses domain-separated SHA-256 without normalizing the credential", async () => {
  const fingerprint = await credentialFingerprint(NEW);
  assert.equal(fingerprint, createHash("sha256").update(`lastrico:tomtom:v1\0${NEW}`).digest("hex"));
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprint, await credentialFingerprint(OLD));
  assert.notEqual(fingerprint, await credentialFingerprint(` ${NEW}`));
});

test("same rejected credential survives restart without spending quota or issuing a probe", async () => {
  const storage = await rejected();
  const before = structuredClone(storage.readState());
  for (let i = 0; i < 2; i += 1) {
    const { hub, calls } = setup(storage, { key: OLD });
    assert.equal((await hub.probe()).ok, false);
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(storage.readState(), before);
});

test("legacy rejection with unknown fingerprint remains closed, never relabeling the current key", async () => {
  const storage = await rejected();
  storage.writeBreaker({ failures: 1, openUntil: NOW + SIX_HOURS, reason: "key-rejected" });
  const before = structuredClone(storage.readState());
  for (const key of [NEW, OLD]) {
    const { hub, calls } = setup(storage, { key });
    assert.equal((await hub.probe()).ok, false);
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(storage.readState(), before);
});

test("changed key gets one probe across simultaneous distinct tiles; successful recovery keeps an indefinite hold", async () => {
  const storage = await rejected();
  const { hub, calls } = setup(storage, { probeOnly: true });
  const results = await Promise.all([hub.probe(), tile(hub, 2), hub.tile("incidents", 12, 3, 1, "overlay")]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(results.slice(1).every((result) => result.reason === "auth-recovery-hold"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].redirect, "error", "redirects cannot leak the key or create a second request");
  assert.match(String(calls[0][0]), /^https:\/\/api\.tomtom\.com\/traffic\/map\/4\/tile\/flow\/relative\//);
  assert.deepEqual(storage.readState().usage, { ...emptyUsage(NOW), dayUsed: 38, dayOverlayUsed: 9, monthUsed: 124 });
  assert.equal(storage.readState().breaker.recovery, "verified");
  assert.equal(hub.status().available, false);
  const restarted = setup(storage, { now: () => NOW + 10 * SIX_HOURS });
  assert.equal((await tile(restarted.hub, 4)).reason, "auth-recovery-hold");
  assert.equal(restarted.calls.length, 0);
});

for (const status of [401, 403, 429, 500, 404]) {
  test(`failed recovery HTTP ${status} spends once and restores at least six hours of lockout`, async () => {
    const storage = await rejected();
    let requests = 0;
    const { hub } = setup(storage, { fetch: async () => { requests += 1; return new Response("denied", { status }); } });
    assert.equal((await hub.probe()).ok, false);
    assert.equal(storage.readState().breaker.recovery, "failed");
    assert.ok(storage.readState().breaker.openUntil >= NOW + SIX_HOURS);
    assert.equal((await tile(hub, 2)).reason, "auth-recovery-hold");
    assert.equal(requests, 1);
    assert.equal(storage.readState().usage.dayUsed, 38);
    assert.equal(storage.readState().usage.monthUsed, 124);
  });
}

test("transport failure burns recovery authorization, including after another secret rotation", async () => {
  const storage = await rejected();
  let requests = 0;
  const { hub } = setup(storage, { fetch: async () => { requests += 1; throw new DOMException("mock abort", "AbortError"); } });
  assert.equal((await hub.probe()).ok, false);
  assert.equal(storage.readState().breaker.recovery, "failed");
  const next = setup(storage, { key: "another-synthetic-replacement", now: () => NOW + SIX_HOURS * 2 });
  assert.equal((await tile(next.hub, 2)).reason, "auth-recovery-hold");
  assert.equal(requests, 1);
  assert.equal(next.calls.length, 0);
});

test("recovery claim is persisted before provider I/O, and restart while pending cannot issue another probe", async () => {
  const sql = sqlite();
  try {
    const storage = await rejected(sql.storage());
    let resolveResponse;
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const first = setup(storage, { fetch: () => {
      assert.equal(sql.storage().readState().breaker.recovery, "pending");
      assert.equal(sql.storage().readState().usage.dayUsed, 38);
      started();
      return new Promise((resolve) => { resolveResponse = resolve; });
    } });
    const pending = first.hub.probe();
    await ready;
    const second = setup(sql.storage());
    assert.equal((await second.hub.probe()).reason, "auth-recovery-hold");
    assert.equal(second.calls.length, 0);
    resolveResponse(bytes());
    assert.equal((await pending).ok, true);
    assert.equal(sql.storage().readState().breaker.recovery, "verified");
  } finally { sql.db.close(); }
});

for (const [name, usage, reason] of [
  ["daily", { dayUsed: DEFAULT_TRAFFIC_CAPS.dailyTiles }, "quota-daily"],
  ["monthly", { monthUsed: DEFAULT_TRAFFIC_CAPS.monthlyTiles }, "quota-monthly"],
]) {
  test(`${name} quota blocks changed-key probe without resetting history or consuming its claim`, async () => {
    const storage = await rejected();
    storage.writeUsage({ ...storage.readState().usage, ...usage });
    const before = structuredClone(storage.readState());
    const { hub, calls } = setup(storage);
    assert.equal((await hub.probe()).reason, reason);
    assert.equal(calls.length, 0);
    assert.deepEqual(storage.readState(), before);
  });
}

for (const reason of ["provider-limit", "provider-failing"]) {
  test(`a different credential never bypasses an active ${reason} breaker`, async () => {
    const storage = await rejected(undefined, { reason });
    const before = structuredClone(storage.readState());
    const { hub, calls } = setup(storage);
    assert.equal((await hub.probe()).ok, false);
    assert.equal(calls.length, 0);
    assert.deepEqual(storage.readState(), before);
  });
}

test("previously seen credentials cannot be replayed to authorize a probe", async () => {
  const storage = await rejected(undefined, { seenFingerprints: [await credentialFingerprint(OLD), await credentialFingerprint(NEW)] });
  const { hub, calls } = setup(storage);
  assert.equal((await hub.probe()).ok, false);
  assert.equal(calls.length, 0);
});

test("probe-only deployment gates ordinary first-time use and expired legacy lockouts", async () => {
  for (const storage of [new MemoryLedgerStorage(), await rejected(undefined, { fingerprint: undefined, openUntil: NOW - 1 })]) {
    const { hub, calls } = setup(storage, { probeOnly: true });
    assert.equal(hub.status().available, false);
    assert.equal((await tile(hub)).reason, "auth-recovery-hold");
    assert.equal(calls.length, 0);
    assert.equal(storage.readState().breaker.recovery, undefined);
  }
});

test("ordinary public tiles cannot consume the recovery authorization or reset overlay history", async () => {
  for (const probeOnly of [false, true]) {
    const storage = await rejected();
    storage.writeUsage({ ...storage.readState().usage, dayOverlayUsed: DEFAULT_TRAFFIC_CAPS.dailyOverlayTiles });
    const before = structuredClone(storage.readState());
    const { hub, calls } = setup(storage, { probeOnly });
    for (const purpose of ["route", "overlay"]) {
      assert.equal((await tile(hub, 1, purpose)).ok, false);
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(storage.readState(), before);
    assert.equal((await hub.probe()).ok, true, "route-scoped probe does not spend the overlay share");
    assert.equal(calls.length, 1);
    assert.equal(storage.readState().usage.dayOverlayUsed, DEFAULT_TRAFFIC_CAPS.dailyOverlayTiles);
  }
});

test("concurrent explicit probes share one durable authorization", async () => {
  const { hub, calls } = setup(await rejected(), { probeOnly: true });
  const results = await Promise.all([hub.probe(), hub.probe(), hub.probe()]);
  assert.equal(calls.length, 1);
  assert.ok(results.some((answer) => answer.ok));
});

test("cached bytes cannot masquerade as a successful controlled authentication probe", async () => {
  const storage = await rejected();
  // Every possible cache key returns fresh bytes: an authentication probe must still reach the mock provider.
  storage.readTile = () => ({ fetchedAt: NOW, bytes: Uint8Array.of(9) });
  const { hub, calls } = setup(storage, { probeOnly: true });
  const result = await hub.probe();
  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.equal(calls.length, 1);
  assert.equal(storage.readState().breaker.recovery, "verified");
});

test("operator probe authorization fails closed for missing, weak, malformed and oversized tokens", async () => {
  const token = "synthetic-operator-token-with-32-characters";
  const request = (header) => new Request("https://preview.invalid/api/traffic/auth-probe", {
    method: "POST", headers: header === undefined ? {} : { Authorization: header },
  });
  for (const expected of [undefined, "", "short"]) {
    assert.equal(await authorizeTrafficProbe(request(`Bearer ${token}`), expected), false);
  }
  for (const header of [undefined, `Basic ${token}`, `bearer ${token}`, `Bearer wrong-${token}`, `Bearer ${"x".repeat(4097)}`]) {
    assert.equal(await authorizeTrafficProbe(request(header), token), false);
  }
  assert.equal(await authorizeTrafficProbe(request(`Bearer ${token}`), token), true);
});

test("status is read-only; SQL stores digests only and responses/logs disclose no credentials or digests", async () => {
  const sql = sqlite();
  const logged = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args) => logged.push(args.join(" "));
  try {
    const storage = await rejected(sql.storage());
    const { hub, calls } = setup(storage);
    const before = structuredClone(storage.readState());
    const status = await hub.handle(new Request("https://traffic-hub.internal/status"));
    const initialText = await status.text();
    assert.equal(calls.length, 0);
    assert.deepEqual(storage.readState(), before);
    await hub.probe();
    const finalText = JSON.stringify(hub.status());
    const privateState = JSON.stringify(sql.db.prepare("SELECT k, v FROM traffic_state").all());
    for (const secret of [OLD, NEW]) assert.ok(!privateState.includes(secret));
    assert.ok(privateState.includes(await credentialFingerprint(NEW)));
    for (const secret of [OLD, NEW, await credentialFingerprint(OLD), await credentialFingerprint(NEW)]) {
      assert.ok(!initialText.includes(secret));
      assert.ok(!finalText.includes(secret));
      assert.ok(logged.every((line) => !line.includes(secret)));
    }
  } finally {
    Object.assign(console, originals);
    sql.db.close();
  }
});
