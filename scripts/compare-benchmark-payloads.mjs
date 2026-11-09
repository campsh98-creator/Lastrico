/**
 * Phase 4.30 — proves an optimisation changed nothing a user or the selection logic can see:
 * compares every recorded case payload of two benchmark labels (route geometry, surface metrics,
 * rough sections, candidate diagnostics, notices), ignoring only timing fields.
 *
 *   node scripts/compare-benchmark-payloads.mjs <labelA> <labelB>
 */
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [a, b] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
// Phase 4.31: fields added on purpose (e.g. --ignore=name,surface,roadFeatures) can be set aside.
const ignored = new Set((process.argv.find((arg) => arg.startsWith("--ignore="))?.slice(9) ?? "").split(",").filter(Boolean));
const base = new URL("../outputs/phase425-benchmark/", import.meta.url);
const TIMING = new Set(["performance", "calculatedAt", "generatedAt", "elapsedMs", "totalMs", ...ignored]);
const strip = (value) => {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !TIMING.has(key)).map(([key, v]) => [key, strip(v)]));
  }
  return value;
};
const read = (label, file) => strip(JSON.parse(gunzipSync(readFileSync(new URL(`${label}/cases/${file}`, base)))));
const files = readdirSync(new URL(`${a}/cases/`, base)).filter((name) => name.endsWith(".json.gz")).sort();
let identical = 0;
const different = [];
for (const file of files) {
  const left = JSON.stringify(read(a, file));
  let right;
  try { right = JSON.stringify(read(b, file)); } catch { different.push(`${file} (missing in ${b})`); continue; }
  if (left === right) identical += 1;
  else different.push(file);
}
console.log(JSON.stringify({ compared: files.length, identical, different }, null, 2));
process.exitCode = different.length ? 1 : 0;
