import assert from "node:assert/strict";
import test from "node:test";
import { GpsWatchHub, HIGH_ACCURACY_WATCH_OPTIONS, LOW_ACCURACY_WATCH_OPTIONS } from "../lib/gps-watch-hub.ts";
import { FOLLOW_OFF_PREFERENCE, ForegroundFollow } from "../lib/foreground-follow.ts";

/** A geolocation double that records every watch and can answer the newest one. */
function fakeGeolocation({ synchronousFix = false } = {}) {
  const live = new Map();
  const log = { started: 0, cleared: 0, options: [] };
  let next = 1;
  return {
    live, log,
    api: {
      watchPosition(success, error, options) {
        const id = next++;
        live.set(id, { success, error, options });
        log.started += 1;
        log.options.push(options);
        if (synchronousFix) success({ timestamp: 1_000, coords: { latitude: 45.46, longitude: 9.19, accuracy: 9, heading: null, speed: null } });
        return id;
      },
      clearWatch(id) { if (live.delete(id)) log.cleared += 1; },
    },
    fix(extra = {}) {
      const [watch] = [...live.values()].slice(-1);
      watch?.success({ timestamp: 1_000, coords: { latitude: 45.46, longitude: 9.19, accuracy: 8, heading: 90, speed: 5, ...extra } });
    },
    error(code) { const [watch] = [...live.values()].slice(-1); watch?.error({ code, message: "x" }); },
  };
}

function fakePermission(state) {
  const listeners = new Set();
  return {
    state,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    change(next) { this.state = next; for (const listener of [...listeners]) listener(); },
    get listeners() { return listeners.size; },
  };
}

function setup({ permission = fakePermission("granted"), query, noQuery = false, stored = false, geo = fakeGeolocation(), storageThrows = false } = {}) {
  const hub = new GpsWatchHub(() => geo.api);
  const fixes = [];
  const statuses = [];
  const storage = { off: stored, writes: [] };
  const follow = new ForegroundFollow({
    hub,
    queryPermission: noQuery ? undefined : (query ?? (async () => permission)),
    readOff: () => { if (storageThrows) throw new Error("blocked"); return storage.off; },
    writeOff: (value) => { if (storageThrows) throw new Error("blocked"); storage.off = value; storage.writes.push(value); },
    onFix: (position) => fixes.push(position.coords.latitude),
    onStatus: (status) => statuses.push(status),
  });
  return { follow, hub, geo, permission, fixes, statuses, storage };
}

test("a granted permission starts exactly one low-accuracy watch by itself and forwards every fix", async () => {
  const { follow, geo, fixes, statuses } = setup();
  await follow.connect();
  assert.equal(geo.log.started, 1);
  assert.equal(geo.live.size, 1);
  assert.deepEqual(geo.log.options[0], { ...LOW_ACCURACY_WATCH_OPTIONS }, "lower power outside navigation");
  assert.equal(geo.log.options[0].enableHighAccuracy, false);
  assert.deepEqual(statuses, ["waiting"]);
  geo.fix({ latitude: 45.5 });
  geo.fix({ latitude: 45.6 });
  assert.deepEqual(fixes, [45.5, 45.6]);
  assert.deepEqual(statuses, ["waiting", "live"]);
});

for (const state of ["prompt", "denied"]) {
  test(`a ${state} permission never starts geolocation by itself`, async () => {
    const { follow, geo, statuses } = setup({ permission: fakePermission(state) });
    await follow.connect();
    assert.equal(geo.log.started, 0, "no watchPosition, so no permission prompt raised by the page");
    assert.deepEqual(statuses, [state === "denied" ? "denied" : "gesture-required"]);
  });
}

test("a missing, failing or null Permissions API waits for a gesture, and a gesture then starts one watch", async () => {
  for (const options of [{ noQuery: true }, { query: async () => null }, { query: async () => { throw new TypeError("geolocation is not a valid name"); } }]) {
    const { follow, geo, statuses } = setup(options);
    await follow.connect();
    assert.equal(geo.log.started, 0);
    assert.deepEqual(statuses, ["gesture-required"]);
    follow.startFromGesture();
    follow.startFromGesture();
    assert.equal(geo.log.started, 1, "a second tap does not open a second watch");
    assert.equal(geo.live.size, 1);
  }
});

