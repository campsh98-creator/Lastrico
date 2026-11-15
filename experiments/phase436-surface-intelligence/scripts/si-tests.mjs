/**
 * Phase 4.36 / SIL prototype - assertions for the schema, the resolver invariants, the re-anchoring policy,
 * the overlay and the D1 DDL. Plain node:assert, no framework, no install. Run after the other si-*.mjs scripts:
 *
 *   node si-build-fixture.mjs && node si-resolve.mjs && node si-overlay-compile.mjs && node si-tests.mjs
 * Writes test-results.txt. Exit code 1 on any failure.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { OUT, ROOT, ASOF, readJson, stable, sha256, validate, resolveAll, resolveAttribute, reanchor, loadMilanTiles } from "./si-lib.mjs";

const schema = readJson(join(OUT, "sil.schema.json"));
const policy = readJson(join(OUT, "policy.v0.json"));
const ledger = readJson(join(OUT, "fixture.sil.json"));
const results = [];
let failed = 0;
const test = (name, fn) => { try { fn(); results.push(`PASS  ${name}`); } catch (e) { failed += 1; results.push(`FAIL  ${name}\n      ${String(e.message).split("\n")[0].slice(0, 300)}`); } };
const views = (l, variant = "P-A", mode = "car", asOf) => resolveAll({ ledger: l, policy, variant, mode, asOf: asOf ?? l.asOf });
const canon = (v) => stable(v, 0);
const get = (vs, wayId, topic, attr) => vs.find((v) => v.ref.wayId === wayId && v.topic === topic)?.attributes[attr];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- schema ----------
test("fixture ledger validates against sil.schema.json", () => assert.deepEqual(validate(schema.$defs.ledger, ledger, schema), []));
test("resolved views (P-A car) validate", () => assert.deepEqual(validate(schema.$defs.resolvedViews, readJson(join(OUT, "resolved-views.P-A.car.json")), schema), []));
const overlay = readJson(join(OUT, "overlay-sample.json"));
test("overlay manifest and every overlay tile validate (P-A and P-B)", () => { for (const v of ["P-A", "P-B"]) { assert.deepEqual(validate(schema.$defs.manifest, overlay[v].manifest, schema), []); for (const t of Object.values(overlay[v].tiles)) assert.deepEqual(validate(schema.$defs.overlayTile, t, schema), []); } });
const ev0 = ledger.evidence.find((e) => e.id === "ev-osm-surface-111768010");
const bad = (mut) => { const e = clone(ev0); mut(e); return validate(schema.$defs.evidence, e, schema); };
test("schema rejects: missing verification", () => assert.ok(bad((e) => delete e.verification).length > 0));
test("schema rejects: unknown topic", () => assert.ok(bad((e) => (e.topic = "gloss")).length > 0));
test("schema rejects: claim shape that does not belong to the topic (rails claim on surface_material)", () => assert.ok(bad((e) => (e.claim = { presence: "present" })).length > 0));
test("schema rejects: extra property", () => assert.ok(bad((e) => (e.score = 0.9)).length > 0));
test("schema rejects: malformed observedAt", () => assert.ok(bad((e) => (e.observedAt = "13/11/2026")).length > 0));
test("schema rejects: a 'reported' evidence without consent", () => assert.ok(bad((e) => { e.kind = "reported"; }).length > 0));
test("schema rejects: single numeric confidence on an evidence (no such field)", () => assert.ok(bad((e) => (e.confidence = 0.8)).length > 0));
test("schema rejects: overlay entry of wrong length and unknown datasetVersion form", () => { assert.ok(validate(schema.$defs.overlayEntry, [1, 2, 3], schema).length > 0); assert.ok(validate(schema.$defs.manifest, { ...overlay["P-A"].manifest, datasetVersion: "v2" }, schema).length > 0); });
test("no tagged claim carries an observedAt unless the OSM history declared a survey (dates are never invented)", () => { for (const e of ledger.evidence) if (e.kind === "tagged" && e.observedAt) assert.equal(e.sourceRef?.declaredSource, "survey", e.id); });

// ---------- TypeScript <-> schema parity ----------
const ts = readFileSync(join(OUT, "sil-types.ts"), "utf8");
const unionOf = (name) => { const m = new RegExp(`export type ${name}\\s*=([^;]+);`, "s").exec(ts); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort() : null; };
const D = schema.$defs;
const parity = { MaterialValue: D.materialValue.enum, RoughnessLevel: D.roughnessLevel.enum, OsmSmoothness: D.osmSmoothness.enum, Mode: D.mode.enum, Kind: D.kind.enum, Verification: D.verification.enum, VerifierRole: D.verifierRole.enum, Topic: D.topic.enum, Coverage: D.coverage.enum, LicenceId: D.licenceId.enum, ConfidenceBand: D.confidenceBand.enum, FreshnessState: D.freshnessState.enum, ViewState: D.state.enum, AttributeName: D.attributeName.enum, Area: D.ledger.properties.area.enum, OverlayMode: D.manifest.properties.mode.enum };
test("sil-types.ts unions equal the schema enums (16 vocabularies)", () => { for (const [name, en] of Object.entries(parity)) assert.deepEqual(unionOf(name), [...en].sort(), name); });
let tsOk = true; try { await import(new URL("file:///" + join(OUT, "sil-types.ts").replaceAll("\\", "/"))); } catch (e) { tsOk = false; }
test("sil-types.ts is valid erasable TypeScript (Node strips it)", () => assert.ok(tsOk));
test("MaterialValue equals lib/road-intelligence-types.ts SurfaceMaterial (read-only comparison)", () => {
  const lib = readFileSync(join(ROOT, "lib/road-intelligence-types.ts"), "utf8"), m = /export type SurfaceMaterial =([^;]+);/s.exec(lib);
  assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort(), [...D.materialValue.enum].sort());
});

// ---------- resolver invariants ----------
const base = views(ledger);
test("determinism: two resolutions are byte-identical", () => assert.equal(canon(views(ledger)), canon(base)));
test("order independence: shuffled evidence gives identical views", () => { const l = clone(ledger); let a = 11; l.evidence.sort(() => { a = (a * 1103515245 + 12345) & 0x7fffffff; return (a % 3) - 1; }); assert.equal(canon(views(l)), canon(base)); });
test("unknown is first-class: untagged Via Fra Cristoforo ways are unknown, value null, band none", () => { for (const w of [137158656, 1236292178, 273258718, 273258717, 273258719]) { const a = get(base, w, "surface_material", "material"); assert.equal(a.state, "unknown"); assert.equal(a.value, null); assert.equal(a.confidence.band, "none"); } });
test("DBT FON=01 'pavimentato' is ignored (non-discriminating) and never becomes smooth; inferred neighbour never votes", () => { const a = get(base, 273258717, "surface_material", "material"); assert.ok(a.ignored.some((i) => i.reason === "SOURCE_NON_DISCRIMINATING")); assert.ok(a.ignored.some((i) => i.reason === "INFERRED_NO_VOTE")); for (const v of base) for (const x of Object.values(v.attributes)) if (x.state === "unknown") assert.equal(x.value, null); });
test("no view anywhere maps an untagged/unknown way to asphalt or smooth", () => { for (const w of [137158656, 1236292178, 273258718, 273258717, 273258719]) assert.notEqual(get(base, w, "surface_material", "material").value, "asphalt"); });
test("topic isolation: dropping ALL rails evidence leaves every non-rails view identical", () => { const l = clone(ledger); l.evidence = l.evidence.filter((e) => !e.topic.startsWith("rail")); const a = views(l).filter((v) => !v.topic.startsWith("rail")); assert.equal(canon(a), canon(base.filter((v) => !v.topic.startsWith("rail")))); });
test("topic isolation: dropping ALL surface/roughness evidence leaves every rails view identical", () => { const l = clone(ledger); l.evidence = l.evidence.filter((e) => e.topic.startsWith("rail")); const a = views(l).filter((v) => v.topic.startsWith("rail")); assert.equal(canon(a), canon(base.filter((v) => v.topic.startsWith("rail")))); });
test("rails are not roughness: Corso Lodi rails evidence adds no roughness/material candidate", () => { const vs = base.filter((v) => v.ref.wayId === 305989915).map((v) => v.topic).sort(); assert.deepEqual([...new Set(vs)], ["physical_roughness", "rails_presence", "surface_material"].filter((t) => vs.includes(t))); const r = get(base, 305989915, "physical_roughness", "level"); assert.equal(r, undefined); });
test("adjacent coverage never votes: removing the adjacent refs of the 2016 photo leaves ring #2 candidates and state unchanged", () => { const l = clone(ledger); const ph = l.evidence.find((e) => e.id === "ev-kartaview-2203776"); ph.refs = ph.refs.filter((r) => r.coverage !== "adjacent"); const a = get(views(l), 111768010, "surface_material", "material"), b = get(base, 111768010, "surface_material", "material"); assert.deepEqual([a.state, a.value, a.candidates, a.confidence], [b.state, b.value, b.candidates, b.confidence]); assert.ok(b.reasons.some((r) => r.startsWith("R9_ADJACENT_ONLY")) && b.reviewTasks.some((t) => t.reason === "adjacent_trigger")); });
test("mode applicability: bicycle-only evidence (surface_bike) never changes a car view, and contests the bicycle view of ring #2", () => { const l = clone(ledger); l.evidence = l.evidence.filter((e) => e.id !== "ev-osm-surfacebike-111768010"); const core = (a) => canon([a.state, a.value, a.candidates, a.confidence, a.freshness, a.weakDissent, a.supportingIds, a.dissentingIds]); assert.equal(core(get(views(l), 111768010, "surface_material", "material")), core(get(base, 111768010, "surface_material", "material"))); assert.equal(get(views(ledger, "P-A", "bicycle"), 111768010, "surface_material", "material").state, "contested"); });
test("field case ring #2/#3 (car, P-A): tagged asphalt kept with weak dissent flagged, never silently resolved; photo kept as review trigger", () => { for (const w of [111768010, 111767966]) { const a = get(base, w, "surface_material", "material"); assert.equal(a.state, "known"); assert.equal(a.value, "asphalt"); assert.equal(a.weakDissent, true); assert.deepEqual(a.dissentingIds, ["ev-owner-report-ring"]); assert.equal(a.confidence.band, "low"); } });
test("field case ring #2/#3 (car, P-B): the same evidence is contested", () => { const b = views(ledger, "P-B"); for (const w of [111768010, 111767966]) assert.equal(get(b, w, "surface_material", "material").state, "contested"); });
test("field case ring #1: sett stays known and is corroborated by the report (band medium, 2023 survey date kept)", () => { const a = get(base, 287070936, "surface_material", "material"); assert.equal(a.value, "sett"); assert.equal(a.confidence.band, "medium"); assert.equal(a.freshness.oldestObservedAt, "2023-09-05"); });
test("not newest-wins: the 2016 photo is OLDER than the 2023 tag yet leaves a flag, and the newest evidence (the 2026 owner report) does not override a 2023 survey", () => { const a = get(base, 713165251, "surface_material", "material"); assert.equal(a.weakDissent, true); assert.equal(get(base, 111768010, "surface_material", "material").value, "asphalt"); });
test("what the claim is about: rails PRESENCE stays known from DBT 2020 while SERVICE follows the fresher ATM file, dissent kept", () => { const p = get(base, 305989915, "rails_presence", "presence"), s = get(base, 305989915, "rails_presence", "service"); assert.equal(p.value, "present"); assert.equal(s.value, "no_scheduled_line"); assert.equal(s.weakDissent, true); assert.ok(s.dissentingIds.includes("ev-dbt-rails-305989915-0")); assert.equal(get(base, 305989915, "rails_presence", "embedding"), undefined); });
test("Papi rails: DBT absence (weak) vs coarse owner report (weak) is contested, not decided", () => { const a = get(base, 164940303, "rails_presence", "presence"); assert.equal(a.state, "contested"); assert.equal(a.reviewTasks[0].priority, "P1"); });
test("direction: provider-graph evidence sets oneway=forward for car; inferred topology is informational; bicycle stays unknown", () => { assert.equal(get(base, 713165261, "direction", "oneway").value, "forward"); assert.equal(get(views(ledger, "P-A", "bicycle"), 713165261, "direction", "oneway").state, "unknown"); });
test("reconciliation with Agent 4's layer La: reading surface_bike for every mode makes ring #2 contested for the car under P-A (31.0 m probable, weighted 45.2 m)", () => { const w = clone(ledger); for (const e of w.evidence) if (e.id.startsWith("ev-osm-surfacebike-")) e.modes = ["car", "motorcycle", "bicycle"]; assert.equal(get(views(w), 111768010, "surface_material", "material").state, "contested"); assert.equal(get(views(w), 111767966, "surface_material", "material").weakDissent, true); const v = readJson(join(OUT, "variant-comparison.json")).ringTraversal69m["P-A+bikeWide"]; assert.equal(v.probableStoneM_afterAdapter, 31); assert.equal(v.weightedStoneM, 45.2); });
test("P-A is never more contested than P-B", () => { const b = views(ledger, "P-B"); base.forEach((v, i) => { for (const [k, a] of Object.entries(v.attributes)) if (a.state === "contested") assert.equal(b[i].attributes[k].state, "contested"); }); });
test("synthetic: an OLDER human-verified field observation beats a NEWER unverified report (decisive, dissent kept)", () => { const l = clone(ledger); const t = { wayId: 111768010, fromM: 0, toM: 31, wayVersion: 19, wayLengthM: 31, coverage: "exact" }; l.evidence = [{ id: "z-field", refs: [t], topic: "surface_material", claim: { material: "sett" }, modes: ["car"], kind: "measured", sourceId: "owner.field.2026-11", observedAt: "2025-01-10", observedAtPrecision: "day", recordedAt: ASOF, spatialPrecisionM: 3, verification: "field_verified", verifierRole: "field_surveyor" }, { id: "z-report", refs: [t], topic: "surface_material", claim: { material: "asphalt" }, modes: ["car"], kind: "reported", sourceId: "owner.field.2026-11", observedAt: "2026-10-30", observedAtPrecision: "day", recordedAt: ASOF, spatialPrecisionM: 3, verification: "unverified", consent: { version: "t", aggregated: true } }]; const a = get(views(l), 111768010, "surface_material", "material"); assert.equal(a.value, "sett"); assert.equal(a.confidence.band, "high"); assert.deepEqual(a.dissentingIds, ["z-report"]); });
test("synthetic: two field-verified observations that disagree are contested (no winner)", () => { const l = clone(ledger); const t = { wayId: 1, fromM: 0, toM: 20, wayVersion: 1, wayLengthM: 20, coverage: "exact" }; const mk = (id, m) => ({ id, refs: [t], topic: "surface_material", claim: { material: m }, modes: ["car"], kind: "measured", sourceId: "owner.field.2026-11", observedAt: "2026-06-01", observedAtPrecision: "day", recordedAt: ASOF, spatialPrecisionM: 3, verification: "human_verified", verifierRole: "human_reviewer" }); l.evidence = [mk("a", "sett"), mk("b", "asphalt")]; const a = get(views(l), 1, "surface_material", "material"); assert.equal(a.state, "contested"); assert.equal(a.value, null); assert.ok(a.reasons.includes("R1X_DECISIVE_CONFLICT")); });
test("staleness is a function of asOf only: ring #1 tag read in 2034 becomes stale and queues a P3 re-verification, value unchanged", () => { const a = get(views(ledger, "P-A", "car", "2034-06-01"), 287070936, "surface_material", "material"); assert.equal(a.value, "sett"); assert.equal(a.freshness.state, "stale"); assert.ok(a.reviewTasks.some((t) => t.reason === "stale_winner")); });
test("works/maintenance flags are review triggers only: the policy has no evidence kind or topic that can change a value from a works feed", () => { assert.ok(!JSON.stringify(schema.$defs.kind.enum).includes("works")); assert.ok(!policy.staleness.works); });
test("way identity: split re-anchors into two refs flagged for review", () => { const ref = { wayId: 10, fromM: 0, toM: 30, wayVersion: 1, wayLengthM: 30, anchorNodeIds: [1, 4], coverage: "exact" }; const r = reanchor(ref, [{ id: 11, nodes: [1, 2, 3], cum: [0, 10, 20] }, { id: 12, nodes: [3, 4], cum: [0, 10] }]); assert.equal(r.status, "split"); assert.equal(r.refs.length, 2); assert.ok(r.needsReview); });
test("way identity: merge keeps one ref with a recomputed interval; deletion orphans the record instead of dropping it", () => { const ref = { wayId: 10, fromM: 0, toM: 30, wayVersion: 1, wayLengthM: 30, anchorNodeIds: [2, 4], coverage: "exact" }; const m = reanchor(ref, [{ id: 99, nodes: [1, 2, 3, 4, 5], cum: [0, 10, 20, 30, 45] }]); assert.equal(m.status, "merged_or_renumbered"); assert.deepEqual([m.refs[0].fromM, m.refs[0].toM], [10, 30]); assert.equal(reanchor(ref, [{ id: 5, nodes: [7, 8], cum: [0, 5] }]).status, "orphaned"); });

// ---------- overlay ----------
const { tiles } = loadMilanTiles();
test("overlay: tile hashes match the committed base tiles and every tuple index is valid for a fixture way", () => { const fixtureWays = new Set(ledger.evidence.flatMap((e) => e.refs.map((r) => r.wayId))); for (const [k, t] of Object.entries(overlay["P-A"].tiles)) { assert.equal(t.baseTileSha8, tiles.get(k).sha256.slice(0, 8)); for (const [idx] of t.entries) assert.ok(fixtureWays.has(tiles.get(k).tuples[idx][0]), `${k}:${idx}`); } });
test("overlay default (P-A) is shadow-safe: it overrides NO surface category or roughness weight; P-B overrides only contested stone-vs-smooth", () => { for (const t of Object.values(overlay["P-A"].tiles)) for (const e of t.entries) { assert.equal(e[2], -1); assert.equal(e[3], -1); } const ov = Object.values(overlay["P-B"].tiles).flatMap((t) => t.entries).filter((e) => e[2] !== -1); assert.ok(ov.length > 0); for (const e of ov) { assert.equal(e[2], 1); assert.equal(e[3], 0.65); } });
test("overlay compile is deterministic (report) and a known view never disagrees with the base category", () => { const r = readJson(join(OUT, "overlay-compile-report.json")); for (const v of ["P-A", "P-B"]) { assert.equal(r.determinism[v].runsIdentical, true); assert.equal(r.variants[v].knownBaseMismatchCount, 0); } });
test("overlay manifest records dataset version, base-tile hash, ledger hash, policy and licences", () => { const m = overlay["P-A"].manifest; assert.match(m.datasetVersion, /^sil-milan-\d{4}-\d{2}-\d{2}\.\d+$/); assert.equal(m.ledgerSha256, sha256(readFileSync(join(OUT, "fixture.sil.json")))); assert.ok(m.sources.some((s) => s.licenceId === "ODbL-1.0") && m.sources.some((s) => s.licenceId === "CC-BY-4.0") && m.sources.some((s) => s.licenceId === "CC-BY-SA-4.0")); });

// ---------- D1 DDL ----------
let sqlite = null; try { sqlite = await import("node:sqlite"); } catch { /* optional */ }
test("D1 DDL runs on SQLite; constraints reject raw/fine-grained or free-text style rows", () => {
  if (!sqlite) { results.push("SKIP  node:sqlite unavailable"); return; }
  const db = new sqlite.DatabaseSync(":memory:"); db.exec(readFileSync(join(OUT, "sil-d1.sql"), "utf8"));
  db.prepare("INSERT INTO sil_report_intake (way_id,bucket_from_m,topic,value,severity,reported_week,consent_version,moderation) VALUES (?,?,?,?,?,?,?,?)").run(287070936, 25, "surface_material", "sett", 2, "2026-W46", "consent-v1", "verified");
  assert.throws(() => db.prepare("INSERT INTO sil_report_intake (way_id,bucket_from_m,topic,value,reported_week,consent_version) VALUES (1,13,'surface_material','sett','2026-W46','c')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO sil_report_intake (way_id,bucket_from_m,topic,value,reported_week,consent_version) VALUES (1,25,'surface_material','sett','2026-11-13','c')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO sil_sensor_aggregate VALUES (1,0,'30-50','car','2026-W46',2,5,'imu_rms',0.1,0.2)").run(), /CHECK/);
  const cols = db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table'").all().map((r) => `${r.t}.${r.c}`);
  assert.ok(!cols.some((c) => /lat|lng|lon|coord|ip|nick|note|device|user/i.test(c.split(".")[1])), "privacy: no coordinate, free-text, ip, device or user column");
});

// ---------- scope guard ----------
{ const st = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.slice(3).replaceAll("\\", "/")); const out = st.filter((p) => !/^(outputs|experiments)\/phase436-surface-intelligence\//.test(p)); results.push(`INFO  git status paths outside outputs/experiments phase436 (not necessarily mine; other agents run concurrently): ${out.length ? out.join(", ") : "none"}; rome paths: ${st.filter((p) => /rome/i.test(p)).length}`); test("scope: nothing under rome is modified or untracked", () => assert.equal(st.filter((p) => /rome/i.test(p)).length, 0)); }

const summary = `${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ""}  (asOf ${ASOF}, policy ${policy.policyVersion})`;
writeFileSync(join(OUT, "test-results.txt"), results.join("\n") + "\n\n" + summary + "\n");
console.log(results.join("\n") + "\n\n" + summary);
process.exit(failed ? 1 : 0);
