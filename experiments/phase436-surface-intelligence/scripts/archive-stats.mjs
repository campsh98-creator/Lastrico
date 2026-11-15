/**
 * Phase 4.36 / osm-data-audit — dataset-level data-quality statistics from the raw archived OSM extracts.
 *
 *   node archive-stats.mjs [--out=<file.json>]
 *
 * Read-only. Uses the app's own classifier (scripts/osm/normalize.mjs classifySurface, rule set 2026-11) to show how raw
 * tags become categories, and independent counts for everything else. Lengths are metres of way centreline, each way once
 * (newest version across files; the pilot and citywide extracts overlap).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, wayLength, wayCoords, projectOnLine, metres, ROOT, r1 } from "./osm-archive.mjs";
import { classifySurface } from "../../../scripts/osm/normalize.mjs";
import { HIGHWAY_MAP } from "../../../scripts/osm/config.mjs";

const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const arc = await loadArchive();
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "road"]);
const base = (h) => h?.replace(/_link$/, "");
const hw = (w) => typeof w.tags?.highway === "string" && w.tags.area !== "yes";

const out = { archive: arc.perFile.map(({ file, kind, counts, retrievedAt, osmBase, generator, sha256Ok }) => ({ file, kind, ...counts, retrievedAt, osmBase, generator, sha256Ok })) };

// 1. Surface coverage on car-usable ways, via the app's own classifier.
const byClass = {};
const rawValues = {};
let carTotal = 0;
for (const w of arc.ways.values()) {
  if (!hw(w) || !CAR.has(base(w.tags.highway))) continue;
  const len = wayLength(arc, w);
  carTotal += len;
  const hc = Object.hasOwn(HIGHWAY_MAP, w.tags.highway) ? HIGHWAY_MAP[w.tags.highway] : "unknown";
  const c = classifySurface(w.tags, hc, "", "2026-11");
  const k = (byClass[base(w.tags.highway)] ??= { m: 0, confirmed_rough: 0, probable_rough: 0, confirmed_smooth: 0, unpaved_loose: 0, unknown_untagged: 0, unknown_tagged: 0, unknown_conflict: 0 });
  k.m += len;
  if (c.surfaceCategory === "unknown") {
    if (c.state === "conflicting") k.unknown_conflict += len; else if (c.rawSurface) k.unknown_tagged += len; else k.unknown_untagged += len;
  } else k[c.surfaceCategory] += len;
  const key = `${w.tags.surface ?? "(none)"} -> ${c.surfaceCategory}${c.state === "conflicting" ? " (smoothness conflict)" : ""}`;
  rawValues[key] = (rawValues[key] ?? 0) + len;
}
out.carUsableMetres = r1(carTotal);
out.surfaceByHighwayClass = Object.fromEntries(Object.entries(byClass).map(([h, v]) => [h, Object.fromEntries(Object.entries(v).map(([k, m]) => [k, r1(m)]))]));
out.surfaceValueTable = Object.entries(rawValues).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, m]) => ({ rawToCategory: k, metres: r1(m) }));

// 2. Signals the compile ignores although they are in the extracts.
let sbRough = 0, sbWays = 0, cwSurf = 0, smoothBadAsphalt = 0, smoothBadAsphaltWays = 0, tramYesHighway = 0, tramYesM = 0, trolleyM = 0, electrifiedM = 0;
for (const w of arc.ways.values()) {
  if (!hw(w) || !CAR.has(base(w.tags.highway))) continue;
  const len = wayLength(arc, w);
  const s = (w.tags.surface ?? "").toLowerCase();
  if (w.tags.surface_bike && /milanese|sett|cobble/.test(w.tags.surface_bike) && !/sett|cobble|milanese/.test(s)) { sbRough += len; sbWays += 1; }
  if (/^(bad|very_bad|horrible|very_horrible|impassable)$/.test(w.tags.smoothness ?? "") && /^(asphalt|concrete)/.test(s)) { smoothBadAsphalt += len; smoothBadAsphaltWays += 1; }
  if (w.tags.tram === "yes" || w.tags["tram:forward"] === "yes" || w.tags["tram:backward"] === "yes" || w.tags.embedded_rails === "yes") { tramYesHighway += 1; tramYesM += len; }
  if (w.tags.trolley_wire === "yes") trolleyM += len;
  if (w.tags.electrified) electrifiedM += len;
}
out.ignoredSignals = {
  carWaysWithRoughSurfaceBikeButOtherSurface: { ways: sbWays, metres: r1(sbRough), note: "surface_bike=milanese_paving/sett/cobble while surface is not stone: normalize.mjs:60-63 reads surface_bike only when surface is empty" },
  asphaltOrConcreteWithSmoothnessBadOrWorse: { ways: smoothBadAsphaltWays, metres: r1(smoothBadAsphalt), note: "normalize.mjs:106-113 turns these into category unknown with roughnessWeight 0 (no penalty, no smooth credit)" },
  carWaysTaggedTramYesOrEmbeddedRails: { ways: tramYesHighway, metres: r1(tramYesM), note: "become embeddedRails=true (normalize.mjs:276-288); flag is counted by the scorer but read by no ranking or warning code" },
  carWaysWithTrolleyWire: { metres: r1(trolleyM), note: "trolleybus overhead wire, not rails; not used" },
  carWaysWithElectrified: { metres: r1(electrifiedM) },
};

// 3. Rail ways in the extracts (they have no `highway` tag, so extractHighways() drops them).
const rails = { tram: { ways: 0, m: 0 }, other: {} };
const tramWays = [];
for (const w of arc.ways.values()) {
  if (!w.tags?.railway) continue;
  const len = wayLength(arc, w);
  if (w.tags.railway === "tram") { rails.tram.ways += 1; rails.tram.m += len; tramWays.push(w); }
  else { const k = `${w.tags.railway}|${w._kind}`; rails.other[k] = (rails.other[k] ?? 0) + 1; }
}
rails.tram.m = r1(rails.tram.m);
out.railwayWaysInArchive = { ...rails, tramInCitywideExtracts: [...arc.ways.values()].filter((w) => w.tags?.railway === "tram" && w._kind === "citywide").length };

// 4. Relations.
const relTypes = {};
for (const r of arc.relations.values()) relTypes[r.tags?.type ?? "?"] = (relTypes[r.tags?.type ?? "?"] ?? 0) + 1;
out.relations = { total: arc.relations.size, byType: relTypes, inCitywideExtracts: arc.perFile.filter((f) => f.kind === "citywide").reduce((s, f) => s + f.counts.relation, 0), inPilotExtracts: arc.perFile.filter((f) => f.kind === "pilot").reduce((s, f) => s + f.counts.relation, 0) };

// 5. Node tags (barriers, signals, crossings, tram crossings): present only in the pilot extracts.
let tagged = 0, barrier = 0, calming = 0, signals = 0, stops = 0, tramCrossing = 0;
for (const n of arc.nodes.values()) {
  if (!n.tags) continue;
  tagged += 1;
  if (n.tags.barrier) barrier += 1;
  if (n.tags.traffic_calming) calming += 1;
  if (n.tags.highway === "traffic_signals") signals += 1;
  if (n.tags.highway === "stop") stops += 1;
  if (n.tags.railway === "tram_crossing" || n.tags.railway === "crossing") tramCrossing += 1;
}
out.nodeTags = { nodesTotal: arc.nodes.size, tagged, barrier, traffic_calming: calming, traffic_signals: signals, stop: stops, rail_crossings: tramCrossing,
  citywideNodesWithTags: arc.perFile.filter((f) => f.kind === "citywide").length ? "see node.timestamp-less count in junction-via-friuli.json (0)" : null };

// 6. Version/timestamp provenance: citywide nodes carry a default version 1 (expand-milan-citywide.mjs:95).
let cityNodes = 0, cityV1 = 0, cityTs = 0;
for (const n of arc.nodes.values()) if (!n.tags && !n.timestamp) { cityNodes += 1; if (n.version === 1) cityV1 += 1; if (n.timestamp) cityTs += 1; }
out.citywideNodeProvenance = { nodesWithoutTimestamp: cityNodes, withVersion1: cityV1, withTimestamp: cityTs };

console.log(JSON.stringify(out, null, 2));
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