test("a hidden page releases the watch and a visible one restores exactly one, however many events arrive", async () => {
  const { follow, geo, statuses } = setup();
  await follow.connect();
  follow.setVisible(false);
  follow.setVisible(false);
  assert.equal(geo.live.size, 0, "nothing is left running while hidden");
  assert.equal(statuses.at(-1), "suspended");
  follow.setVisible(true);
  follow.setVisible(true);
  await follow.refresh();
  assert.equal(geo.live.size, 1);
  assert.equal(geo.log.started, 2, "one watch before, one after");
  assert.equal(follow.subscribed, true);
});

test("switching it off is remembered, survives a reload and blocks automatic start until a gesture", async () => {
  const first = setup();
  await first.follow.connect();
  first.follow.switchOff();
  assert.equal(first.geo.live.size, 0);
  assert.equal(first.storage.off, true, "the preference is stored, nothing else");
  assert.equal(first.statuses.at(-1), "off");
  first.follow.setVisible(false);
  first.follow.setVisible(true);
  await first.follow.refresh();
  assert.equal(first.geo.log.started, 1, "hiding and showing never revives an explicit off");

  // A "reload": a new follow reading the same storage, with the permission still granted.
  const reloaded = setup({ stored: first.storage.off });
  await reloaded.follow.connect();
  assert.equal(reloaded.geo.log.started, 0);
  assert.equal(reloaded.statuses.at(-1), "off");
  reloaded.follow.startFromGesture();
  assert.equal(reloaded.geo.log.started, 1);
  assert.equal(reloaded.storage.off, false, "the gesture clears the remembered off");
});

test("only the preference is ever written: no coordinate reaches storage", async () => {
  const { follow, geo, storage } = setup();
  await follow.connect();
  geo.fix({ latitude: 45.123, longitude: 9.456 });
  follow.switchOff();
  assert.deepEqual(storage.writes, [true]);
  assert.equal(FOLLOW_OFF_PREFERENCE, "lastrico-location-follow-off");
});

test("a permission answer that arrives after the page was hidden, switched off or disposed starts nothing", async () => {
  for (const interrupt of [(f) => f.setVisible(false), (f) => f.switchOff(), (f) => f.dispose()]) {
    let resolve;
    const permission = fakePermission("granted");
    const { follow, geo } = setup({ permission, query: () => new Promise((r) => { resolve = r; }) });
    const connecting = follow.connect();
    interrupt(follow);
    resolve(permission);
    await connecting;
    assert.equal(geo.log.started, 0, "the late answer is dropped");
    assert.equal(geo.live.size, 0);
  }
});

test("of two overlapping permission checks, only the newest answer counts", async () => {
  const answers = [];
  const { follow, geo } = setup({ query: () => new Promise((resolve) => answers.push(resolve)) });
  const first = follow.connect();
  const second = follow.refresh();
  answers[1](fakePermission("granted"));
  answers[0](fakePermission("denied"));
  await Promise.all([first, second]);
  assert.equal(geo.live.size, 1, "the older, denied answer did not undo the newer granted one");
});

