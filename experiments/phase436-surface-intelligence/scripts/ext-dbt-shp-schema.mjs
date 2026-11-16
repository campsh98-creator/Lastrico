/**
 * Real schema and value distribution of the DBT 2020 shapefile DBFs fetched by ext-zip-extract.mjs (road, carriageway, tram, rail, cycle,
 * administrative-street layers). For every field: type/length, non-empty rate, distinct count and, for low-cardinality fields, the top values.
 * Also prints the .prj text. Output: evidence/external-data-audit/dbt-shp-schemas.json (compact) and a console table.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readDbf } from "./lib/dbf.mjs";
import { ROOT, EVID } from "./ext-http.mjs";

const dir = join(ROOT, "experiments/phase436-surface-intelligence/data/external/dbt2020");
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : /./;
const files = (await readdir(dir)).filter((f) => /\.dbf$/i.test(f) && only.test(f)).sort();
const out = {};
const SENTINEL = new Set(["", "-99993", "-99992", "-99999", "<Null>", "NULL", "null"]);
for (const f of files) {
  const d = readDbf(join(dir, f));
  const cols = d.fields.map(() => new Map());
  let n = 0;
  for (const r of d.records()) { n += 1; r.forEach((v, i) => cols[i].set(v, (cols[i].get(v) ?? 0) + 1)); }
  const info = { records: n, ldid: d.ldid, fields: {} };
  d.fields.forEach((fl, i) => {
    const m = cols[i]; let filled = 0; for (const [v, c] of m) if (!SENTINEL.has(v)) filled += c;
    const entry = { type: fl.type + (fl.length ? `(${fl.length})` : ""), nonEmpty: filled, nonEmptyPct: +(100 * filled / n).toFixed(1), distinct: m.size };
    if (m.size <= 40) entry.values = Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    info.fields[fl.name] = entry;
  });
  out[f] = info;
  console.log(`\n== ${f}: ${n} records, ${d.fields.length} fields`);
  for (const [k, e] of Object.entries(info.fields)) console.log(`   ${k.padEnd(14)} ${e.type.padEnd(9)} filled ${String(e.nonEmptyPct).padStart(5)}%  distinct ${String(e.distinct).padStart(6)}${e.values ? "  " + JSON.stringify(e.values).slice(0, 220) : ""}`);
}
const prj = await readFile(join(dir, "EL_STR.prj"), "utf8").catch(() => "");
console.log("\nEL_STR.prj:", prj.slice(0, 430));
await writeFile(join(EVID, "dbt-shp-schemas.json"), JSON.stringify({ source: "DBT_2020.zip entries (HTTP Range), see dbt2020-zip-listing.json", prj, files: out }, null, 1));
