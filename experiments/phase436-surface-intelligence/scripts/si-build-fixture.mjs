/**
 * Phase 4.36 / SIL prototype - builds the compact evidence-ledger fixture for the REAL field cases:
 *   Piazzale Lodi ring ways, the Corso Lodi NW arm, Via Lazzaro Papi, the untagged Via Fra Cristoforo ways.
 * Inputs (all read-only): the committed OSM archives (way version/timestamp/tags/node ids, via Agent 2's osm-archive.mjs),
 * the committed Milan tiles, the cached DBT 2020 tram features (via si-dbt-join.mjs) and Agent 2/3/1 findings quoted in
 * their reports (changeset history, KartaView photo record, ATM result, provider-graph probe) with the report file named in `notes`.
 * Nothing is invented: a date the sources do not give stays null. No GPS-trace coordinate is used anywhere.
 *
 *   node si-build-fixture.mjs   -> fixture.sil.json, fixture-checks.json
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, ROOT, ASOF, loadMilanTiles, metres, stable, validate, readJson } from "./si-lib.mjs";
import { loadArchive, wayCoords } from "./osm-archive.mjs";
import { runDbtJoin } from "./si-dbt-join.mjs";

const arc = await loadArchive();
const { tiles, meta } = loadMilanTiles();
const dbt = runDbtJoin({ tiles, meta });
const schema = readJson(join(OUT, "sil.schema.json"));

const RING = [287070936, 111768010, 111767966, 713165251, 287070935, 713165261, 287070933];
const CORSO_NW = [161606045, 529556308, 290523325, 161606039, 290523322, 305989915, 294819087, 232575191, 232575190, 900636756, 85890884, 290523326, 295087306, 290523318, 181343587, 375509949, 375509948, 1184663891];
const PAPI = [164940303, 164940304];
const FRA_UNTAGGED = [137158656, 1236292178, 273258718, 273258717, 273258719];
const FRA_NEIGHBOUR = 273258720;
const FOCUS = [...RING, ...CORSO_NW, ...PAPI, ...FRA_UNTAGGED, FRA_NEIGHBOUR];
const r1 = (x) => Math.round(x * 10) / 10;

// ---- way geometry and linear referencing from the ARCHIVE (the SIL build reads raw OSM, not the compiled tiles) ----
const geo = new Map();
for (const id of FOCUS) {
  const way = arc.ways.get(id);
  if (!way) throw new Error(`way ${id} missing from archive`);
  const coords = wayCoords(arc, way), cum = [0];
  for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i]));
  geo.set(id, { way, coords, cum, nodes: way.nodes, len: cum.at(-1) });
}
const ref = (wayId, coverage, i0 = 0, i1 = null) => {
  const g = geo.get(wayId), j1 = i1 ?? g.nodes.length - 1;
  return { wayId, fromM: r1(g.cum[i0]), toM: r1(g.cum[j1]), wayVersion: g.way.version, wayLengthM: r1(g.len), anchorNodeIds: [g.nodes[i0], g.nodes[j1]], coverage };
};
const vertexIdx = (coords, a, b) => { for (let i = 1; i < coords.length; i += 1) if (Math.abs(coords[i - 1][0] - a[0]) < 1e-7 && Math.abs(coords[i - 1][1] - a[1]) < 1e-7 && Math.abs(coords[i][0] - b[0]) < 1e-7 && Math.abs(coords[i][1] - b[1]) < 1e-7) return i; return -1; };

// ---- sources ----
const dbtSha = dbt.inputs["dbt-box-19-wgs.json"].sha256;
const sources = [
  { id: "osm.citywide.2026-11-04", name: "OpenStreetMap, Overpass citywide extract used by the compiled Milan tiles", licenceId: "ODbL-1.0", attribution: "© OpenStreetMap contributors", retrievedAt: "2026-11-04", datasetDate: "2026-11-04", sha256: "6a07224314116cefff25a1a85a84532ce95a5698fa06682fd3eff8472411b781", licenceNote: "sha256 = manifest of the 8 citywide sectors (data/sources/milan-citywide-expansion.source.json)" },
  { id: "osm.pilot.2026-10-28", name: "OpenStreetMap API map.json, central pilot extract", licenceId: "ODbL-1.0", attribution: "© OpenStreetMap contributors", retrievedAt: "2026-10-28", datasetDate: "2026-10-28", sha256: "894dfeeb16709df2857db688fd2dedde1f14096363ba76ba22087da2eeeb2bf7" },
  { id: "dbt2020.el_trv", name: "Comune di Milano, Database Topografico 2020, tram axis EL_TRV (REST layer 19, landmark box)", licenceId: "CC-BY-4.0", licenceNote: "CKAN license_id cc-by; version not stated in CKAN, the portal states CC BY 4.0 (not re-verified; Agent 3)", attribution: "Comune di Milano, Database Topografico 2020, CC BY", retrievedAt: "2026-11-14", datasetDate: "2020-03", sha256: dbtSha, authoritativeFor: ["rails_presence"], completeFor: [] },
  { id: "dbt2020.fon", name: "Comune di Milano, Database Topografico 2020, field EL_STR_FON", licenceId: "CC-BY-4.0", attribution: "Comune di Milano, Database Topografico 2020, CC BY", retrievedAt: "2026-11-14", datasetDate: "2020-03", nonDiscriminatingFor: ["surface_material.material"], licenceNote: "FON = 01 'pavimentato' on 55,554 of 55,554 street segments (Agent 3): carries no material information" },
  { id: "atm.ds538.2026-07-24", name: "ATM Milano, surface line routes (CKAN ds538)", licenceId: "CC-BY-4.0", attribution: "ATM Milano via Comune di Milano open data, CC BY", retrievedAt: "2026-11-14", datasetDate: "2026-07-24", sha256: "4c0469fc2bab9027cd70603f088d1d24b13ea11e19c5b77a51cffe4fbfbbec0b", authoritativeFor: ["rails_presence.service"], licenceNote: "describes service (lines), not tracks" },
  { id: "kartaview.2203776", name: "KartaView photo 2203776 (sequence 7455), 2016-06-15", licenceId: "CC-BY-SA-4.0", attribution: "KartaView contributor, photo 2203776, CC BY-SA 4.0 (image not stored; reference only)", retrievedAt: "2026-11-14", datasetDate: "2016-06-15" },
  { id: "owner.field.2026-11", name: "Project owner's own field observation (outbound journey, no GPS recorded)", licenceId: "PROJECT-CONTRIBUTION-TBD", attribution: "Lastrico project field observation", retrievedAt: "2026-11-14", licenceNote: "contribution terms for field/user reports are an open owner decision" },
  { id: "provider.valhalla.fossgis", name: "Valhalla routing graph at valhalla1.openstreetmap.de, live probe V9 (Agent 1)", licenceId: "ODbL-1.0", attribution: "© OpenStreetMap contributors; routing by FOSSGIS Valhalla", retrievedAt: "2026-11-14", datasetDate: "2026-11-14", authoritativeFor: ["direction.oneway"] },
  { id: "inference.heuristic.v0", name: "Heuristic inference (neighbour / topology); never votes in v0", licenceId: "ODbL-1.0", attribution: "derived from © OpenStreetMap contributors", retrievedAt: "2026-11-14" },
].sort((a, b) => a.id.localeCompare(b.id));
const osmSource = (id) => (arc.ways.get(id)._kind === "pilot" ? "osm.pilot.2026-10-28" : "osm.citywide.2026-11-04");

// ---- OSM history facts read by Agent 2 (osm-data-audit.md sections 2, 3.1, 4.1; request log evidence/osm-data-audit/request-log.jsonl) ----
const HISTORY = {
  "surface:287070936": { at: "2023-09-05", p: "day", cs: 140859948 }, "surface:111768010": { at: "2023-09-05", p: "day", cs: 140859948 },
  "surface:111767966": { at: "2019-02-20", p: "day", cs: 67401242 }, "surface:164940303": { at: "2023-09-05", p: "day", cs: 140859948 },
  "smoothness:287070936": { at: "2023-09", p: "month", cs: 140880308 }, "smoothness:111768010": { at: "2023-09", p: "month", cs: 140880308 },
  "smoothness:111767966": { at: "2023-09", p: "month", cs: 140880308 }, "smoothness:164940303": { at: "2023-09-14", p: "day", cs: null },
  "surface_bike:111768010": { at: "2013", p: "year", cs: null },
};
const MATERIALS = new Set(["sett", "cobblestone", "unhewn_cobblestone", "paving_stones", "asphalt", "concrete", "paved", "unpaved", "compacted", "gravel", "fine_gravel", "other", "unknown"]);
const SMOOTH = { excellent: "smooth", good: "smooth", intermediate: "moderate", bad: "rough", very_bad: "very_rough", horrible: "very_rough", very_horrible: "very_rough", impassable: "very_rough" };
const ALL = ["car", "motorcycle", "bicycle"];
const evidence = [];
const E = (e) => evidence.push({ recordedAt: ASOF, verification: "unverified", verifierRole: "none", ...e });

for (const id of FOCUS) {
  const g = geo.get(id), tags = g.way.tags ?? {}, src = osmSource(id);
  const base = { refs: [ref(id, "exact")], kind: "tagged", sourceId: src, spatialPrecisionM: 3 };
  const so = (key) => { const h = HISTORY[`${key}:${id}`]; return { observedAt: h?.at ?? null, observedAtPrecision: h?.p ?? "unknown", ...(h ? { observedAtBasis: "osm_changeset_with_declared_source_survey" } : {}), sourceRef: { wayVersion: g.way.version, sourceTimestamp: g.way.timestamp ?? null, ...(h?.cs ? { changeset: h.cs } : {}), ...(h ? { declaredSource: "survey", historyReadBy: "Agent 2, osm-data-audit.md" } : {}) } }; };
  if (tags.surface) E({ id: `ev-osm-surface-${id}`, ...base, topic: "surface_material", modes: ALL, claim: { material: MATERIALS.has(tags.surface) ? tags.surface : "other", rawValue: tags.surface, scope: "whole_width" }, ...so("surface") });
  if (tags.smoothness && SMOOTH[tags.smoothness]) E({ id: `ev-osm-smoothness-${id}`, ...base, topic: "physical_roughness", modes: ALL, claim: { level: SMOOTH[tags.smoothness], basis: "osm_smoothness", osmSmoothness: tags.smoothness }, ...so("smoothness") });
  if (tags.surface_bike) E({ id: `ev-osm-surfacebike-${id}`, ...base, kind: "derived", topic: "surface_material", modes: ["bicycle"], claim: { material: "sett", rawValue: tags.surface_bike, scope: "unknown" }, ...so("surface_bike"), notes: "non-standard key surface_bike: discarded by the compiler when surface exists (D4); describes what cyclists ride, not proven for the car lane" });
}

// ---- DBT 2020 tram axis: derived rails evidence per way run (real join on the committed segments), absence where none ----
const flaggedByWay = new Map();
for (const f of dbt.flagged) { if (!FOCUS.includes(f.w) && !(arc.ways.get(f.w)?.tags?.name === "Via Friuli")) continue; if (!flaggedByWay.has(f.w)) flaggedByWay.set(f.w, []); flaggedByWay.get(f.w).push(f); }
const wayForFlag = new Map(); // ways outside FOCUS (Via Friuli) need geometry too
for (const wid of flaggedByWay.keys()) if (!geo.has(wid)) { const way = arc.ways.get(wid), coords = wayCoords(arc, way), cum = [0]; for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i])); geo.set(wid, { way, coords, cum, nodes: way.nodes, len: cum.at(-1) }); }
for (const [wid, list] of [...flaggedByWay.entries()].sort((a, b) => a[0] - b[0])) {
  const g = geo.get(wid), idx = list.map((f) => vertexIdx(g.coords, f.a, f.b)).filter((i) => i > 0).sort((a, b) => a - b);
  const runs = []; for (const i of idx) { const last = runs.at(-1); if (last && i === last[1] + 1) last[1] = i; else runs.push([i, i]); }
  runs.forEach(([i0, i1], n) => {
    const inRun = list.filter((f) => { const k = vertexIdx(g.coords, f.a, f.b); return k >= i0 && k <= i1; });
    const sharing = inRun.some((f) => f.sharing === "shared_carriageway") ? "shared_carriageway" : inRun[0].sharing;
    E({ id: `ev-dbt-rails-${wid}-${n}`, refs: [ref(wid, "exact", i0 - 1, i1)], kind: "derived", sourceId: "dbt2020.el_trv", topic: "rails_presence", modes: ALL,
      claim: { presence: "present", railType: "tram", sharing, service: "in_service", alignment: "longitudinal", trackCount: Math.max(...inRun.map((f) => f.tracks)), railMetresAlong: r1(inRun.reduce((s, f) => s + f.alongM, 0)) },
      observedAt: "2020-03", observedAtPrecision: "month", observedAtBasis: "DBT aerial restitution March/April 2020 (period start used)", spatialPrecisionM: 3.1,
      sourceRef: { join: "si-dbt-join.mjs: tram axis within 5 m and 30 deg of the compiled segment, >= 50 % of its length", pos: inRun[0].pos, elementStatus: "01 in esercizio", note: "POS code read from the spec (02 = shared carriageway), not from the Comune's swapped _d labels" },
      notes: "embedding (flush / protruding) is not stated by DBT and is left out, i.e. unknown" });
  });
}
const noRails = [...RING, ...PAPI, 264363537];
for (const wid of noRails) { if (!geo.has(wid)) { const way = arc.ways.get(wid), coords = wayCoords(arc, way), cum = [0]; for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i])); geo.set(wid, { way, coords, cum, nodes: way.nodes, len: cum.at(-1) }); }
  E({ id: `ev-dbt-norails-${wid}`, refs: [ref(wid, "exact")], kind: "derived", sourceId: "dbt2020.el_trv", topic: "rails_presence", modes: ALL, claim: { presence: "absent" }, observedAt: "2020-03", observedAtPrecision: "month", spatialPrecisionM: 3.1,
    sourceRef: { join: "no DBT tram axis within 5 m of any compiled segment of this way (si-dbt-join.mjs); nearest elements 15-31 m away per Agent 3" }, notes: "absence in a source not declared complete: weak by rule, never 'no rails'" }); }
// transversal crossings (DBT axis crossing the way at >= 60 deg), merged within 6 m
const crossWays = new Map();
for (const [w, a, b, frac, ang, n] of dbt.crossingList) { const g = geo.get(w); if (!g) continue; const i = vertexIdx(g.coords, a, b); if (i < 0) continue; const atM = r1(g.cum[i - 1] + frac * (g.cum[i] - g.cum[i - 1])); const list = crossWays.get(w) ?? []; if (!list.some((c) => Math.abs(c.atM - atM) < 6)) list.push({ atM, ang, n }); crossWays.set(w, list); }
for (const [w, list] of [...crossWays.entries()].sort((a, b) => a[0] - b[0])) list.forEach((c, k) => E({ id: `ev-dbt-crossing-${w}-${k}`, refs: [ref(w, "partial")], kind: "derived", sourceId: "dbt2020.el_trv", topic: "rail_crossing", modes: ALL, claim: { atM: c.atM, crossingAngleDeg: c.ang, trackCount: Math.max(1, c.n) }, observedAt: "2020-03", observedAtPrecision: "month", spatialPrecisionM: 3.1, sourceRef: { join: "si-dbt-join.mjs: axis within 3 m and >= 60 deg" } }));

// ---- ATM: no scheduled tram line on the Corso Lodi arm (service, NOT rails); line 19 on the flagged Via Friuli ways ----
E({ id: "ev-atm-corsolodi-nw", refs: CORSO_NW.map((w) => ref(w, "exact")), kind: "derived", sourceId: "atm.ds538.2026-07-24", topic: "rails_presence", modes: ALL, claim: { service: "no_scheduled_line" }, observedAt: "2026-07-24", observedAtPrecision: "day", observedAtBasis: "ATM file date", spatialPrecisionM: 12, sourceRef: { note: "Agent 3: no tram route within 12 m of Corso Lodi, Via Lazzaro Papi or the ring in the 45-route tram file; nearest line 9 at 46 m" }, notes: "absence of a line says nothing about removal of rails" });
const friuli = [...flaggedByWay.keys()].filter((w) => arc.ways.get(w)?.tags?.name === "Via Friuli");
if (friuli.length) E({ id: "ev-atm-friuli", refs: friuli.map((w) => ref(w, "exact")), kind: "derived", sourceId: "atm.ds538.2026-07-24", topic: "rails_presence", modes: ALL, claim: { railType: "tram", service: "in_service" }, observedAt: "2026-07-24", observedAtPrecision: "day", spatialPrecisionM: 5, sourceRef: { note: "Agent 3: ATM tram line 19 within 5 m of Via Friuli" } });

// ---- imagery, reports, provider graph, untagged-way evidence ----
E({ id: "ev-kartaview-2203776", refs: [ref(713165251, "exact"), ref(287070935, "partial"), ref(287070933, "partial"), ref(111768010, "adjacent"), ref(111767966, "adjacent")], kind: "measured", sourceId: "kartaview.2203776", topic: "surface_material", modes: ALL,
  claim: { material: "sett", scope: "partial_width" }, observedAt: "2016-06-15", observedAtPrecision: "day", spatialPrecisionM: 5, verification: "unverified", verifierRole: "agent_visual",
  sourceRef: { provider: "KartaView", photoId: 2203776, sequenceId: 7455, heading: 338.78, gpsAccuracyM: 5, size: "2592x1936", matchedWayId: 287070933, viewConeNote: "ways 111768010 (67.6 m) and 111767966 (76.7 m) are outside the view cone: adjacent only (Agent 3, external-data-audit.md D)" },
  notes: "Agent 3's own visual reading: rectangular granite sett in the foreground, asphalt only on far lanes; NOT human-verified. Image not stored." });
E({ id: "ev-owner-report-ring", refs: [ref(287070936, "coarse"), ref(111768010, "coarse"), ref(111767966, "coarse")], kind: "reported", sourceId: "owner.field.2026-11", topic: "surface_material", modes: ALL,
  claim: { material: "sett", scope: "whole_width" }, observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 35, consent: { version: "owner-direct-observation", aggregated: false },
  notes: "Outbound journey, no GPS: 'the traversed part of the roundabout was physically stone setts' (shared-context.md). Location = the ~69 m traversal, so +-35 m; date not stated, therefore null." });
E({ id: "ev-owner-report-rails", refs: [...CORSO_NW.map((w) => ref(w, "coarse")), ...PAPI.map((w) => ref(w, "coarse"))], kind: "reported", sourceId: "owner.field.2026-11", topic: "rails_presence", modes: ALL,
  claim: { presence: "present", railType: "tram" }, observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 150, consent: { version: "owner-direct-observation", aggregated: false },
  notes: "'tram rails ... around Corso Lodi / Via Lazzaro Papi' (shared-context.md): area-level, hence +-150 m and coarse coverage." });
E({ id: "ev-provider-direction-713165261", refs: [ref(713165261, "exact")], kind: "derived", sourceId: "provider.valhalla.fossgis", topic: "direction", modes: ["car", "motorcycle"], claim: { oneway: "forward", basis: "provider_graph" },
  observedAt: "2026-11-14", observedAtPrecision: "day", spatialPrecisionM: 1, sourceRef: { probe: "V9, routing-forensics.md section 8: a route against the ring flow returns the full 241 m loop" } });
E({ id: "ev-topology-direction-713165261", refs: [ref(713165261, "exact")], kind: "inferred", sourceId: "inference.heuristic.v0", topic: "direction", modes: ["car", "motorcycle"], claim: { oneway: "forward", basis: "topology" },
  observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 1, notes: "closed loop whose other ring ways are oneway=yes (Agent 2 D8); informational" });
E({ id: "ev-dbt-fon-fracristoforo", refs: FRA_UNTAGGED.map((w) => ref(w, "exact")), kind: "derived", sourceId: "dbt2020.fon", topic: "surface_material", modes: ALL, claim: { material: "paved", rawValue: "01", scope: "unknown" },
  observedAt: "2020-03", observedAtPrecision: "month", spatialPrecisionM: 3.1, sourceRef: { field: "EL_STR_FON", value: "01 pavimentato", populationNote: "constant 01 on all 55,554 street segments, including known sett streets" } });
E({ id: "ev-inferred-neighbour-fracristoforo", refs: FRA_UNTAGGED.map((w) => ref(w, "exact")), kind: "inferred", sourceId: "inference.heuristic.v0", topic: "surface_material", modes: ALL, claim: { material: "asphalt", scope: "unknown" },
  observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 100, sourceRef: { basis: `adjacent way ${FRA_NEIGHBOUR} is tagged asphalt` }, notes: "a neighbour's tag is not evidence for an untagged way; never votes in v0" });

evidence.sort((a, b) => a.id.localeCompare(b.id));
const ledger = { schemaVersion: "0.1.0", area: "milan", asOf: ASOF, description: "Phase 4.36 design fixture: real field cases encoded as SIL evidence. Design feasibility, not product validation.", sources, evidence };
const errors = validate(schema.$defs.ledger, ledger, schema);
if (errors.length) { console.error(errors.slice(0, 20).join("\n")); process.exit(1); }
writeFileSync(join(OUT, "fixture.sil.json"), stable(ledger, 1));

// ---- consistency checks against the committed tiles ----
const tileLen = new Map(), tileSegs = new Map(), seen = new Set();
for (const t of tiles.values()) for (const tu of t.tuples) { const k = `${tu[0]}|${tu[2].join(",")}`; if (seen.has(k)) continue; seen.add(k); tileLen.set(tu[0], (tileLen.get(tu[0]) ?? 0) + metres([tu[2][0], tu[2][1]], [tu[2][2], tu[2][3]])); tileSegs.set(tu[0], (tileSegs.get(tu[0]) ?? 0) + 1); }
const checks = [...geo.keys()].sort((a, b) => a - b).map((id) => ({ wayId: id, archiveLengthM: r1(geo.get(id).len), tilesLengthM: r1(tileLen.get(id) ?? 0), tileSegments: tileSegs.get(id) ?? 0, diffM: r1((tileLen.get(id) ?? 0) - geo.get(id).len), wayVersion: geo.get(id).way.version, source: osmSource(id) }));
const ring = (a, b) => geo.get(a).nodes.at(-1) === geo.get(b).nodes[0];
const topology = { "287070935 -> 713165261 chained end-to-start": ring(287070935, 713165261), "713165261 -> 287070936 chained end-to-start": ring(713165261, 287070936) };
writeFileSync(join(OUT, "fixture-checks.json"), stable({ counts: { ways: geo.size, focusWays: FOCUS.length, evidence: evidence.length, sources: sources.length, byKind: evidence.reduce((m, e) => (m[e.kind] = (m[e.kind] ?? 0) + 1, m), {}), byTopic: evidence.reduce((m, e) => (m[e.topic] = (m[e.topic] ?? 0) + 1, m), {}) }, maxAbsLengthDiffM: Math.max(...checks.map((c) => Math.abs(c.diffM))), ringTopology: topology, ways: checks }, 1));
console.log(JSON.stringify({ evidence: evidence.length, ways: geo.size, maxAbsLengthDiffM: Math.max(...checks.map((c) => Math.abs(c.diffM))), topology, bytes: readFileSync(join(OUT, "fixture.sil.json")).length }));
