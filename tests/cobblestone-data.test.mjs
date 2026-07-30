import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const datasetUrl = new URL("../data/milan-pave-central.json", import.meta.url);
const allowedSurfaces = new Set([
  "sett",
  "cobblestone",
  "unhewn_cobblestone",
  "paving_stones",
]);

test("the bundled surface snapshot satisfies geometry and identity invariants", async () => {
  const features = JSON.parse(await readFile(datasetUrl, "utf8"));
  const ids = new Set();
  for (const feature of features) {
    assert.equal(Number.isFinite(feature.id), true);
    assert.equal(ids.has(feature.id), false, `duplicate OSM way ${feature.id}`);
    ids.add(feature.id);
    assert.equal(allowedSurfaces.has(feature.surface), true);
    assert.ok(feature.coordinates.length >= 2, `way ${feature.id} has no segment`);
    for (const coordinate of feature.coordinates) {
      assert.equal(coordinate.length, 2);
      assert.equal(Number.isFinite(coordinate[0]), true);
      assert.equal(Number.isFinite(coordinate[1]), true);
      assert.ok(coordinate[0] >= 9.04 && coordinate[0] <= 9.31);
      assert.ok(coordinate[1] >= 45.38 && coordinate[1] <= 45.55);
    }
  }
  assert.equal(ids.size, 1530);
});

