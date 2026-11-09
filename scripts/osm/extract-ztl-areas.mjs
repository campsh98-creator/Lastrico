/**
 * Phase 4.31 — Milan ZTL areas, built only from OSM evidence already in the repository (the
 * checksummed citywide and central archives). No network, no official perimeters (none are in
 * the data), no invented hours.
 *
 * A "ZTL rule" way is a drivable way whose motor-vehicle access keys carry a permit-type value
 * (permit, residents) or a time window (motor_vehicle:conditional=no @ (20:00 - 07:00), a
 * permit @ window, a yes @ window). Nearby rule ways are grouped into one area. Separately, a
 * mapped ZTL polygon (area=yes, name "ZTL: …") makes every drivable way inside it part of that
 * area, with the rule its tags state. Ways that only carry a "ZTL" comment, with no rule, are
 * listed as unsupported: the data says there is a ZTL but not what it allows.
 *
 *   node scripts/osm/extract-ztl-areas.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = new URL("../../", import.meta.url);
const DRIVABLE = /^(primary|secondary|tertiary|unclassified|residential|living_street|service|primary_link|secondary_link|tertiary_link)$/;
const MOTOR_KEYS = ["motorcar", "motorcycle", "motor_vehicle", "vehicle", "access"];
const PERMIT_VALUES = new Set(["permit", "residents"]);
const sources = readdirSync(new URL("data/sources/", root)).filter((f) => /^milan-(citywide|pilot)-.*\.osm\.json\.gz$/.test(f)).sort();

const nodes = new Map();
const ways = new Map();
const relations = new Map();
const areaPolygons = [];
const files = [];
for (const file of sources) {
  const raw = gunzipSync(readFileSync(new URL(`data/sources/${file}`, root)));
  files.push({ file, sha256: createHash("sha256").update(raw).digest("hex") });
  for (const element of JSON.parse(raw).elements) {
    if (element.type === "node") nodes.set(element.id, [element.lon, element.lat]);
    else if (element.type === "relation") relations.set(element.id, element);
    else if (element.type === "way") {
      const known = ways.get(element.id);
      // The same way can be in several archives; keep the newest version.
      if (!known || (element.version ?? 0) > (known.version ?? 0)) ways.set(element.id, element);
    }
  }
}

const ruleOf = (tags) => {
  const rules = [];
  for (const key of MOTOR_KEYS) {
    const plain = tags[key]?.trim().toLowerCase();
    const conditional = tags[`${key}:conditional`];
    if (conditional && /@\s*\(?\s*[A-Z]?[a-z]?[-A-Za-z, ]*\d{1,2}:\d{2}/.test(conditional) && /(^|;)\s*(no|permit|yes|delivery|destination)\s*@/.test(conditional)) rules.push(`${key}:conditional=${conditional}`);
    if (plain && PERMIT_VALUES.has(plain)) rules.push(`${key}=${plain}`);
  }
  return rules;
};
const mentionsZtl = (tags) => /\bztl\b|traffico limitato/i.test(`${tags.comment ?? ""} ${tags["comment:it"] ?? ""} ${tags.description ?? ""} ${tags.fixme ?? ""} ${tags.note ?? ""}`);
const coords = (way) => way.nodes.map((id) => nodes.get(id)).filter(Boolean);
const lengthOf = (points) => points.slice(1).reduce((sum, p, i) => {
  const q = points[i];
  const x = (p[0] - q[0]) * 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const y = (p[1] - q[1]) * 110_540;
  return sum + Math.hypot(x, y);
}, 0);
const insidePolygon = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Mapped ZTL polygons.
for (const way of ways.values()) {
  const tags = way.tags ?? {};
  if (tags.area === "yes" && /^ZTL\b/i.test(tags.name ?? "")) {
    const ring = coords(way);
    if (ring.length >= 4) areaPolygons.push({ way, ring });
  }
}

const ruleWays = [];
const commentOnly = [];
for (const way of ways.values()) {
  const tags = way.tags ?? {};
  if (!DRIVABLE.test(tags.highway ?? "")) continue;
  if (tags.highway === "service" && ["private", "no"].includes(tags.access)) continue;
  const points = coords(way);
  if (points.length < 2) continue;
  const rules = ruleOf(tags);
  if (rules.length) ruleWays.push({ way, points, rules, length: lengthOf(points) });
  else if (mentionsZtl(tags)) commentOnly.push({ id: way.id, name: tags.name ?? null, comment: tags.comment ?? tags["comment:it"] ?? tags.fixme ?? null, points });
}

// Group rule ways whose nodes lie within 60 m of each other.
const parent = ruleWays.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const cell = 0.0008;
const grid = new Map();
ruleWays.forEach((entry, index) => {
  for (const [x, y] of entry.points) {
    const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    (grid.get(key) ?? grid.set(key, new Set()).get(key)).add(index);
  }
});
ruleWays.forEach((entry, index) => {
  for (const [x, y] of entry.points) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const other of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (other === index || find(other) === find(index)) continue;
        if (ruleWays[other].points.some(([ox, oy]) => Math.hypot((ox - x) * 78_000, (oy - y) * 110_540) <= 60)) parent[find(other)] = find(index);
      }
    }
  }
});
const groups = new Map();
ruleWays.forEach((entry, index) => {
  const id = find(index);
  (groups.get(id) ?? groups.set(id, []).get(id)).push(entry);
});

const slug = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const summarise = (entries) => {
  const counts = new Map();
  for (const entry of entries) for (const rule of entry.rules) counts.set(rule, (counts.get(rule) ?? 0) + entry.length);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([rule]) => rule);
};
const areas = [];
const timedClosures = [];
const near = (points, others, meters) => points.some(([x, y]) => others.some(([ox, oy]) => Math.hypot((ox - x) * 78_000, (oy - y) * 110_540) <= meters));
for (const entries of groups.values()) {
  const total = entries.reduce((sum, entry) => sum + entry.length, 0);
  // A lone permit way (a gated courtyard, a private lane) is not a zone.
  if (entries.length < 2 || total < 150) continue;
  // Only a zone with ZTL evidence is a ZTL a person can be authorised for: a permit rule, a
  // "zona a traffico limitato" note on or near its ways. Market-day, school-hour and night
  // closures are ordinary timed closures: enforced, never "authorised".
  const points = entries.flatMap((entry) => entry.points);
  const evidence = [];
  if (entries.some((entry) => entry.rules.some((rule) => /=(permit|residents)$|(^|=|; ?)permit @/.test(rule)))) evidence.push("permit rule in the access tags");
  const notes = commentOnly.filter((way) => near(way.points, points, 100));
  if (notes.length) evidence.push(`ZTL note on ${notes.length} nearby way(s): ${[...new Set(notes.map((way) => way.name).filter(Boolean))].join(", ")}`);
  if (entries.some((entry) => mentionsZtl(entry.way.tags))) evidence.push("ZTL note on a rule way");
  if (!evidence.length) {
    timedClosures.push({ streets: [...new Set(entries.map((entry) => entry.way.tags.name).filter(Boolean))].slice(0, 3), meters: Math.round(total), rules: summarise(entries).slice(0, 2) });
    continue;
  }
  const names = new Map();
  for (const entry of entries) if (entry.way.tags.name) names.set(entry.way.tags.name, (names.get(entry.way.tags.name) ?? 0) + entry.length);
  const topNames = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const timed = entries.some((entry) => entry.rules.some((rule) => rule.includes(":conditional")));
  const xs = entries.flatMap((entry) => entry.points.map((p) => p[0]));
  const ys = entries.flatMap((entry) => entry.points.map((p) => p[1]));
  areas.push({
    id: `ztl-${slug(topNames[0] ?? `area-${entries[0].way.id}`)}`,
    name: `ZTL ${topNames.slice(0, 3).join(", ")}${topNames.length > 3 ? " e vie vicine" : ""}`,
    kind: timed ? "timed" : "permit",
    rules: summarise(entries).slice(0, 6),
    meters: Math.round(total),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Number(v.toFixed(6))),
    wayIds: entries.map((entry) => entry.way.id).sort((a, b) => a - b),
    streets: topNames,
    evidence,
  });
}
function distanceToRing([x, y], ring) {
  let best = Infinity;
  const kx = 111_320 * Math.cos((y * Math.PI) / 180), ky = 110_540;
  for (let i = 1; i < ring.length; i += 1) {
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
    const dx = (bx - ax) * kx, dy = (by - ay) * ky, px = (x - ax) * kx, py = (y - ay) * ky;
    const t = dx || dy ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}
const waysByName = new Map();
for (const way of ways.values()) if (way.tags?.highway && way.tags.name) (waysByName.get(way.tags.name) ?? waysByName.set(way.tags.name, []).get(way.tags.name)).push(way);
const continuesOutside = (name, ring) => (waysByName.get(name) ?? []).some((other) => {
  const points = coords(other);
  return points.length >= 2 && !insidePolygon(points[Math.floor(points.length / 2)], ring) && distanceToRing(points[Math.floor(points.length / 2)], ring) > 15;
});
// "…delimitata dal seguente perimetro di strade: via Bertano, via F. Melzi d'Eril, C.so Sempione…"
const perimeterStems = (text) => {
  // Up to the sentence end (". La ZTL…"), not the abbreviation dots inside ("F. Melzi", "C.so").
  const list = text?.split(/perimetro[^:]*:/i)[1]?.split(/\.\s+(?=(?:La|Il|Lo|Gli|I|È|E) )/)[0];
  if (!list) return [];
  return list.split(",").map((item) => item.trim().split(/\s+/).at(-1).toLowerCase().replace(/[aeiou]$/, "")).filter((stem) => stem.length >= 4);
};
// A polygon's hours, when its description states them ("dalle ore 22 alle 6", "dalle ore 00:00
// alle ore 24:00"); otherwise its tag applies all day.
const descriptionHours = (text) => {
  const match = text?.match(/dalle ore (\d{1,2})(?:[:.](\d{2}))?(?: ore)? alle(?: ore)? (\d{1,2})(?:[:.](\d{2}))?/i);
  if (!match) return null;
  const pad = (h, m) => `${String(Number(h)).padStart(2, "0")}:${m ?? "00"}`;
  return `${pad(match[1], match[2])}-${pad(match[3], match[4])}`;
};
for (const { way, ring } of areaPolygons) {
  const inside = [...ways.values()].filter((other) => DRIVABLE.test(other.tags?.highway ?? "") && !(other.tags?.highway === "service" && ["private", "no"].includes(other.tags?.access)))
    .filter((other) => {
      const points = coords(other);
      if (points.length < 2 || !insidePolygon(points[Math.floor(points.length / 2)], ring)) return false;
      // A street running along the perimeter is the boundary, normally outside the zone (the
      // description lists them as its "perimetro"): it is never restricted by the polygon.
      const alongEdge = points.filter((point) => distanceToRing(point, ring) <= 12).length;
      if (alongEdge / points.length >= 0.6) return false;
      // Streets the description names as the perimeter are boundary streets too.
      const name = (other.tags.name ?? "").toLowerCase();
      if (perimeterStems(way.tags.description).some((stem) => name.includes(stem))) return false;
      // A street that continues outside the polygon is a through street drawn into a loose
      // outline (e.g. Corso Venezia), not an interior street of the zone.
      return !other.tags.name || !continuesOutside(other.tags.name, ring);
    });
  areas.push({
    id: `ztl-${slug(way.tags.name.replace(/^ZTL:?\s*/i, ""))}`,
    name: way.tags.name.replace(/^ZTL:\s*/i, "ZTL "),
    kind: "polygon",
    // The polygon's own tags are its rule (here motor_vehicle=no, all day, authorised categories excepted).
    rules: MOTOR_KEYS.filter((key) => way.tags[key]).map((key) => `${key}=${way.tags[key]}`),
    description: way.tags.description ?? null,
    hours: descriptionHours(way.tags.description) ?? "00:00-24:00",
    hoursSource: descriptionHours(way.tags.description) ? "description" : "tag",
    meters: Math.round(inside.reduce((sum, other) => sum + lengthOf(coords(other)), 0)),
    bbox: [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))].map((v) => Number(v.toFixed(6))),
    polygon: ring.map(([x, y]) => [Number(x.toFixed(7)), Number(y.toFixed(7))]),
    polygonWayId: way.id,
    wayIds: inside.map((other) => other.id).sort((a, b) => a - b),
    streets: [...new Set(inside.map((other) => other.tags.name).filter(Boolean))].slice(0, 12),
    evidence: [`mapped polygon way ${way.id} "${way.tags.name}"`],
  });
}
// ZTL gates mapped as enforcement relations ("Controllo elettronico degli accessi alla zona a
// traffico limitato", "Varco ZTL"): the street past each gate ("to") is inside, up to the next
// gate's approach ("from") along the same street. Hours are not in the data: the zone is treated
// as always active, and the app says so.
const nodeWays = new Map();
for (const way of ways.values()) if (DRIVABLE.test(way.tags?.highway ?? "")) for (const id of way.nodes) (nodeWays.get(id) ?? nodeWays.set(id, []).get(id)).push(way);
const gates = [...relations.values()].filter((relation) => relation.tags?.type === "enforcement" && relation.tags.enforcement === "access"
  && /zona a traffico limitato|\bZ\.?T\.?L\b/i.test(relation.tags.description ?? ""));
const gateFrom = new Set(gates.flatMap((gate) => gate.members.filter((m) => m.role === "from").map((m) => m.ref)));
const gateAreas = [];
for (const gate of gates) {
  const to = gate.members.find((m) => m.role === "to")?.ref;
  const device = gate.members.find((m) => m.role === "device")?.ref;
  if (!to || !nodeWays.has(to)) continue;
  const inside = new Set();
  const queue = [];
  // The gate stands on one street: follow that street past it ("to"), not the side streets that
  // happen to meet at the same node. With no "from", the street is the one through "to" and the device.
  const from = gate.members.find((m) => m.role === "from")?.ref;
  const gateStreets = new Set((from ? nodeWays.get(from) ?? [] : (nodeWays.get(to) ?? []).filter((way) => way.nodes.includes(device) || true))
    .map((way) => way.tags.name).filter(Boolean));
  for (const way of nodeWays.get(to)) {
    if (from && way.nodes.includes(from)) continue; // the approach, outside the zone
    if (gateStreets.size && !gateStreets.has(way.tags.name)) continue;
    queue.push({ way, name: way.tags.name });
  }
  while (queue.length && inside.size < 40) {
    const { way, name } = queue.shift();
    if (inside.has(way.id) || (name && way.tags.name !== name)) continue;
    inside.add(way.id);
    for (const id of way.nodes) {
      if (gateFrom.has(id) && id !== to) continue; // another gate's approach: the zone ends here
      for (const next of nodeWays.get(id) ?? []) if (!inside.has(next.id) && next.tags.name === name) queue.push({ way: next, name });
    }
  }
  if (inside.size) gateAreas.push({ gate, device, inside });
}
// Gates whose streets overlap form one zone.
const merged = [];
for (const entry of gateAreas) {
  const target = merged.find((zone) => [...entry.inside].some((id) => zone.inside.has(id)));
  if (target) { for (const id of entry.inside) target.inside.add(id); target.gates.push(entry.gate.id); }
  else merged.push({ inside: new Set(entry.inside), gates: [entry.gate.id], description: entry.gate.tags.description });
}
for (const zone of merged) {
  // A gate on a zone already found from its tags (e.g. the Navigli evening ZTL) adds evidence to it.
  const existing = areas.find((area) => area.kind !== "polygon" && area.wayIds.some((id) => zone.inside.has(id)));
  if (existing) {
    existing.evidence.push(...zone.gates.map((id) => `enforcement relation ${id} "${relations.get(id).tags.description}"`));
    continue;
  }
  const zoneWays = [...zone.inside].map((id) => ways.get(id));
  const names = [...new Set(zoneWays.map((way) => way.tags.name).filter(Boolean))];
  const xs = zoneWays.flatMap((way) => coords(way).map((p) => p[0]));
  const ys = zoneWays.flatMap((way) => coords(way).map((p) => p[1]));
  areas.push({
    id: `ztl-${slug(names[0] ?? `varco-${zone.gates[0]}`)}`,
    name: `ZTL ${names.slice(0, 2).join(", ")}`,
    kind: "gated",
    rules: ["varco ZTL a controllo elettronico; orari non presenti nei dati"],
    description: zone.description,
    meters: Math.round(zoneWays.reduce((sum, way) => sum + lengthOf(coords(way)), 0)),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Number(v.toFixed(6))),
    wayIds: [...zone.inside].sort((a, b) => a - b),
    streets: names,
    evidence: zone.gates.map((id) => `enforcement relation ${id} "${relations.get(id).tags.description}"`),
  });
}
areas.sort((a, b) => b.meters - a.meters);
// Ids must be unique.
const seen = new Map();
for (const area of areas) { const n = (seen.get(area.id) ?? 0) + 1; seen.set(area.id, n); if (n > 1) area.id = `${area.id}-${n}`; }

const out = {
  schema: "lastrico-ztl-areas",
  version: 1,
  area: "milan",
  generatedBy: "scripts/osm/extract-ztl-areas.mjs",
  source: { licence: "© OpenStreetMap contributors, ODbL 1.0", files },
  method: "Rule ways (permit/residents or time-window access on motor-vehicle keys) grouped within 60 m; mapped 'ZTL:' polygons. No official perimeters are in the data.",
  areas,
  /** Timed closures without ZTL evidence: enforced at their hours, never authorisable. */
  timedClosures,
  unsupported: { commentOnlyWays: commentOnly.length, examples: commentOnly.slice(0, 20).map((way) => ({ id: way.id, name: way.name, comment: way.comment })) },
};
writeFileSync(new URL("data/features/milan-ztl-areas.json", root), JSON.stringify(out) + "\n");
console.log(JSON.stringify({ areas: areas.length, ruleWays: ruleWays.length, commentOnly: commentOnly.length, timedClosures: timedClosures.length,
  list: areas.map((a) => `${a.id} | ${a.name} | ${a.kind} | ${a.meters} m | ${a.wayIds.length} ways | ${a.evidence.join(" + ")}`) }, null, 1));
