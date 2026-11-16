/** SHA-256 of the key routing-experiment outputs, so a rerun can be compared: node exp-hashes.mjs  ->  evidence/routing-experiments/key-hashes.json */
import { readFile, writeFile } from "node:fs/promises";
import { OUT, sha256 } from "./exp-harness.mjs";
const files = ["baseline-reproduction.json", "feature-validation.json", "split.json", "scoring-summary.json", "scoring-cases.csv", "decision-flips.json", "sensitivity.json", "pareto-summary.json", "stability.json", "calibration.json", "uturn-analysis.json", "generation-triggers.json",
  "union-summary.json", "union-cases.csv", "via-analysis.json", "replicas.json", "return-plan-crosscheck.json", "variants-results.json", "earlystop-sample.json", "patches.diff", "base-rates.json"];
const out = {};
for (const f of files) { try { out[f] = sha256((await readFile(new URL(f, OUT), "utf8")).replace(/\r\n/g, "\n")); } catch { out[f] = null; } }
await writeFile(new URL("key-hashes.json", OUT), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
