import assert from "node:assert/strict";

/**
 * Rebuilt surface datasets are byte-identical on the machine architecture that produced them.
 * On another architecture V8's Math.sin, Math.cos and Math.atan2 may differ in the last bits:
 * CI on x86-64 Linux gives a bearing of 118.7196148823358 where Apple Silicon gives
 * 118.71961488361677, and near-degenerate segments amplify that to about 2e-9 relative.
 * This compares two JSON texts structurally instead.
 * - Keys, order, strings and booleans must match exactly.
 * - Numbers must agree to `relative` (default 1e-6: 0.03 mm on a 30 m segment, 0.0001° of
 *   bearing). Any real data change is far larger.
 * - Keys matching `ignoreKeys` are skipped: checksums and byte counts necessarily differ once a
 *   digit does.
 * It returns how many numbers differed, so a caller can report it.
 */
export function assertJsonNearlyEqual(actualText, expectedText, { relative = 1e-6, ignoreKeys = null, label = "json" } = {}) {
  let differingNumbers = 0;
  const walk = (actual, expected, path) => {
    if (typeof expected === "number" && typeof actual === "number") {
      if (actual === expected) return;
      const scale = Math.max(Math.abs(actual), Math.abs(expected), 1e-12);
      assert.ok(Math.abs(actual - expected) <= scale * relative, `${label}${path}: ${actual} vs ${expected}`);
      differingNumbers += 1;
      return;
    }
    if (Array.isArray(expected)) {
      assert.ok(Array.isArray(actual), `${label}${path}: expected an array`);
      assert.equal(actual.length, expected.length, `${label}${path}: array length`);
      for (let index = 0; index < expected.length; index += 1) walk(actual[index], expected[index], `${path}[${index}]`);
      return;
    }
    if (expected && typeof expected === "object") {
      assert.ok(actual && typeof actual === "object" && !Array.isArray(actual), `${label}${path}: expected an object`);
      assert.deepEqual(Object.keys(actual), Object.keys(expected), `${label}${path}: keys`);
      for (const key of Object.keys(expected)) {
        if (ignoreKeys?.test(key)) continue;
        walk(actual[key], expected[key], `${path}.${key}`);
      }
      return;
    }
    assert.equal(actual, expected, `${label}${path}`);
  };
  walk(JSON.parse(actualText), JSON.parse(expectedText), "");
  return differingNumbers;
}
