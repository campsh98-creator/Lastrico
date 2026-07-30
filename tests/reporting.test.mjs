import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_KINDS,
  reportKindMeta,
  reportStatusLabel,
} from "../lib/reporting.ts";

test("every report kind has user-facing metadata", () => {
  assert.equal(REPORT_KINDS.length, 4);
  for (const kind of REPORT_KINDS) {
    assert.ok(reportKindMeta[kind].icon);
    assert.ok(reportKindMeta[kind].label);
    assert.ok(reportKindMeta[kind].description);
  }
});

test("report status labels distinguish review from verification", () => {
  assert.equal(reportStatusLabel("pending"), "In revisione");
  assert.equal(reportStatusLabel("verified"), "Verificata");
});
