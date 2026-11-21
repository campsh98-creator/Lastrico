import assert from "node:assert/strict";
import test from "node:test";
import { ForegroundGps } from "../lib/foreground-gps.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function permission(state) {
  const listeners = new Set();
  return {
    state,
    addEventListener(type, listener) { assert.equal(type, "change"); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, "change"); listeners.delete(listener); },
    change(next) { this.state = next; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; },
  };
}

function harness(overrides = {}) {
  const watches = new Map();
  const history = [];
  const clears = [];
  const positions = [];
  const statuses = [];
  const stored = [];
  const granted = permission("granted");
  let maxActive = 0;
  const geo = {
    watchPosition(success, error, options) {
      const id = history.length;
      const watch = { id, success, error, options };
      watches.set(id, watch);
      history.push(watch);
      maxActive = Math.max(maxActive, watches.size);
      return id;
    },
    clearWatch(id) { clears.push(id); watches.delete(id); },
  };
  const controller = new ForegroundGps({
    geolocation: geo,
    queryPermission: async () => granted,
    writeStopped: (value) => stored.push(value),
    onPosition: (value) => positions.push(value),
    onStatus: (value) => statuses.push(value),
    ...overrides,
  });
  return { controller, watches, history, clears, positions, statuses, stored, granted, get maxActive() { return maxActive; } };
}

test("granted startup creates one low accuracy foreground watch, including watch id zero", async () => {
  const h = harness();
  await h.controller.connect();
  assert.equal(h.controller.active, true);
  assert.equal(h.watches.size, 1);
  assert.equal(h.history[0].options.enableHighAccuracy, false);
  await h.controller.refresh();
  await h.controller.refresh();
  assert.equal(h.history.length, 1);
  const fix = { coords: { latitude: 45.46, longitude: 9.19, accuracy: 12 }, timestamp: Date.now() };
  h.history[0].success(fix);
  assert.deepEqual(h.positions, [fix]);
  assert.equal(h.statuses.at(-1), "live");
  h.controller.dispose();
  assert.deepEqual(h.clears, [0]);
  assert.equal(h.granted.listeners, 0);
});

for (const state of ["prompt", "denied"]) {
  test(`${state} permission never starts geolocation automatically`, async () => {
    const h = harness({ queryPermission: async () => permission(state) });
    await h.controller.connect();
    assert.equal(h.history.length, 0);
    assert.equal(h.statuses.at(-1), state === "denied" ? "denied" : "gesture-required");
    h.controller.startFromGesture();
    assert.equal(h.history.length, 1, "gesture arms synchronously");
    h.controller.dispose();
  });
}

test("missing or rejected Permissions API requires a gesture", async () => {
  for (const queryPermission of [undefined, async () => { throw new Error("unsupported"); }]) {
    const h = harness({ queryPermission });
    await h.controller.connect();
    assert.equal(h.history.length, 0);
    assert.equal(h.statuses.at(-1), "gesture-required");
    h.controller.startFromGesture();
    assert.equal(h.history.length, 1);
    h.controller.dispose();
  }
});

test("hidden page clears the watch and duplicate foreground events restore only one", async () => {
  const h = harness();
  await h.controller.connect();
  h.controller.setVisible(false);
  assert.equal(h.controller.active, false);
  assert.equal(h.watches.size, 0);
  h.controller.setVisible(true);
  h.controller.setVisible(true);
  await tick();
  assert.equal(h.watches.size, 1);
  assert.equal(h.maxActive, 1);
  h.controller.dispose();
});

test("navigation changes accuracy without creating concurrent watches", async () => {
  const h = harness();
  await h.controller.connect();
  h.controller.setNavigation(true);
  await tick();
  assert.equal(h.history.at(-1).options.enableHighAccuracy, true);
  assert.equal(h.history.at(-1).options.timeout, 12000);
  assert.equal(h.history.at(-1).options.maximumAge, 1500);
  h.controller.setNavigation(true);
  await tick();
  h.controller.setNavigation(false);
  await tick();
  assert.equal(h.history.at(-1).options.enableHighAccuracy, false);
  assert.equal(h.maxActive, 1);
  assert.equal(h.watches.size, 1);
  h.controller.dispose();
});

test("explicit stop persists and survives reload until a gesture re-enables GPS", async () => {
  let stopped = false;
  const storage = { readStopped: () => stopped, writeStopped: (value) => { stopped = value; } };
  const first = harness(storage);
  await first.controller.connect();
  first.controller.stop();
  assert.equal(stopped, true);
  assert.equal(first.controller.isStopped, true);
  assert.equal(first.watches.size, 0);
  first.controller.setVisible(false);
  first.controller.setVisible(true);
  await first.controller.refresh();
  assert.equal(first.watches.size, 0);
  first.controller.dispose();
  const second = harness(storage);
  await second.controller.connect();
  assert.equal(second.history.length, 0);
  assert.equal(second.controller.isStopped, true);
  second.controller.startFromGesture();
  assert.equal(stopped, false);
  assert.equal(second.controller.isStopped, false);
  assert.equal(second.watches.size, 1);
  second.controller.dispose();
});

