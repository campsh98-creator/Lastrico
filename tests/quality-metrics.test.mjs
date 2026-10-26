import assert from "node:assert/strict";
import test from "node:test";
import { generateQualityReport } from "../scripts/osm/quality-report.mjs";

test("quality report generates valid metrics without crashing", async () => {
  const result = await generateQualityReport();
  assert.ok(parseFloat(result.totalLengthKm) > 60);
  assert.ok(parseFloat(result.surfaceCertaintyPercent) > 90);
  assert.ok(result.reportOutputPath.endsWith("road-intelligence-quality-report.md"));
});
