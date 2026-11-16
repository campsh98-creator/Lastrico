/**
 * Phase 4.36 / SIL prototype - validates the fixture against sil.schema.json, resolves "current best" views per
 * (segment, topic, attribute, mode, policy variant) and writes the views with their explanations.
 * Deterministic: asOf is an input, the output is key-sorted, running it twice gives identical bytes.
 *
 *   node si-resolve.mjs  -> resolved-views.P-A.car.json, resolved-views.txt, variant-comparison.json
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, ASOF, RESOLVER_VERSION, readJson, stable, sha256, validate, resolveAll } from "./si-lib.mjs";
import { readFileSync } from "node:fs";

const schema = readJson(join(OUT, "sil.schema.json"));
const policy = readJson(join(OUT, "policy.v0.json"));
const ledgerBytes = readFileSync(join(OUT, "fixture.sil.json"));
const ledger = JSON.parse(ledgerBytes);
const lerr = validate(schema.$defs.ledger, ledger, schema);
if (lerr.length) { console.error("ledger invalid:\n" + lerr.slice(0, 10).join("\n")); process.exit(1); }
const ledgerSha256 = sha256(ledgerBytes);

// P-A+bikeWide: the same default rule, but the non-standard surface_bike key is read as applying to every mode (Agent 4's layer "La" makes that assumption)
const wideLedger = JSON.parse(JSON.stringify(ledger));
for (const e of wideLedger.evidence) if (e.id.startsWith("ev-osm-surfacebike-")) e.modes = ["car", "motorcycle", "bicycle"];
const run = (variant, mode) => ({ schemaVersion: "0.1.0", resolverVersion: RESOLVER_VERSION, policyVersion: policy.policyVersion, policyVariant: variant, asOf: ASOF, ledgerSha256, views: resolveAll({ ledger, policy, variant, mode }) });
const out = {};
for (const variant of ["P-A", "P-B"]) for (const mode of ["car", "bicycle"]) {
  out[`${variant}.${mode}`] = run(variant, mode);
  const e = validate(schema.$defs.resolvedViews, out[`${variant}.${mode}`], schema);
  if (e.length) { console.error(`views ${variant}.${mode} invalid:\n` + e.slice(0, 10).join("\n")); process.exit(1); }
}
out["P-A+bikeWide.car"] = { ...run("P-A", "car"), policyVariant: "P-A+bikeWide", views: resolveAll({ ledger: wideLedger, policy, variant: "P-A", mode: "car" }) };
writeFileSync(join(OUT, "resolved-views.P-A.car.json"), stable(out["P-A.car"], 1));

// ---- worked cases: compact comparison table + readable explanations ----
const pick = (key, wayId, topic, attr) => out[key].views.find((v) => v.ref.wayId === wayId && v.topic === topic)?.attributes[attr];
const cell = (a) => (a ? `${a.state}${a.value ? ` ${a.value}` : ""}${a.weakDissent ? " +weakDissent" : ""} [${a.confidence.band}/${a.freshness.state}]` : "-");
const cases = [
  ["ring #1 sett (25.0 m)", 287070936, "surface_material", "material"], ["ring #2 asphalt+surface_bike (31.0 m)", 111768010, "surface_material", "material"],
  ["ring #3 asphalt (13.1 m)", 111767966, "surface_material", "material"], ["ring ahead-of-photo way (8.2 m)", 713165251, "surface_material", "material"],
  ["ring 287070935 (16.3 m)", 287070935, "surface_material", "material"], ["Corso Lodi sett two-way 305989915", 305989915, "surface_material", "material"],
  ["Papi sett 164940303", 164940303, "surface_material", "material"], ["Fra Cristoforo 273258717 (untagged)", 273258717, "surface_material", "material"],
  ["Fra Cristoforo neighbour 273258720", 273258720, "surface_material", "material"],
  ["ring #2 roughness (smoothness=excellent)", 111768010, "physical_roughness", "level"], ["ring #1 roughness (smoothness=bad)", 287070936, "physical_roughness", "level"],
  ["Corso Lodi 305989915 rails presence", 305989915, "rails_presence", "presence"], ["Corso Lodi 305989915 rails service", 305989915, "rails_presence", "service"],
  ["Corso Lodi 305989915 rails sharing", 305989915, "rails_presence", "sharing"], ["Corso Lodi 305989915 rails embedding", 305989915, "rails_presence", "embedding"],
  ["Papi 164940303 rails presence", 164940303, "rails_presence", "presence"], ["ring #1 rails presence", 287070936, "rails_presence", "presence"],
  ["ring 713165261 direction", 713165261, "direction", "oneway"],
];
const comparison = cases.map(([label, w, t, a]) => ({ case: label, wayId: w, topic: t, attribute: a, "P-A car": cell(pick("P-A.car", w, t, a)), "P-B car": cell(pick("P-B.car", w, t, a)), "P-A bicycle": cell(pick("P-A.bicycle", w, t, a)), "P-B bicycle": cell(pick("P-B.bicycle", w, t, a)), "P-A+bikeWide car": cell(pick("P-A+bikeWide.car", w, t, a)) }));
// metre-level consequence for the ring traversal of the return-trip route 0 (Agent 2: 25.0 + 31.0 + 13.1 = 69.1 m)
const traversal = [[287070936, 25.0], [111768010, 31.0], [111767966, 13.1]];
const lens = {};
for (const variant of ["P-A", "P-B", "P-A+bikeWide"]) {
  let confirmed = 0, probable = 0, flagged = 0;
  for (const [w, m] of traversal) { const a = pick(`${variant}.car`, w, "surface_material", "material"); if (a.state === "known" && ["sett", "cobblestone"].includes(a.value)) confirmed += m; else if (a.state === "contested") probable += m; else if (a.weakDissent) flagged += m; }
  lens[variant] = { confirmedStoneM: confirmed, probableStoneM_afterAdapter: probable, weakDissentFlaggedM: flagged, weightedStoneM: Math.round((confirmed + probable * policy.adapter.contestedStoneVsSmooth.roughnessWeight) * 10) / 10 };
}
writeFileSync(join(OUT, "variant-comparison.json"), stable({ asOf: ASOF, policyVersion: policy.policyVersion, resolverVersion: RESOLVER_VERSION, ledgerSha256, note: "design feasibility on the real field cases, not product validation", comparison, ringTraversal69m: { baseline_today_confirmedStoneM: 25.0, ...lens } }, 1));

const lines = [`# SIL resolved views (policy ${policy.policyVersion}, resolver ${RESOLVER_VERSION}, asOf ${ASOF}, ledger sha256 ${ledgerSha256.slice(0, 16)})`, "# design feasibility on real field cases; not product validation", ""];
const show = [[287070936, "surface_material", "material"], [111768010, "surface_material", "material"], [111767966, "surface_material", "material"], [713165251, "surface_material", "material"], [305989915, "rails_presence", "presence"], [305989915, "rails_presence", "service"], [164940303, "rails_presence", "presence"], [273258717, "surface_material", "material"], [713165261, "direction", "oneway"], [287070936, "rails_presence", "presence"]];
for (const key of ["P-A.car", "P-B.car", "P-A.bicycle"]) { lines.push(`## ${key}`); for (const [w, t, a] of show) { const v = pick(key, w, t, a); if (v) lines.push(`- ${v.explanation}${v.reviewTasks ? `  => review: ${v.reviewTasks.map((r) => `${r.priority} ${r.reason}`).join(", ")}` : ""}`); } lines.push(""); }
writeFileSync(join(OUT, "resolved-views.txt"), lines.join("\n"));
console.log(JSON.stringify({ views: out["P-A.car"].views.length, ledgerSha256: ledgerSha256.slice(0, 16), ringTraversal: lens }, null, 1));
for (const c of comparison) console.log(`${c.case.padEnd(42)} | A-car ${c["P-A car"].padEnd(44)} | B-car ${c["P-B car"].padEnd(44)} | A-bike ${c["P-A bicycle"]}`);
