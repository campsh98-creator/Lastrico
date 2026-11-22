import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { GpsWatchHub, HIGH_ACCURACY_WATCH_OPTIONS, LOW_ACCURACY_WATCH_OPTIONS } from "../lib/gps-watch-hub.ts";

const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

function fakeGeolocation() {
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
        return id;
      },
      clearWatch(id) { if (live.delete(id)) log.cleared += 1; },
    },
    /** Delivers to the newest live watch, as the browser would. */
    fix(extra = {}) {
      const [watch] = [...live.values()].slice(-1);
      watch?.success({ timestamp: 1_000, coords: { latitude: 45.46, longitude: 9.19, accuracy: 8, heading: 90, speed: 5, ...extra } });
    },
    error(code) { const [watch] = [...live.values()].slice(-1); watch?.error({ code, message: "x" }); },
  };
}
const make = () => { const geo = fakeGeolocation(); return { geo, hub: new GpsWatchHub(() => geo.api) }; };

test("navigation and recording share one underlying watch, and both receive every fix", () => {
  const { geo, hub } = make();
  const navigation = []; const recording = [];
  const leaveNavigation = hub.subscribe({ highAccuracy: true, onFix: (p) => navigation.push(p.coords.latitude) });
  assert.equal(geo.log.started, 1);
  const leaveRecording = hub.subscribe({ highAccuracy: true, onFix: (p) => recording.push(p.coords.latitude) });
  assert.equal(geo.log.started, 1, "a second subscriber does not open a second watch");
  assert.equal(geo.live.size, 1);
  geo.fix({ latitude: 45.5 });
  assert.deepEqual(navigation, [45.5]);
  assert.deepEqual(recording, [45.5]);
  leaveNavigation();
  assert.equal(geo.live.size, 1, "recording keeps the watch alive after navigation ends");
  geo.fix({ latitude: 45.6 });
  assert.deepEqual(navigation, [45.5], "a subscriber that left hears nothing more");
  assert.deepEqual(recording, [45.5, 45.6]);
  leaveRecording();
  assert.equal(geo.live.size, 0, "the last subscriber clears the watch");
  leaveRecording(); // idempotent
  assert.equal(geo.log.cleared, 1);
});

test("accuracy follows the most demanding subscriber, up and down", () => {
  const { geo, hub } = make();
  const leaveLow = hub.subscribe({ onFix() {} });
  assert.deepEqual(geo.log.options.at(-1), LOW_ACCURACY_WATCH_OPTIONS);
  const leaveHigh = hub.subscribe({ highAccuracy: true, onFix() {} });
  assert.deepEqual(geo.log.options.at(-1), HIGH_ACCURACY_WATCH_OPTIONS);
  assert.equal(geo.live.size, 1, "upgrading replaces the watch, it does not add one");
  leaveHigh();
  assert.deepEqual(geo.log.options.at(-1), LOW_ACCURACY_WATCH_OPTIONS, "back to low power when nobody needs better");
  assert.equal(geo.live.size, 1);
  leaveLow();
  assert.equal(geo.live.size, 0);
});

test("navigation keeps the options it has always used", () => {
  assert.deepEqual(HIGH_ACCURACY_WATCH_OPTIONS, { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 });
});

test("renew replaces the watch once for everybody and a stale watch's callbacks reach nobody", () => {
  const { geo, hub } = make();
  const heard = [];
  hub.subscribe({ highAccuracy: true, onFix: () => heard.push("a") });
  hub.subscribe({ highAccuracy: true, onFix: () => heard.push("b") });
  const old = [...geo.live.values()][0];
  hub.renew();
  assert.equal(geo.log.started, 2);
  assert.equal(geo.live.size, 1, "the old watch is released");
  old.success({ timestamp: 1, coords: { latitude: 1, longitude: 1, accuracy: 1, heading: null, speed: null } });
  assert.deepEqual(heard, [], "a late callback of the replaced watch is dropped");
  geo.fix();
  assert.deepEqual(heard, ["a", "b"]);
});

test("renew without subscribers does nothing", () => {
  const { geo, hub } = make();
  hub.renew();
  assert.equal(geo.log.started, 0);
});

