import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_LAYER_ORDER, ROUTE_STYLE, routePaint } from "../lib/map-route-style.ts";

test("the active route is green, opaque and wider than alternatives", () => {
  assert.equal(ROUTE_STYLE.active.color, "#00a878");
  assert.equal(ROUTE_STYLE.active.opacity, 1);
  assert.ok(ROUTE_STYLE.active.width > ROUTE_STYLE.alternative.width);
  assert.ok(ROUTE_STYLE.active.outlineWidth > ROUTE_STYLE.active.width);
  assert.notEqual(ROUTE_STYLE.active.color, "#000000");
});

test("route paint is derived from one central token set", () => {
  assert.deepEqual(routePaint("active").line, {
    "line-color": ROUTE_STYLE.active.color,
    "line-width": ROUTE_STYLE.active.width,
    "line-opacity": ROUTE_STYLE.active.opacity,
  });
  assert.deepEqual(ROUTE_LAYER_ORDER, [
    "fast-outline",
    "fast-line",
    "safe-outline",
    "safe-line",
  ]);
});

