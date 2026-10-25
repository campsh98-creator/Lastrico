import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_EXTRA_MINUTES_LIMIT,
  parseExtraMinutes,
  routeFitsExtraMinutes,
} from "../lib/route-time-budget.ts";

test("parses a bounded optional extra-time budget", () => {
  assert.equal(parseExtraMinutes(null), null);
  assert.equal(parseExtraMinutes(""), null);
  assert.equal(parseExtraMinutes("8"), 8);
  assert.equal(parseExtraMinutes("2.5"), 2.5);
  assert.equal(parseExtraMinutes("-1"), undefined);
  assert.equal(parseExtraMinutes(String(MAX_EXTRA_MINUTES_LIMIT + 1)), undefined);
  assert.equal(parseExtraMinutes("eight"), undefined);
});

test("enforces the budget relative to the fastest route", () => {
  assert.equal(routeFitsExtraMinutes(900, 600, null), true);
  assert.equal(routeFitsExtraMinutes(1_080, 600, 8), true);
  assert.equal(routeFitsExtraMinutes(1_081, 600, 8), false);
  assert.equal(routeFitsExtraMinutes(600, 600, 0), true);
});

test("invalid metrics or constraints never qualify as a route within budget", () => {
  for (const invalid of [NaN, Infinity, -1]) {
    assert.equal(routeFitsExtraMinutes(invalid, 600, null), false);
    assert.equal(routeFitsExtraMinutes(600, invalid, 8), false);
    assert.equal(routeFitsExtraMinutes(600, 600, invalid), false);
  }
  assert.equal(routeFitsExtraMinutes(600, 600, MAX_EXTRA_MINUTES_LIMIT + 1), false);
  assert.equal(routeFitsExtraMinutes(630, 600, 0.5), true);
  assert.equal(routeFitsExtraMinutes(630.001, 600, 0.5), false);
});
