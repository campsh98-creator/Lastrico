/** Validation: accumulate(BASELINE) over the per-sample table equals the production numbers (candidateDiagnostics) for every pooled candidate. */
import { readFile, writeFile } from "node:fs/promises";
import { CACHE, OUT } from "./exp-harness.mjs";
import { sampleTable, accumulate } from "./exp-features.mjs";
const pools = JSON.parse(await readFile(new URL("pools-baseline.json", CACHE), "utf8"));
let n = 0, bad = 0; const worst = { pave: 0, confirmed: 0, probable: 0, risk: 0, unknown: 0, smooth: 0 }; const examples = [];
const t0 = Date.now();
for (const c of pools.cases) {
  if (!c.pool) continue;
  for (let k = 0; k < c.pool.length; k += 1) {
    const cand = c.pool[k];
    const { production, samples } = await sampleTable(cand.coordinates, c.mode, pools.departure);
    const a = accumulate(samples);
    const d = cand.diag; n += 1;
    const diff = { pave: Math.abs(a.pave - d.pave), confirmed: Math.abs(a.confirmed - d.confirmed), probable: Math.abs(a.probable - d.probable), risk: Math.abs(a.risk - d.risk), unknown: Math.abs(a.unknown - d.unknown), smooth: Math.abs(a.smooth - d.smooth) };
    let any = false;
    for (const key of Object.keys(diff)) { worst[key] = Math.max(worst[key], diff[key]); if (diff[key] > 0) any = true; }
    // also against the scorer called directly
    if (production.paveMeters !== a.pave || production.unknownMeters !== a.unknown) any = true;
    if (any) { bad += 1; if (examples.length < 8) examples.push({ id: c.id, k, mine: a, diag: d, direct: { pave: production.paveMeters, unknown: production.unknownMeters } }); }
  }
}
const out = { candidates: n, mismatching: bad, maxAbsDifferenceMeters: worst, seconds: Math.round((Date.now() - t0) / 1000), examples };
await writeFile(new URL("feature-validation.json", OUT), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
