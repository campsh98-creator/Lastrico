/**
 * Phase 4.36 / osm-data-audit — the junction where the return-trip driver left route 0 (origin street → Via Friuli).
 *
 *   node junction-via-friuli.mjs <trace.json>
 *
 * Reads the GPS trace LOCALLY (route 0 geometry only) to find, by topology, the first node of route 0 that a way named
 * "Via Friuli" also uses. Everything is then derived from the archived OSM extracts (data/sources) and from the
 * current-OSM cache written by osm-fetch.mjs (overpass q1-via-friuli, named-feature query; no trace coordinate sent).
 * Origin-street way ids are redacted in the public report: they are printed here and written to
 * experiments/phase436-surface-intelligence/data/junction-mapping.local.json (git-ignored) only.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, metres, bearing, wayCoords, wayLength, projectOnLine, ROOT, r1 } from "./osm-archive.mjs";

const tracePath = process.argv[2];
if (!tracePath) { console.error("usage: node junction-via-friuli.mjs <trace.json>"); process.exit(2); }
const arc = await loadArchive();
const trace = JSON.parse(await readFile(tracePath, "utf8"));
const r0 = trace.routes[0].coordinates;
let cur = null;
try { cur = JSON.parse(await readFile(join(ROOT, "experiments/phase436-surface-intelligence/data/osm-current/overpass-q1-via-friuli.json"), "utf8")); } catch { /* current state optional */ }

const hw = (w) => typeof w.tags?.highway === "string";
const byNode = new Map();
for (const w of arc.ways.values()) if (hw(w)) for (const n of w.nodes) { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push(w); }

// 1. Junction = first archive node within 0.5 m of route 0 that a "Via Friuli" way also uses.
let J = null; let along = null;
const cand = [...arc.ways.values()].filter((w) => hw(w) && w.tags.name !== "Via Friuli");
for (const w of cand) {
  for (const n of w.nodes) {
    const ws = byNode.get(n) ?? [];
    if (!ws.some((x) => x.tags.name === "Via Friuli")) continue;
    const nn = arc.nodes.get(n);
    const p = projectOnLine(r0, [nn.lon, nn.lat]);
    if (p.d < 0.5 && (J === null || p.along < along)) { J = n; along = p.along; }
  }
}
if (J === null) throw new Error("no shared node found");
const jn = arc.nodes.get(J);
const jpos = [jn.lon, jn.lat];

// 2. Ways at the junction, in redacted form.
const ways = byNode.get(J);
const labels = new Map();
let o = 0;
for (const w of ways) labels.set(w.id, w.tags.name === "Via Friuli" ? `VF ${w.id}` : `ORIGIN-${String.fromCharCode(65 + o++)}`);

function dirInfo(w, nodeId, nodesOf = (x) => x.nodes, coordOf = (id) => { const n = arc.nodes.get(id); return [n.lon, n.lat]; }) {
  const ns = nodesOf(w); const i = ns.indexOf(nodeId);
  const pos = coordOf(nodeId);
  const out = {};
  if (i > 0) out.arrivesWithHeading = r1(bearing(coordOf(ns[i - 1]), pos));
  if (i >= 0 && i < ns.length - 1) out.leavesWithHeading = r1(bearing(pos, coordOf(ns[i + 1])));
  return out;
}
const pick = (t) => Object.fromEntries(["highway", "name", "oneway", "access", "motor_vehicle", "vehicle", "motorcar", "lanes", "surface", "sidewalk", "maxspeed", "junction", "barrier", "traffic_calming", "oneway:conditional", "access:conditional", "turn:lanes", "cycleway", "psv", "bus", "busway", "lanes:bus", "lanes:psv", "bicycle"].filter((k) => t?.[k] !== undefined).map((k) => [k, t[k]]));

const archived = ways.map((w) => ({ label: labels.get(w.id), id: w.id, version: w.version, timestamp: w.timestamp, nodesInWay: w.nodes.length, lengthM: r1(wayLength(arc, w)), startsAtJunction: w.nodes[0] === J, endsAtJunction: w.nodes.at(-1) === J, ...dirInfo(w, J), tags: pick(w.tags), fileOfNewestVersion: w._file }));

// 3. Tagged nodes near the junction (archive). Citywide Overpass extracts used `out skel`: nodes carry no tags there.
const nodeTagCount = { citywide: 0, pilot: 0 };
for (const n of arc.nodes.values()) if (n.tags) nodeTagCount[n.timestamp ? "pilot" : "citywide"] += 1;
const taggedNear = [];
for (const [id, n] of arc.nodes) if (n.tags && metres(jpos, [n.lon, n.lat]) < 100) taggedNear.push({ id, tags: n.tags, distM: r1(metres(jpos, [n.lon, n.lat])) });

// 4. Relations in the archive touching any of the junction ways.
const wayIds = new Set(ways.map((w) => w.id));
const archRels = [...arc.relations.values()].filter((r) => r.members.some((m) => (m.type === "way" && wayIds.has(m.ref)) || (m.type === "node" && m.ref === J)))
  .map((r) => ({ id: r.id, tags: r.tags, members: r.members.filter((m) => wayIds.has(m.ref) || m.ref === J).map((m) => ({ ...m, label: labels.get(m.ref) })) }));
const restrictionsInArchive = [...arc.relations.values()].filter((r) => r.tags?.type === "restriction").length;

