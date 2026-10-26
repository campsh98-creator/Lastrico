import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import segments from "../data/surfaces/milan-central.json" with { type: "json" };
import { generateQualityReport } from "../scripts/osm/quality-report.mjs";

test("quality report measures dataset composition without modifying the tracked report", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-quality-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tracked = new URL("../outputs/road-intelligence-quality-report.md", import.meta.url);
  const before = await readFile(tracked, "utf8");
  const outputPath = join(dir, "quality.md");
  const result = await generateQualityReport({ outputPath });
  const total = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
  const known = segments.filter((segment) => segment.surfaceCategory !== "unknown")
    .reduce((sum, segment) => sum + segment.lengthMeters, 0);
  assert.equal(result.totalLengthKm, (total / 1000).toFixed(2));
  assert.equal(result.surfaceCertaintyPercent, (known / total * 100).toFixed(2));
  assert.equal(result.reportOutputPath, outputPath);
  assert.match(await readFile(outputPath, "utf8"), /Known Surface Classification/);
  assert.equal(await readFile(tracked, "utf8"), before);
});
