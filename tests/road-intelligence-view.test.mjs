import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { configureSilShadow } from "../lib/sil-shadow.ts";

const { GET } = await loadApi("app/api/road-intelligence/route.ts");
const call = (bbox) => GET(new NextRequest(`http://localhost/api/road-intelligence?bbox=${bbox}`));
configureSilShadow({ mode: "off", provider: null });

test("the map view returns the OSM surface of a Milan box and reports the local layers as unavailable", async () => {
  const response = await call("9.198,45.446,9.214,45.456");
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.ok(view.features.length > 200);
  assert.equal(view.layers.rails, "unavailable", "no layer set in a deployment");
  assert.equal(view.totals.railsMappedMetres, null);
  assert.equal(view.totals.conflictSegments, null);
  const classes = new Set(view.features.map((f) => f.properties.surface));
  assert.ok(classes.has("asphalt") && classes.has("cobblestone") && classes.has("unknown"), [...classes].join());
  for (const f of view.features) {
    assert.equal(f.properties.rails, null, "no rail claim without layers");
    if (f.properties.surface === "asphalt") assert.equal(f.properties.tag, "asphalt");
    if (f.properties.tag === "unknown") assert.equal(f.properties.surface, "unknown", "an unknown surface is never shown as asphalt");
  }
});

test("the view refuses a box that is too large or malformed, and is empty outside the coverage", async () => {
  assert.equal((await call("9.0,45.3,9.5,45.6")).status, 400);
  assert.equal((await call("a,b,c,d")).status, 400);
  assert.equal((await call("9.2,45.45,9.1,45.46")).status, 400);
  const outside = await (await call("8.72,45.62,8.74,45.64")).json();
  assert.equal(outside.features.length, 0, "Malpensa has no enriched data: nothing is drawn, nothing is invented");
});
