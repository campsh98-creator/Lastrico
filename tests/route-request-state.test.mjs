import assert from "node:assert/strict";
import test from "node:test";
import {
  isNavigableRouteGeometry,
  routePreferencesMatch,
  shouldApplyPlannerRouteResponse,
} from "../lib/route-request-state.ts";

test("a response is stale as soon as planner intent changes", () => {
  assert.equal(shouldApplyPlannerRouteResponse({
    activeRequestId: 4,
    responseRequestId: 4,
    activeRevision: 9,
    responseRevision: 8,
  }), false);
});

test("only the current request for the current planner revision applies", () => {
  assert.equal(shouldApplyPlannerRouteResponse({
    activeRequestId: 4,
    responseRequestId: 4,
    activeRevision: 9,
    responseRevision: 9,
  }), true);
  assert.equal(shouldApplyPlannerRouteResponse({
    activeRequestId: 5,
    responseRequestId: 4,
    activeRevision: 9,
    responseRevision: 9,
  }), false);
});

test("route preferences must match the API acknowledgement", () => {
  const requested = { avoidance: "maximum", maxExtraMinutes: 8 };
  assert.equal(routePreferencesMatch(requested, {
    avoidance: "maximum",
    maximumExtraMinutes: 8,
  }), true);
  assert.equal(routePreferencesMatch(requested, {
    avoidance: "strong",
    maximumExtraMinutes: 8,
  }), false);
  assert.equal(routePreferencesMatch(requested, undefined), false);
});

test("navigation requires at least two finite geographic coordinates", () => {
  assert.equal(isNavigableRouteGeometry([[9.18, 45.46], [9.2, 45.48]]), true);
  assert.equal(isNavigableRouteGeometry([[9.18, 45.46]]), false);
  assert.equal(isNavigableRouteGeometry([[Number.NaN, 45.46], [9.2, 45.48]]), false);
  assert.equal(isNavigableRouteGeometry([[181, 45.46], [9.2, 45.48]]), false);
});