test("errors reach every subscriber; a denied permission ends the watch and the next subscriber asks again", () => {
  const { geo, hub } = make();
  const errors = [];
  const leaveA = hub.subscribe({ highAccuracy: true, onFix() {}, onError: (e) => errors.push(["a", e.code]) });
  hub.subscribe({ highAccuracy: true, onFix() {}, onError: (e) => errors.push(["b", e.code]) });
  geo.error(3); // timeout: the watch carries on
  assert.deepEqual(errors, [["a", 3], ["b", 3]]);
  assert.equal(geo.live.size, 1);
  geo.error(1); // permission denied
  assert.deepEqual(errors.slice(2), [["a", 1], ["b", 1]]);
  assert.equal(geo.live.size, 0, "the dead watch is forgotten");
  assert.equal(hub.active, false);
  hub.subscribe({ highAccuracy: true, onFix() {} });
  assert.equal(geo.live.size, 1, "a new subscriber asks the browser again");
  leaveA();
  assert.equal(geo.live.size, 1);
});

test("a subscriber may leave from inside its own error callback (navigation does when permission is denied)", () => {
  const { geo, hub } = make();
  const heard = [];
  let leave = () => {};
  leave = hub.subscribe({ highAccuracy: true, onFix() {}, onError: () => { heard.push("nav"); leave(); } });
  hub.subscribe({ highAccuracy: true, onFix() {}, onError: () => heard.push("rec") });
  geo.error(1);
  assert.deepEqual(heard, ["nav", "rec"]);
  assert.equal(hub.size, 1);
});

test("one failing subscriber does not starve the others, and its error is not swallowed", (t) => {
  const { geo, hub } = make();
  const heard = [];
  const deferred = [];
  t.mock.method(globalThis, "setTimeout", (callback) => { deferred.push(callback); return 0; });
  hub.subscribe({ onFix() { throw new Error("boom"); } });
  hub.subscribe({ onFix: () => heard.push("ok") });
  geo.fix();
  assert.deepEqual(heard, ["ok"]);
  assert.equal(deferred.length, 1, "rethrown outside the delivery loop");
  assert.throws(() => deferred[0](), /boom/);
});

test("without geolocation nothing is started and nothing throws", () => {
  const hub = new GpsWatchHub(() => undefined);
  assert.equal(hub.supported, false);
  const leave = hub.subscribe({ onFix() {} });
  hub.renew();
  leave();
  assert.equal(hub.active, false);
});

test("a permission error delivered synchronously during watchPosition cannot leave a dangling watch behind", () => {
  const cleared = [];
  const errors = [];
  const geo = {
    watchPosition(_success, error) { error({ code: 1, message: "denied" }); return 7; },
    clearWatch: (id) => cleared.push(id),
  };
  const hub = new GpsWatchHub(() => geo);
  hub.subscribe({ onFix() {}, onError: (e) => errors.push(e.code) });
  assert.deepEqual(errors, [1]);
  assert.deepEqual(cleared, [7], "the id returned after the watch already ended is released");
  assert.equal(hub.active, false);
});

test("watchPosition is called in exactly one place: the hub (navigation and recording both go through it)", async () => {
  const sources = {
    hub: await read("lib/gps-watch-hub.ts"),
    page: await read("app/page.tsx"),
    panel: await read("components/RecordingPanel.tsx"),
    recording: await read("lib/free-recording.ts"),
    trace: await read("lib/gps-trace.ts"),
  };
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.equal((strip(sources.hub).match(/\.watchPosition\(/g) ?? []).length, 1);
  for (const [name, text] of Object.entries(sources)) {
    if (name !== "hub") assert.equal((strip(text).match(/\.watchPosition\(/g) ?? []).length, 0, `${name} must not open its own watch`);
  }
  assert.match(sources.page, /gpsWatchHub\.subscribe\(/, "navigation subscribes");
  assert.match(sources.panel, /gpsWatchHub\.subscribe\(/, "recording subscribes");
  assert.match(sources.page, /gpsWatchHub\.renew\(\)/, "navigation's re-arm renews the shared watch");
});
