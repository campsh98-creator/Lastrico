import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import { addFlowTile, createFlowIndex, routeTraffic, FLOW_LAYER, CLOSURE_PENALTY_SECONDS } from "../lib/traffic/flow.ts";
import { tilePointToCoordinate } from "../lib/traffic/tiles.ts";

/**
 * OPT-IN check of the flow decoder and matcher against REAL TomTom Traffic Flow tiles that a person saved by hand. The tiles are
 * provider data under the provider's terms: they are never committed, so this test is skipped unless both variables are set:
 *   LASTRICO_REAL_FLOW_TILES   one or more tile files, separated by ";"
 *   LASTRICO_REAL_FLOW_TILE_ZXY the tile they were taken from, "z/x/y" (all files must be the same tile)
 * It reads files and makes no network request. It prints nothing but counts.
 */
const files = (process.env.LASTRICO_REAL_FLOW_TILES ?? "").split(";").map((entry) => entry.trim()).filter(Boolean);
const zxy = /^(\d+)\/(\d+)\/(\d+)$/.exec(process.env.LASTRICO_REAL_FLOW_TILE_ZXY ?? "");
const skip = files.length === 0 || !zxy ? "set LASTRICO_REAL_FLOW_TILES and LASTRICO_REAL_FLOW_TILE_ZXY to run against saved real tiles" : false;
const tile = zxy ? { z: Number(zxy[1]), x: Number(zxy[2]), y: Number(zxy[3]) } : { z: 0, x: 0, y: 0 };
// Central Milan and its surroundings: a tile outside it is not the tile this test was written for.
const MILAN = { west: 9.0, east: 9.4, south: 45.35, north: 45.6 };
const lengthMeters = (line) => line.slice(1).reduce((sum, point, i) => {
  const a = line[i];
  return sum + Math.hypot((point[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (point[1] - a[1]) * 110_540);
}, 0);

for (const file of files.length ? files : ["(none)"]) {
  test(`real flow tile ${files.length ? files.indexOf(file) + 1 : 0}: layer, value types, geometry and direction-aware matching`, { skip }, () => {
    const bytes = new Uint8Array(readFileSync(file));
    const decoded = decodeMvt(bytes);
    const layer = decoded.layers[FLOW_LAYER];
    assert.ok(layer, `layer "${FLOW_LAYER}" present (found: ${Object.keys(decoded.layers).join(", ")})`);
    assert.equal(layer.extent, 4096);
    assert.ok(layer.features.length > 0);
    // Lines only, with the documented properties and value types.
    for (const feature of layer.features) {
      assert.equal(feature.type, 2, "a flow feature is a line");
      const { traffic_level: level, traffic_road_coverage: coverage, road_closure: closure } = feature.properties;
      assert.equal(typeof level, "number");
      assert.ok(level >= 0 && level <= 1, `traffic_level ${level} outside 0..1`);
      assert.ok(coverage === "full" || coverage === "one_side", `traffic_road_coverage ${coverage}`);
      if (closure !== undefined) assert.equal(typeof closure, "boolean");
    }
    // Geometry decodes to plausible Milan coordinates.
    const lines = layer.features.flatMap((feature) => feature.parts.map((part) => part.map(([px, py]) => tilePointToCoordinate(tile, px, py, layer.extent))));
    const inside = lines.flat().filter(([lon, lat]) => lon >= MILAN.west && lon <= MILAN.east && lat >= MILAN.south && lat <= MILAN.north).length;
    assert.ok(inside / lines.flat().length > 0.95, "the tile is where the test says it is");

    // The matcher is direction-aware. A route that follows each feature in the feature's own direction is covered by it; the same
    // route driven the other way is, for most features, not described (a one-way road, or the other carriageway not in the tile)
    // and keeps the provider's time; where the opposite carriageway is in the tile it gets that feature's own level.
    const index = createFlowIndex();
    addFlowTile(index, tile, bytes);
    assert.ok(index.segments > 0);
    let measured = 0;
    let forwardCovered = 0;
    let reverseUncovered = 0;
    for (const feature of layer.features) {
      const line = feature.parts[0].map(([px, py]) => tilePointToCoordinate(tile, px, py, layer.extent));
      if (line.length < 2 || lengthMeters(line) < 20) continue;
      measured += 1;
      if (routeTraffic(index, line, 60, "car").coveragePercent > 50) forwardCovered += 1;
      if (routeTraffic(index, [...line].reverse(), 60, "car").coveragePercent < 20) reverseUncovered += 1;
    }
    assert.ok(measured > 0);
    assert.equal(forwardCovered, measured, "every feature is matched by a route that runs the same way");
    assert.ok(reverseUncovered > 0, "driving against a feature is not read as that feature's traffic");
    // A flagged closure costs a car the fixed penalty and a bicycle nothing.
    const closed = layer.features.find((entry) => entry.properties.road_closure === true);
    if (closed) {
      const line = closed.parts[0].map(([px, py]) => tilePointToCoordinate(tile, px, py, layer.extent));
      const car = routeTraffic(index, line, 60, "car");
      assert.ok(car.closedMeters > 0 && car.delaySeconds >= CLOSURE_PENALTY_SECONDS, `closure: ${car.closedMeters} m, +${Math.round(car.delaySeconds)} s`);
      assert.equal(routeTraffic(index, line, 60, "bicycle").delaySeconds, 0);
    }
    console.log(`real tile checked: ${layer.features.length} features, ${index.segments} segments, ${layer.features.filter((entry) => entry.properties.road_closure === true).length} closed`);
  });
}
