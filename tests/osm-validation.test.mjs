import assert from "node:assert/strict";
import test from "node:test";
import { validateCoordinates } from "../scripts/osm/validate.mjs";

test("malformed vertices are rejected without crashing on their valid successor", () => {
  for (const invalid of [null, undefined, [], [9.19], [NaN, 45.46], [9.19, Infinity]]) {
    const result = validateCoordinates([invalid, [9.19, 45.46], [9.191, 45.46]]);
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.jumps, []);
  }
});

test("invalid vertices do not hide subsequent zero-length or long segments", () => {
  const result = validateCoordinates([null, [9.19, 45.46], [9.19, 45.46], [9.195, 45.46]]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Zero-length")));
  assert.equal(result.jumps.length, 1);
  assert.equal(result.jumps[0].fromIndex, 2);
});
