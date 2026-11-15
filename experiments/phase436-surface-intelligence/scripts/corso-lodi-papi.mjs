/**
 * Phase 4.36 / osm-data-audit — Corso Lodi and Via Lazzaro Papi: OSM surface, rails, carriageways, current-vs-archive,
 * compiled flags, and the tram evidence around them. Public named streets only; no trace needed.
 *
 *   node corso-lodi-papi.mjs
 *
 * Inputs: archive (data/sources), current OSM cache from osm-fetch.mjs (overpass q2-piazzale-lodi-corso-lodi-papi),
 * committed compiled tiles. Outputs evidence/osm-data-audit/corso-lodi-papi.{csv,json}.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, wayCoords, wayLength, projectOnLine, metres, bearing, ROOT, r1 } from "./osm-archive.mjs";

const OUT = join(ROOT, "outputs/phase436-surface-intelligence/evidence/osm-data-audit");
const arc = await loadArchive();
const cur = JSON.parse(await readFile(join(ROOT, "experiments/phase436-surface-intelligence/data/osm-current/overpass-q2-piazzale-lodi-corso-lodi-papi.json"), "utf8"));
const curWays = new Map(cur.elements.filter((e) => e.type === "way").map((w) => [w.id, w]));
const curRails = cur.elements.filter((e) => e.type === "way" && e.tags?.railway);

// compiled tiles (all, committed)
const dir = join(ROOT, "data/surfaces/milan-tiles");
const meta = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
const K = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const compiled = new Map();
let flaggedRails = { segments: 0, m: 0 };
for (const f of (await readdir(dir)).filter((n) => /^\d+_\d+\.json$/.test(n))) {
  const t = JSON.parse(await readFile(join(dir, f), "utf8"));
  for (const x of Array.isArray(t) ? t : t.tuples) {
    const [w, , c, kId, rw, , flags] = x;
    const e = compiled.get(w) ?? new Map();
    const key = c.join(",");
    if (!e.has(key)) { e.set(key, { cat: K[kId], rw, flags, m: metres([c[0], c[1]], [c[2], c[3]]) }); if (flags & 8) { flaggedRails.segments += 1; flaggedRails.m += metres([c[0], c[1]], [c[2], c[3]]); } }
    compiled.set(w, e);
  }
}

const hw = (w) => typeof w.tags?.highway === "string";
const streets = ["Corso Lodi", "Via Lazzaro Papi"];
const ways = [...arc.ways.values()].filter((w) => streets.includes(w.tags?.name) && hw(w));
const railKeys = /tram|rail|trolley|electrified|embedded/;
const rows = ways.map((w) => {
  const c = compiled.get(w.id);
  const cw = curWays.get(w.id);
  const coords = wayCoords(arc, w);
  const cats = c ? [...new Set([...c.values()].map((s) => s.cat))].join("+") : "(not compiled)";
  return { wayId: w.id, name: w.tags.name, highway: w.tags.highway, oneway: w.tags.oneway ?? "", lanes: w.tags.lanes ?? "", surface: w.tags.surface ?? "", smoothness: w.tags.smoothness ?? "", railTags: Object.entries(w.tags).filter(([k]) => railKeys.test(k)).map(([k, v]) => `${k}=${v}`).join(" "),
    lengthM: r1(wayLength(arc, w)), heading: Math.round(bearing(coords[0], coords.at(-1))), compiledCategory: cats, compiledEmbeddedRailsFlag: c ? [...c.values()].some((s) => s.flags & 8) : "", version: w.version, timestamp: w.timestamp, unchangedSinceArchive: cw ? JSON.stringify(cw.tags) === JSON.stringify(w.tags) && JSON.stringify(cw.nodes) === JSON.stringify(w.nodes) : "not in current query" };
}).sort((a, b) => a.name.localeCompare(b.name) || a.wayId - b.wayId);
const csv = (rs) => [Object.keys(rs[0]).join(","), ...rs.map((r) => Object.values(r).map((v) => (typeof v === "string" && /[",]/.test(v) ? JSON.stringify(v) : v)).join(","))].join("\n") + "\n";
await writeFile(join(OUT, "corso-lodi-papi.csv"), csv(rows));

const by = (name, pred = () => true) => {
  const out = {};
  for (const r of rows.filter((x) => x.name === name && pred(x))) { const k = `${r.highway}|oneway=${r.oneway || "-"}|${r.surface || "(none)"}`; out[k] = (out[k] ?? 0) + r.lengthM; }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(v)]));
};

// Directed path composition along the Corso Lodi arm that leaves Piazzale Lodi towards the NW (car-legal, one-way aware).
const CAR = new Set(["primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street"]);
const edges = new Map();
const add = (a, b, w) => { const A = arc.nodes.get(a), B = arc.nodes.get(b); if (!edges.has(a)) edges.set(a, []); edges.get(a).push({ to: b, len: metres([A.lon, A.lat], [B.lon, B.lat]), way: w }); };
for (const w of arc.ways.values()) {
  if (!CAR.has(w.tags?.highway) || w.tags.area === "yes" || ["no", "private"].includes((w.tags.motor_vehicle || w.tags.vehicle || w.tags.access || "yes").toLowerCase())) continue;
  const c = wayCoords(arc, w);
  if (c.some((p) => !p) || !c.some((p) => p[0] > 9.2 && p[0] < 9.2125 && p[1] > 45.4455 && p[1] < 45.4535)) continue;
  const o = (w.tags.oneway || (w.tags.junction ? "yes" : "no")).toLowerCase();
  for (let i = 1; i < w.nodes.length; i += 1) {
    if (o === "-1") add(w.nodes[i], w.nodes[i - 1], w);
    else if (["yes", "1", "true"].includes(o)) add(w.nodes[i - 1], w.nodes[i], w);
    else { add(w.nodes[i - 1], w.nodes[i], w); add(w.nodes[i], w.nodes[i - 1], w); }
  }
}
function dijkstra(src, dst) {
  const dist = new Map([[src, 0]]), prev = new Map(); const pq = [[0, src]];
  while (pq.length) { pq.sort((a, b) => a[0] - b[0]); const [d, u] = pq.shift(); if (d > dist.get(u)) continue; if (u === dst) break; for (const e of edges.get(u) ?? []) { const nd = d + e.len; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { u, e }); pq.push([nd, e.to]); } } }
  if (!dist.has(dst)) return null;
  const path = []; let x = dst; while (x !== src) { const p = prev.get(x); path.unshift(p.e); x = p.u; }
  return path;
}
const comp = (path) => { const o = {}, seq = []; let tot = 0; for (const e of path) { const s = e.way.tags.surface ?? "(none)"; o[s] = (o[s] ?? 0) + e.len; tot += e.len; if (!seq.length || seq.at(-1).id !== e.way.id) seq.push({ id: e.way.id, hw: e.way.tags.highway, oneway: e.way.tags.oneway ?? "no", surface: s, smoothness: e.way.tags.smoothness ?? null, m: 0 }); seq.at(-1).m += e.len; } return { totalM: r1(tot), byS: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)])), settShare: r1(100 * ((o.sett ?? 0) + (o.cobblestone ?? 0)) / tot), ways: seq.map((s) => ({ ...s, m: r1(s.m) })) }; };
const ringExit = arc.ways.get(161606045).nodes[0];            // Corso Lodi way leaving the ring (NW-bound), first node
const ringEntry = arc.ways.get(290523327).nodes.at(-1);       // Corso Lodi way entering the ring (SE-bound), last node
const far = arc.ways.get(1183972690);
const farNode = far.nodes[0];
const toNW = dijkstra(ringExit, farNode), toSE = dijkstra(farNode, ringEntry);

// Tram evidence: archive tram ways nearest to named places, current-OSM rails near them (query result), flags in compiled data.
const tramWays = [...arc.ways.values()].filter((w) => w.tags?.railway === "tram").map((w) => ({ w, c: wayCoords(arc, w).filter(Boolean) }));
const places = { "Piazzale Lodi ring": ["Piazzale Lodi", (w) => w.tags.junction], "Corso Lodi": ["Corso Lodi"], "Via Lazzaro Papi": ["Via Lazzaro Papi"] };
const nearestTram = {};
for (const [label, [nm, pred]] of Object.entries(places)) {
  const ws = ways.length ? [...arc.ways.values()].filter((w) => w.tags?.name === nm && hw(w) && (!pred || pred(w))) : [];
  let best = Infinity;
  for (const w of ws) for (const p of wayCoords(arc, w).filter(Boolean)) for (const t of tramWays) { const q = projectOnLine(t.c, p); if (q.d < best) best = q.d; }
  nearestTram[label] = r1(best);
}
const tramM = tramWays.reduce((s, t) => s + wayLength(arc, t.w), 0);
const summary = {
  corsoLodi: { ways: rows.filter((r) => r.name === "Corso Lodi").length, totalWayMetres: r1(rows.filter((r) => r.name === "Corso Lodi").reduce((s, r) => s + r.lengthM, 0)), composition: by("Corso Lodi") },
  viaLazzaroPapi: { ways: rows.filter((r) => r.name === "Via Lazzaro Papi").length, totalWayMetres: r1(rows.filter((r) => r.name === "Via Lazzaro Papi").reduce((s, r) => s + r.lengthM, 0)), composition: by("Via Lazzaro Papi"), ways: rows.filter((r) => r.name === "Via Lazzaro Papi") },
  allUnchangedSinceArchive: rows.every((r) => r.unchangedSinceArchive === true), waysCheckedAgainstCurrentOsm: rows.length,
  railTagsOnAnyCorsoLodiOrPapiWay: rows.filter((r) => r.railTags).length,
  embeddedRailsFlagOnCompiledCorsoLodiOrPapi: rows.filter((r) => r.compiledEmbeddedRailsFlag === true).length,
  compiledEmbeddedRailsFlagAnywhere: { segments: flaggedRails.segments, metres: r1(flaggedRails.m) },
  archiveTramWays: { ways: tramWays.length, metres: r1(tramM), inCitywideExtracts: [...arc.ways.values()].filter((w) => w.tags?.railway === "tram" && w._kind === "citywide").length },
  nearestArchiveTramWayMetres: nearestTram,
  currentOsmRailWaysWithin: { "30 m of Corso Lodi / Via Lazzaro Papi, 80 m of Piazzale Lodi (Overpass 2026-11-14T13:49:43Z)": curRails.map((w) => ({ id: w.id, railway: w.tags.railway, name: w.tags.name ?? null, service: w.tags.service ?? null, layer: w.tags.layer ?? null, tunnel: w.tags.tunnel ?? null })) },
  corridorNorthwestOfPiazzaleLodi: { fromRingToFarEnd_NWbound: toNW && comp(toNW), fromFarEndToRing_SEbound: toSE && comp(toSE) },
};
console.log(JSON.stringify({ ...summary, viaLazzaroPapi: { ...summary.viaLazzaroPapi, ways: undefined }, corridorNorthwestOfPiazzaleLodi: { NW: summary.corridorNorthwestOfPiazzaleLodi.fromRingToFarEnd_NWbound && { totalM: summary.corridorNorthwestOfPiazzaleLodi.fromRingToFarEnd_NWbound.totalM, byS: summary.corridorNorthwestOfPiazzaleLodi.fromRingToFarEnd_NWbound.byS, settShare: summary.corridorNorthwestOfPiazzaleLodi.fromRingToFarEnd_NWbound.settShare }, SE: summary.corridorNorthwestOfPiazzaleLodi.fromFarEndToRing_SEbound && { totalM: summary.corridorNorthwestOfPiazzaleLodi.fromFarEndToRing_SEbound.totalM, byS: summary.corridorNorthwestOfPiazzaleLodi.fromFarEndToRing_SEbound.byS, settShare: summary.corridorNorthwestOfPiazzaleLodi.fromFarEndToRing_SEbound.settShare } } }, null, 1));
await writeFile(join(OUT, "corso-lodi-papi.json"), JSON.stringify(summary, null, 1) + "\n");
