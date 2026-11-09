import assert from "node:assert/strict";
import test from "node:test";
import { headingDelta, motionAt, motionDistance, MOTION_LIMITS, planMarkerMotion, routeSliceBetween } from "../lib/marker-motion.ts";
import { buildRouteProgressModel, pointAtProgress } from "../lib/route-progress.ts";
import { distanceMeters } from "../lib/navigation-fix-processor.ts";

const LATITUDE = 45.48;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const at = (x, y) => [9.19 + x / metersPerLon, LATITUDE + y / 110_540];

test("the marker moves linearly towards the new point and never beyond it", () => {
  const plan = planMarkerMotion({ from: at(0, 0), fromHeading: 90, to: at(8, 0), toHeading: 90, now: 1_000, intervalMs: 1_000 });
  assert.equal(plan.durationMs, 950);
  const half = motionAt(plan, 1_000 + 475);
  assert.ok(Math.abs(motionDistance(at(0, 0), half.position) - 4) < 0.2);
  assert.equal(half.done, false);
  const late = motionAt(plan, 60_000);
  assert.deepEqual(late.position, at(8, 0), "no extrapolation when GPS stops");
  assert.equal(late.done, true);
});

test("the first point, a relocation and reduced motion are shown at once", () => {
  assert.equal(planMarkerMotion({ from: null, fromHeading: 0, to: at(0, 0), toHeading: 0, now: 0, intervalMs: null }).durationMs, 0);
  assert.equal(planMarkerMotion({ from: at(0, 0), fromHeading: 0, to: at(MOTION_LIMITS.teleportMeters + 10, 0), toHeading: 0, now: 0, intervalMs: 1_000 }).durationMs, 0);
  assert.equal(planMarkerMotion({ from: at(0, 0), fromHeading: 0, to: at(8, 0), toHeading: 0, now: 0, intervalMs: 1_000, reducedMotion: true }).durationMs, 0);
});

test("the duration follows the real update pace within limits", () => {
  const plan = (intervalMs) => planMarkerMotion({ from: at(0, 0), fromHeading: 0, to: at(5, 0), toHeading: 0, now: 0, intervalMs }).durationMs;
  assert.equal(plan(100), MOTION_LIMITS.minDurationMs);
  assert.equal(plan(3_000), MOTION_LIMITS.maxDurationMs, "slow updates do not leave the marker sliding for seconds");
});

test("through a bend the marker follows the road instead of cutting the corner", () => {
  const model = buildRouteProgressModel([at(0, 0), at(30, 0), at(30, 30)], [], distanceMeters);
  const slice = routeSliceBetween(model.coordinates, model.cumulativeMeters, 20, 40, (m) => pointAtProgress(model, m, 0).coordinate);
  const plan = planMarkerMotion({ from: slice[0], fromHeading: 90, to: slice.at(-1), toHeading: 0, now: 0, intervalMs: 1_000, routeSlice: slice });
  const middle = motionAt(plan, plan.durationMs / 2).position;
  assert.ok(motionDistance(middle, at(30, 0)) < 1, "half way through the bend is the corner itself");
});

test("the arrow turns the short way round", () => {
  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(10, 350), -20);
  const plan = planMarkerMotion({ from: at(0, 0), fromHeading: 350, to: at(5, 0), toHeading: 10, now: 0, intervalMs: 1_000 });
  const middle = motionAt(plan, plan.durationMs / 2).heading;
  assert.ok(middle < 1 || middle > 359, `passes through north (${middle})`);
});

test("a route slice is refused backwards or across an implausible distance", () => {
  const model = buildRouteProgressModel([at(0, 0), at(500, 0)], [], distanceMeters);
  const point = (m) => pointAtProgress(model, m, 0).coordinate;
  assert.equal(routeSliceBetween(model.coordinates, model.cumulativeMeters, 50, 40, point), null);
  assert.equal(routeSliceBetween(model.coordinates, model.cumulativeMeters, 0, 200, point), null);
});

test("frame by frame at 1 Hz fixes the marker moves in small steps, not one jump per fix", () => {
  // 29 km/h, one fix per second, 60 frames per second.
  let drawn = at(0, 0), heading = 90, maxFrameStep = 0, maxTeleportStep = 0, previousFixAt = null;
  for (let second = 1; second <= 10; second += 1) {
    const target = at(second * 8, 0), now = second * 1_000;
    const plan = planMarkerMotion({ from: drawn, fromHeading: heading, to: target, toHeading: 90, now, intervalMs: previousFixAt === null ? 1_000 : now - previousFixAt });
    previousFixAt = now;
    for (let frame = 1; frame <= 60; frame += 1) {
      const next = motionAt(plan, now + frame * (1_000 / 60)).position;
      maxFrameStep = Math.max(maxFrameStep, motionDistance(drawn, next));
      drawn = next;
    }
    maxTeleportStep = Math.max(maxTeleportStep, 8);
  }
  assert.ok(maxFrameStep < 0.25, `largest frame step ${maxFrameStep.toFixed(3)} m (teleporting: ${maxTeleportStep} m)`);
});