// 5. Current OSM state (Overpass named query result).
let current = null;
if (cur) {
  const cways = new Map(cur.elements.filter((e) => e.type === "way").map((e) => [e.id, e]));
  const cnodes = new Map(cur.elements.filter((e) => e.type === "node").map((e) => [e.id, e]));
  const crels = cur.elements.filter((e) => e.type === "relation");
  const cj = cnodes.get(J);
  const cNodeWays = [...cways.values()].filter((w) => w.nodes.includes(J));
  const coord = (id) => { const n = cnodes.get(id); return [n.lon, n.lat]; };
  current = {
    osmBase: cur.osm3s?.timestamp_osm_base,
    junctionNodeExists: Boolean(cj), junctionNodeTags: cj?.tags ?? {}, junctionNodeVersion: cj?.version,
    waysAtJunction: cNodeWays.map((w) => {
      const a = ways.find((x) => x.id === w.id);
      return { label: labels.get(w.id) ?? "NEW-WAY", id: labels.get(w.id)?.startsWith("VF") ? w.id : undefined, version: w.version, archivedVersion: a?.version ?? null, timestamp: w.timestamp, startsAtJunction: w.nodes[0] === J, endsAtJunction: w.nodes.at(-1) === J, ...dirInfo(w, J, (x) => x.nodes, coord), tags: pick(w.tags), tagsChangedSinceArchive: a ? JSON.stringify(pick(a.tags)) !== JSON.stringify(pick(w.tags)) : null, nodesChanged: a ? JSON.stringify(a.nodes) !== JSON.stringify(w.nodes) : null };
    }),
    relationsReturnedForViaFriuliAndTouchingWays: crels.map((r) => ({ id: r.id, tags: r.tags, members: r.members.length })),
    restrictionsTouchingJunctionWays: crels.filter((r) => r.members.some((m) => (m.type === "way" && wayIds.has(m.ref)) || (m.type === "node" && m.ref === J))).map((r) => ({ id: r.id, tags: r.tags, members: r.members.filter((m) => wayIds.has(m.ref) || m.ref === J).map((m) => ({ ...m, label: labels.get(m.ref) })) })),
    taggedNodesWithin100m: [...cnodes.values()].filter((n) => n.tags && metres(jpos, [n.lon, n.lat]) < 100).map((n) => ({ id: n.id, tags: n.tags, distM: r1(metres(jpos, [n.lon, n.lat])) })),
  };
}

// 6. Is the right turn legal in the OSM one-way graph? Origin street arrives heading h_in; Via Friuli leaves with heading h_out.
const originIn = archived.find((w) => w.label.startsWith("ORIGIN") && w.arrivesWithHeading !== undefined);
const originOut = archived.find((w) => w.label.startsWith("ORIGIN") && w.leavesWithHeading !== undefined && w.startsAtJunction);
const vfOut = archived.find((w) => w.label.startsWith("VF") && w.startsAtJunction);
const vfIn = archived.find((w) => w.label.startsWith("VF") && w.endsAtJunction);
const turn = originIn && vfOut ? ((vfOut.leavesWithHeading - originIn.arrivesWithHeading + 540) % 360) - 180 : null;
const report = {
  junction: { alongRoute0M: r1(along), nodeVersionInArchive: jn.version, nodeTagsInArchive: jn.tags ?? {}, waysMeeting: ways.length },
  archived, archivedTaggedNodesWithin100m: taggedNear, archivedNodeTagCounts: nodeTagCount,
  archiveRelationsTouchingJunctionWays: archRels, restrictionRelationsInWholeArchive: restrictionsInArchive,
  turn: { originArrivesHeading: originIn?.arrivesWithHeading, viaFriuliLeavesHeading: vfOut?.leavesWithHeading, signedTurnDeg: turn === null ? null : r1(turn), meaning: turn === null ? null : turn > 0 ? "right turn" : "left turn" },
  viaFriuliOneWayAllowsEntryFromJunction: Boolean(vfOut && vfOut.tags.oneway === "yes" && vfOut.startsAtJunction),
  viaFriuliInboundWayEndsAtJunction: Boolean(vfIn),
  current,
};
console.log(JSON.stringify(report, null, 2));
const mapping = { note: "LOCAL ONLY (git-ignored). Origin-street way ids kept out of committed reports.", junctionNode: J, labels: Object.fromEntries([...labels].map(([k, v]) => [v, k])) };
await mkdir(join(ROOT, "experiments/phase436-surface-intelligence/data"), { recursive: true });
await writeFile(join(ROOT, "experiments/phase436-surface-intelligence/data/junction-mapping.local.json"), JSON.stringify(mapping, null, 2));
// Public (redacted) copy: no origin ids, no junction node id, no coordinates.
const pub = JSON.parse(JSON.stringify(report));
for (const w of pub.archived) if (w.label.startsWith("ORIGIN")) delete w.id;
// Node ids near the origin are withheld too (they would locate the origin within ~65 m).
for (const list of [pub.archivedTaggedNodesWithin100m, pub.current?.taggedNodesWithin100m]) for (const n of list ?? []) delete n.id;
// The origin street's name is redacted everywhere in the public copy.
const originNames = [...new Set(ways.filter((w) => w.tags.name !== "Via Friuli").map((w) => w.tags.name).filter(Boolean))];
let text = JSON.stringify(pub, null, 2);
for (const n of originNames) text = text.split(JSON.stringify(n)).join('"<origin street>"');
await writeFile(join(ROOT, "outputs/phase436-surface-intelligence/evidence/osm-data-audit/junction-via-friuli.json"), text + "\n");