test("stop, hiding, and disposal invalidate pending permission queries", async () => {
  for (const action of ["stop", "hide", "dispose"]) {
    const pending = deferred();
    const h = harness({ queryPermission: () => pending.promise });
    const connecting = h.controller.connect();
    if (action === "hide") h.controller.setVisible(false);
    else h.controller[action]();
    pending.resolve(permission("granted"));
    await connecting;
    assert.equal(h.history.length, 0, action);
    h.controller.dispose();
  }
});

test("a gesture invalidates old permission results and old watch callbacks", async () => {
  const pending = deferred();
  const h = harness({ queryPermission: () => pending.promise });
  const connecting = h.controller.connect();
  h.controller.startFromGesture();
  const old = h.history[0];
  pending.resolve(permission("denied"));
  await connecting;
  assert.equal(h.watches.size, 1);
  assert.notEqual(h.statuses.at(-1), "denied");
  h.controller.restartFromGesture();
  old.success({ coords: {}, timestamp: 1 });
  old.error({ code: 1, PERMISSION_DENIED: 1 });
  assert.equal(h.positions.length, 0);
  assert.equal(h.watches.size, 1);
  assert.equal(h.maxActive, 1);
  h.controller.dispose();
});

test("permission changes revoke and restore one watch, respecting explicit stop", async () => {
  const h = harness();
  await h.controller.connect();
  h.granted.change("denied");
  await tick();
  assert.equal(h.watches.size, 0);
  assert.equal(h.statuses.at(-1), "denied");
  h.granted.change("granted");
  await tick();
  assert.equal(h.watches.size, 1);
  h.controller.stop();
  h.granted.change("granted");
  await tick();
  assert.equal(h.watches.size, 0);
  h.controller.dispose();
});

test("late permission query from before background cannot replace the current permission", async () => {
  const older = deferred();
  const newer = deferred();
  let queries = 0;
  const h = harness({ queryPermission: () => (++queries === 1 ? older.promise : newer.promise) });
  const connecting = h.controller.connect();
  h.controller.setVisible(false);
  h.controller.setVisible(true);
  const current = permission("granted");
  newer.resolve(current);
  await tick();
  assert.equal(h.watches.size, 1);
  const stale = permission("denied");
  older.resolve(stale);
  await connecting;
  assert.equal(h.watches.size, 1);
  assert.equal(stale.listeners, 0);
  assert.equal(current.listeners, 1);
  h.controller.dispose();
  assert.equal(current.listeners, 0);
});

test("synchronous permission failure from a browser wrapper cannot retain a dead watch", async () => {
  const clears = [];
  const statuses = [];
  const controller = new ForegroundGps({
    geolocation: {
      watchPosition(success, error) { error({ code: 1 }); return 0; },
      clearWatch(id) { clears.push(id); },
    },
    onPosition() { assert.fail("denied watch must not deliver a position"); },
    onStatus: (status) => statuses.push(status),
  });
  controller.startFromGesture();
  assert.equal(controller.active, false);
  assert.equal(statuses.at(-1), "denied");
  assert.deepEqual(clears, [0]);
  controller.dispose();
});

test("permission errors stop the watch while transient errors retain it without retries", async () => {
  for (const code of [1, 2, 3]) {
    const h = harness();
    await h.controller.connect();
    h.history[0].error({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    await tick();
    assert.equal(h.history.length, 1, "no automatic polling or retry watch");
    assert.equal(h.watches.size, code === 1 ? 0 : 1);
    assert.equal(h.statuses.at(-1), code === 1 ? "denied" : "unavailable");
    h.controller.dispose();
  }
});

test("unavailable geolocation and blocked storage fail safely", async () => {
  const missing = harness({ geolocation: undefined });
  await missing.controller.connect();
  missing.controller.startFromGesture();
  assert.equal(missing.statuses.at(-1), "unavailable");
  missing.controller.dispose();
  const h = harness({ readStopped() { throw new Error("blocked"); }, writeStopped() { throw new Error("blocked"); } });
  await h.controller.connect();
  assert.equal(h.watches.size, 1);
  assert.doesNotThrow(() => h.controller.stop());
  assert.doesNotThrow(() => h.controller.startFromGesture());
  assert.equal(h.watches.size, 1);
  h.controller.dispose();
});
