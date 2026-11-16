/** Writes every in-memory patch of exp-patches.mjs as a diff against app/api/routes/route.ts (the repository file is never modified). */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, OUT, CAPTURE_PATCH, applyPatches, renderDiff, sha256 } from "./exp-harness.mjs";
import { VARIANTS } from "./exp-patches.mjs";
const src = await readFile(new URL("app/api/routes/route.ts", ROOT), "utf8");
const seen = new Map();
for (const p of [CAPTURE_PATCH, ...Object.values(VARIANTS).flatMap((v) => v.patches)]) if (!seen.has(p.id)) seen.set(p.id, p);
const { diffs } = applyPatches(src, [...seen.values()].filter((p) => !["S20-seen", "S15-seen"].includes(p.id) || true).map((p) => p).slice(0, 0)); // anchors are checked one by one below
const all = [];
for (const p of seen.values()) all.push(...applyPatches(src, [p]).diffs);
const text = `# Variants: ${Object.entries(VARIANTS).map(([k, v]) => `${k}=${v.label}`).join("; ")}\n# Patches are applied in memory by exp-harness.mjs (loadPatchedHandler); each anchor matches exactly once in app/api/routes/route.ts at 3e31da9.\n\n` + renderDiff(all);
await writeFile(new URL("patches.diff", OUT), text);
console.log(`${all.length} patches, sha256 ${sha256(text)}`); void diffs;