test("a permission change revokes and restores one watch, and never overrides an explicit off", async () => {
  const { follow, geo, permission, statuses } = setup();
  await follow.connect();
  permission.change("denied");
  await follow.refresh();
  assert.equal(geo.live.size, 0);
  assert.equal(statuses.at(-1), "denied");
  permission.change("granted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(geo.live.size, 1);
  assert.equal(geo.log.started, 2);
  follow.switchOff();
  permission.change("granted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(geo.live.size, 0, "off wins over a permission event");
  follow.dispose();
  assert.equal(permission.listeners, 0, "the permission listener is removed on dispose");
});

test("following, navigation and recording share one underlying watch, and the accuracy tracks the most demanding", async () => {
  const { follow, hub, geo, fixes } = setup();
  await follow.connect();
  assert.equal(geo.live.size, 1);
  const navigation = [];
  const leaveNavigation = hub.subscribe({ highAccuracy: true, onFix: (p) => navigation.push(p.coords.latitude) });
  const recording = [];
  const leaveRecording = hub.subscribe({ highAccuracy: true, onFix: (p) => recording.push(p.coords.latitude) });
  assert.equal(geo.live.size, 1, "three subscribers, one watch");
  assert.deepEqual(geo.log.options.at(-1), { ...HIGH_ACCURACY_WATCH_OPTIONS });
  geo.fix({ latitude: 45.7 });
  assert.deepEqual([fixes, navigation, recording], [[45.7], [45.7], [45.7]], "every subscriber hears the same fix");
  leaveNavigation();
  assert.equal(geo.live.size, 1, "recording keeps the watch");
  leaveRecording();
  assert.equal(geo.live.size, 1, "following keeps the watch");
  assert.deepEqual(geo.log.options.at(-1), { ...LOW_ACCURACY_WATCH_OPTIONS }, "back to low power once nobody needs high accuracy");
  assert.equal(geo.log.started - geo.log.cleared, 1, "never more than one live watch over the whole sequence");
  follow.switchOff();
  assert.equal(geo.live.size, 0, "the last subscriber leaving clears the watch");
});

test("switching following off does not stop a navigation that is using the same watch", async () => {
  const { follow, hub, geo } = setup();
  await follow.connect();
  const navigation = [];
  const leaveNavigation = hub.subscribe({ highAccuracy: true, onFix: (p) => navigation.push(p.coords.latitude) });
  follow.switchOff();
  assert.equal(geo.live.size, 1, "navigation still has its watch");
  geo.fix({ latitude: 45.8 });
  assert.deepEqual(navigation, [45.8]);
  leaveNavigation();
  assert.equal(geo.live.size, 0);
});

test("a denied permission error releases following and says so; a transient error keeps it and recovers on the next fix", async () => {
  const transient = setup();
  await transient.follow.connect();
  transient.geo.error(3);
  assert.equal(transient.statuses.at(-1), "unavailable");
  assert.equal(transient.geo.live.size, 1, "a timeout does not drop the watch");
  transient.geo.fix({ latitude: 45.9 });
  assert.equal(transient.statuses.at(-1), "live");
  assert.deepEqual(transient.fixes, [45.9]);

  const denied = setup();
  await denied.follow.connect();
  denied.geo.error(1);
  assert.equal(denied.statuses.at(-1), "denied");
  assert.equal(denied.follow.subscribed, false);
  assert.equal(denied.geo.live.size, 0, "a denied permission ends the watch");
});

test("a browser that answers synchronously is handled: the first fix is not lost and a synchronous denial keeps nothing", async () => {
  const sync = setup({ geo: fakeGeolocation({ synchronousFix: true }) });
  await sync.follow.connect();
  assert.deepEqual(sync.fixes, [45.46], "a fix delivered before subscribe returned still reaches the page");
  assert.equal(sync.follow.subscribed, true);

  const hub = { supported: true, subscribe(subscriber) { subscriber.onError({ code: 1, message: "x" }); return () => { left += 1; }; } };
  let left = 0;
  const statuses = [];
  const follow = new ForegroundFollow({ hub, queryPermission: async () => fakePermission("granted"), onFix() {}, onStatus: (s) => statuses.push(s) });
  await follow.connect();
  assert.equal(follow.subscribed, false);
  assert.equal(left, 1, "the subscription that was denied while subscribing is left again");
  assert.equal(statuses.at(-1), "denied");
});

test("blocked storage and unsupported geolocation fail safely", async () => {
  const blocked = setup({ storageThrows: true });
  await blocked.follow.connect();
  assert.equal(blocked.geo.log.started, 1, "unreadable preference means not off");
  blocked.follow.switchOff();
  assert.equal(blocked.follow.isOff, true, "the in-memory value stays authoritative");
  assert.equal(blocked.geo.live.size, 0);

  const statuses = [];
  const hub = { supported: false, subscribe() { throw new Error("must not be called"); } };
  const follow = new ForegroundFollow({ hub, queryPermission: async () => fakePermission("granted"), onFix() {}, onStatus: (s) => statuses.push(s) });
  await follow.connect();
  assert.deepEqual(statuses, ["unavailable"]);
});

test("the page has one watchPosition call site and follow, navigation and the recorder all go through the hub", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const roots = ["app", "components", "lib"];
  const callers = [];
  const walk = async (directory) => {
    for (const entry of await readdir(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(tsx?|mjs)$/.test(entry.name)) {
        const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
        if (/\.watchPosition\s*\(/.test(text)) callers.push(path);
      }
    }
  };
  for (const root of roots) await walk(root);
  assert.deepEqual(callers, ["lib/gps-watch-hub.ts"]);
});
