/**
 * Phase 4.36 routing-experiments: do graph-aligned via points avoid the U-turns of via-waypoint detours? Offline test on the 744 archived
 * via requests (their via point is a geometric offset of the route, route.ts:746-771). For each: is the via point on an intersection of a
 * two-way road (graph-aligned), and does the provider's answer contain a U-turn near it?
 *   node exp-run-via.mjs  ->  evidence/routing-experiments/via-analysis.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, EXP, CACHE, OUT, sha256 } from "./exp-harness.mjs";
import { loadArchive, wayCoords, projectOnLine, metres } from "./osm-archive.mjs";
const { normalizeValhallaResponse } = await import(new URL("lib/routing-providers.ts", ROOT).href);
const index = JSON.parse(await readFile(new URL("archive-index.json", CACHE), "utf8"));
const arc = await loadArchive();
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "primary_link", "secondary_link", "tertiary_link"]);
const roads = []; const nodeWays = new Map(); const grid = new Map();
for (const w of arc.ways.values()) {
  if (!CAR.has(w.tags?.highway) || w.tags.area === "yes") continue;
  const c = wayCoords(arc, w); if (c.some((p) => !p)) continue;
  const r = { w, c, oneway: w.tags.oneway === "yes" || w.tags.junction === "roundabout" }; const i = roads.push(r) - 1;
  for (const n of w.nodes) (nodeWays.get(n) ?? nodeWays.set(n, new Set()).get(n)).add(w.id);
  for (const p of c) { const k = `${Math.floor(p[0] / 0.001)}:${Math.floor(p[1] / 0.001)}`; (grid.get(k) ?? grid.set(k, new Set()).get(k)).add(i); }
}
const nearest = (p) => {
  const cx = Math.floor(p[0] / 0.001), cy = Math.floor(p[1] / 0.001); let best = null;
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) { const q = projectOnLine(roads[i].c, p); if (!best || q.d < best.d) best = { d: q.d, r: roads[i] }; }
  return best;
};
const nearestIntersection = (p) => {
  const cx = Math.floor(p[0] / 0.001), cy = Math.floor(p[1] / 0.001); let best = Infinity;
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
    roads[i].w.nodes.forEach((n, k) => { if ((nodeWays.get(n)?.size ?? 0) >= 2) { const q = roads[i].c[k]; if (q) best = Math.min(best, metres(p, q)); } });
  }
  return best;
};
const rows = [];
for (const [gk, reqs] of Object.entries(index)) {
  const mode = gk.split("|")[2];
  for (const r of reqs.filter((x) => x.kind === "via" && x.status === 200)) {
    const e = JSON.parse(await readFile(new URL(`data/archive/responses/${r.key}.json`, EXP), "utf8"));
    let route; try { route = normalizeValhallaResponse(JSON.parse(e.body), mode === "auto" ? "car" : mode)[0]; } catch { route = null; }
    if (!route) continue;
    const via = r.via, nr = nearest(via); if (!nr) continue;
    const U = route.instructions.filter((i) => i.direction === "uturn");
    const nearVia = U.filter((u) => metres(u.location, via) <= 120);
    rows.push({ mode, dWay: nr.d, hw: nr.r.w.tags.highway, oneway: nr.r.oneway, dInter: nearestIntersection(via), uturn: U.length > 0, uturnNearVia: nearVia.length > 0, unnamedNearVia: nearVia.some((u) => !u.roadName) });
  }
}
const rate = (a, f) => { const s = a.filter(f); return { n: s.length, uturnPct: +(100 * s.filter((x) => x.uturn).length / Math.max(s.length, 1)).toFixed(1), uturnNearViaPct: +(100 * s.filter((x) => x.uturnNearVia).length / Math.max(s.length, 1)).toFixed(1) }; };
const major = new Set(["primary", "secondary", "tertiary"]);
const rules = {
  all: rate(rows, () => true),
  "via within 15 m of an intersection node": rate(rows, (x) => x.dInter <= 15), "via farther than 15 m from any intersection node": rate(rows, (x) => x.dInter > 15),
  "via farther than 30 m from any intersection node": rate(rows, (x) => x.dInter > 30),
  "nearest way two-way": rate(rows, (x) => !x.oneway), "nearest way one-way": rate(rows, (x) => x.oneway),
  "nearest way primary/secondary/tertiary": rate(rows, (x) => major.has(x.hw)), "nearest way residential/service/other minor": rate(rows, (x) => !major.has(x.hw)),
  "via >12 m from any way (snaps elsewhere)": rate(rows, (x) => x.dWay > 12),
  "graph-aligned rule (<=15 m from intersection AND two-way AND not service)": rate(rows, (x) => x.dInter <= 15 && !x.oneway && x.hw !== "service"),
  "NOT graph-aligned": rate(rows, (x) => !(x.dInter <= 15 && !x.oneway && x.hw !== "service")),
};
const out = { note: "744 archived via-waypoint responses (Phase 4.25-4.31 corpus, public landmark journeys); U-turn = Valhalla maneuver type 12/13 in the primary route; near via = within 120 m of the via point. Observational (not an intervention): the via point was NOT chosen by this rule.", viaRequestsAnalysed: rows.length, byRule: rules, medianDistanceToIntersectionM: [...rows.map((x) => x.dInter)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] };
const text = JSON.stringify(out, null, 1) + "\n";
await writeFile(new URL("via-analysis.json", OUT), text); await writeFile(new URL("via-analysis.sha256", OUT), sha256(text) + "\n");
console.log(JSON.stringify(out, null, 1));
