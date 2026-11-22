import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseGpsTrace, replayGpsTrace } from "../lib/gps-trace.ts";

/*
 * Opt-in check against real driving traces. They reveal where a person was, so they never enter the repository and CI does not
 * have them: point LASTRICO_PRIVATE_TRACES at the folder (for example private/gps-traces) to run this on your own machine.
 * Nothing is printed except counts and degrees: no coordinate, no timestamp of a position.
 *
 * What it proves on real data: the app's per-fix logic still reproduces every recorded decision (no behaviour drift), and at
 * every reroute the app has the vehicle's own course to send (`heading` on the first routing point, PR #39) while the vehicle
 * moves, and sends none at a standstill (a stale course there is what started the U-turns of 20 November).
 */
const DIRECTORY = process.env.LASTRICO_PRIVATE_TRACES;
const skip = DIRECTORY ? false : "set LASTRICO_PRIVATE_TRACES to a folder of recorded traces (they stay out of the repository)";
const gap = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

test("real traces: every decision replays unchanged, and every reroute carries the vehicle's own course while it moves", { skip }, async (t) => {
  const files = (await readdir(DIRECTORY)).filter((name) => name.endsWith(".json")).sort();
  assert.ok(files.length > 0, "the folder holds at least one trace");
  let reroutes = 0;
  let moving = 0;
  let standstill = 0;
  for (const name of files) {
    const trace = parseGpsTrace(await readFile(join(DIRECTORY, name), "utf8"));
    const decisions = new Map();
    const report = replayGpsTrace(trace, (atFix, decision) => decisions.set(atFix, decision));
    assert.equal(report.differences.length, 0, `${name}: the replay differs from the recording at ${report.differences.length} fixes`);
    for (const event of trace.events.filter((item) => item.type === "reroute-start")) {
      const fix = trace.fixes[event.atFix];
      const decision = decisions.get(event.atFix);
      if (!fix || !decision || decision.outcome !== "accepted") continue;
      reroutes += 1;
      const [, , , , deviceHeading, speed] = fix;
      if (speed !== null && speed >= 2 && deviceHeading !== null && Number.isFinite(deviceHeading)) {
        moving += 1;
        assert.notEqual(decision.travelCourse, null, `${name}: reroute at fix ${event.atFix} has no course while moving at ${speed} m/s`);
        assert.ok(gap(decision.travelCourse, deviceHeading) <= 45, `${name}: the course sent at fix ${event.atFix} is ${Math.round(gap(decision.travelCourse, deviceHeading))} degrees off the device's own`);
      } else if (speed !== null && speed < 0.5) {
        standstill += 1;
        assert.equal(decision.travelCourse, null, `${name}: a stale course would be sent at a standstill (fix ${event.atFix})`);
      }
    }
  }
  t.diagnostic(`${files.length} traces replayed with 0 differences; ${reroutes} reroutes read: ${moving} while moving (course present and within 45 degrees of the device's), ${standstill} at a standstill (no course sent)`);
  assert.ok(reroutes > 0, "the traces contain reroutes to check");
});
