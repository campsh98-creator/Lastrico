/**
 * Phase 4.35: builds the Milan street-name index the address search uses while the person types.
 * Deterministic: the same snapshot gives the same bytes (checked by tests/phase435-street-index).
 *
 *   node scripts/osm/build-milan-street-index.mjs [--check]
 *
 * Input: data/sources/milan-street-names.osm.json.gz (scripts/osm/fetch-milan-street-names.mjs).
 * Output: public/data/milan-streets-v1.json, served as a static asset (no Worker CPU, no provider
 * call), and public/data/milan-streets-v1.manifest.json (provenance, counts, checksum).
 *
 * One entry per street: OSM splits a street into many ways; ways sharing a name are grouped when
 * they lie within GROUP_GAP_METERS of each other, so two distant streets with the same name stay
 * two entries. The point of an entry is a real node of the street, the one nearest the middle of
 * its nodes, so it never falls on a neighbouring street. The second line is the nearest named
 * quarter (OSM place=quarter/neighbourhood/suburb), a hint rather than an administrative fact.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SNAPSHOT = resolve(repo, "data/sources/milan-street-names.osm.json.gz");
export const SNAPSHOT_MANIFEST = resolve(repo, "data/sources/milan-street-names.source.json");
export const INDEX = resolve(repo, "public/data/milan-streets-v1.json");
export const INDEX_MANIFEST = resolve(repo, "public/data/milan-streets-v1.manifest.json");

// Comune di Milano with a margin. A way outside it is broken geometry, not a Milan street.
const MILAN_BOUNDS = { west: 9.04, south: 45.38, east: 9.31, north: 45.55 };
const GROUP_GAP_METERS = 400;
const QUARTER_MAX_METERS = 2_500;

// Road class → rank, lower is more prominent. Ways that are not a destination are left out.
const RANK = {
  motorway: 4, trunk: 1, primary: 0, secondary: 1, tertiary: 2, unclassified: 3, residential: 3,
  living_street: 3, pedestrian: 2, busway: 4, road: 3, service: 4,
  motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5,
  footway: 5, cycleway: 5, path: 5, track: 5, bridleway: 5,
};
const EXCLUDED = new Set(["platform", "construction", "proposed", "steps", "elevator", "corridor", "services", "rest_area", "bus_stop", "raceway", "abandoned", "razed"]);
const VARIANT_TAGS = ["alt_name", "official_name", "old_name", "short_name", "loc_name"];

// Paths, platforms and service ways are often named after a stop or a crossing ("Viale Monza Via
// Erodoto", "Via dei Missaglia - Via Baroni", "Cadorna M1 M2", "Via dei Missaglia (Isola Anita)"):
// not a street a person searches for. Real roads keep their name whatever it looks like.
const MINOR = new Set(["footway", "cycleway", "path", "service", "track", "bridleway"]);
const STREET_WORD = "(?:via|viale|piazza|piazzale|piazzetta|corso|largo|vicolo|strada|alzaia|ripa|bastioni)";
const CROSSING_NAME = new RegExp(`\\b${STREET_WORD}\\b.*\\b${STREET_WORD}\\b|\\s[-–]\\s|,|\\(|^stazione\\b|\\bM[1-5]\\b`, "i");
const BARE_TYPE = new RegExp(`^${STREET_WORD}$`, "i");

export function isSearchableName(name, highway) {
  if (BARE_TYPE.test(name.trim())) return false;
  return !(MINOR.has(highway) && CROSSING_NAME.test(name));
}

const metersBetween = ([lon1, lat1], [lon2, lat2]) => {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180) * 111_320;
  const y = (lat2 - lat1) * 110_540;
  return Math.hypot(x, y);
};

const inMilan = ([lon, lat]) => lon >= MILAN_BOUNDS.west && lon <= MILAN_BOUNDS.east && lat >= MILAN_BOUNDS.south && lat <= MILAN_BOUNDS.north;

function bbox(points) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/** Gap between two boxes in metres (0 when they touch or overlap). */
function boxGapMeters(a, b) {
  const lat = (a.south + a.north + b.south + b.north) / 4;
  const dx = Math.max(0, a.west - b.east, b.west - a.east) * Math.cos(lat * Math.PI / 180) * 111_320;
  const dy = Math.max(0, a.south - b.north, b.south - a.north) * 110_540;
  return Math.hypot(dx, dy);
}

const splitNames = (value) => (value ?? "").split(";").map((part) => part.trim()).filter(Boolean);

/** Snapshot → index document. Pure, so tests can run it on a fixture. */
export function buildStreetIndex(snapshot, { osmBase = null } = {}) {
  const groups = new Map();
  for (const way of snapshot.ways) {
    const highway = way.tags.highway;
    if (!highway || EXCLUDED.has(highway) || !(highway in RANK)) continue;
    const name = way.tags.name.trim();
    if (!name || !isSearchableName(name, highway)) continue;
    const points = way.geometry.filter(inMilan);
    if (points.length === 0 || points.length < way.geometry.length / 2) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ id: way.id, rank: RANK[highway], points, box: bbox(points), variants: VARIANT_TAGS.flatMap((tag) => splitNames(way.tags[tag])) });
  }

  // Quarters: quarter and neighbourhood names describe a street better than a whole suburb.
  const places = snapshot.places
    .filter((place) => inMilan(place.coordinate))
    .map((place) => ({ name: place.tags.name, coordinate: place.coordinate, weight: place.tags.place === "suburb" ? 1.35 : 1 }))
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.coordinate[0] - b.coordinate[0]);
  const quarterNames = [...new Set(places.map((place) => place.name))].sort((a, b) => a.localeCompare(b, "it"));
  const quarterIndex = new Map(quarterNames.map((name, index) => [name, index]));

  const streets = [];
  for (const [name, ways] of groups) {
    // Single-link grouping of the ways of one name.
    ways.sort((a, b) => a.id - b.id);
    const parent = ways.map((_, index) => index);
    const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    for (let i = 0; i < ways.length; i += 1) {
      for (let j = i + 1; j < ways.length; j += 1) {
        if (boxGapMeters(ways[i].box, ways[j].box) <= GROUP_GAP_METERS) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map();
    ways.forEach((way, index) => {
      const root = find(index);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(way);
    });
    for (const cluster of clusters.values()) {
      const nodes = cluster.flatMap((way) => way.points);
      const middle = [nodes.reduce((sum, [lon]) => sum + lon, 0) / nodes.length, nodes.reduce((sum, [, lat]) => sum + lat, 0) / nodes.length];
      let point = nodes[0];
      let best = Infinity;
      for (const node of nodes) {
        const distance = metersBetween(node, middle);
        if (distance < best || (distance === best && (node[0] < point[0] || (node[0] === point[0] && node[1] < point[1])))) {
          best = distance;
          point = node;
        }
      }
      let quarter = -1;
      let quarterDistance = Infinity;
      for (const place of places) {
        const distance = metersBetween(place.coordinate, point) * place.weight;
        if (distance < quarterDistance) {
          quarterDistance = distance;
          quarter = quarterIndex.get(place.name);
        }
      }
      if (quarterDistance > QUARTER_MAX_METERS) quarter = -1;
      const box = bbox(nodes);
      const lengthMeters = Math.round(Math.max(metersBetween([box.west, box.south], [box.east, box.north]), 1));
      const variants = [...new Set(cluster.flatMap((way) => way.variants))].filter((variant) => variant !== name).sort((a, b) => a.localeCompare(b, "it"));
      streets.push([name, Number(point[0].toFixed(6)), Number(point[1].toFixed(6)), quarter, Math.min(...cluster.map((way) => way.rank)), Math.min(lengthMeters, 65_000), variants.join("|")]);
    }
  }
  streets.sort((a, b) => a[0].localeCompare(b[0], "it") || a[1] - b[1] || a[2] - b[2]);
  return {
    version: 1,
    area: "milan",
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    osmBase,
    // Each street: [name, longitude, latitude, quarter index or -1, road rank 0–5, extent m, variants "a|b"].
    fields: ["name", "lon", "lat", "quarter", "rank", "extentMeters", "variants"],
    quarters: quarterNames,
    streets,
  };
}

export function serialiseIndex(index) {
  return `${JSON.stringify(index)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sourceManifest = JSON.parse(readFileSync(SNAPSHOT_MANIFEST, "utf8"));
  const gz = readFileSync(SNAPSHOT);
  const raw = gunzipSync(gz);
  const sha = createHash("sha256").update(raw).digest("hex");
  if (sha !== sourceManifest.sha256) throw new Error(`Snapshot checksum ${sha} does not match its manifest ${sourceManifest.sha256}`);
  const snapshot = JSON.parse(raw.toString("utf8"));
  const index = buildStreetIndex(snapshot, { osmBase: sourceManifest.osmBase });
  const text = serialiseIndex(index);
  const indexSha = createHash("sha256").update(text).digest("hex");
  const manifest = `${JSON.stringify({
    schemaVersion: "1.0.0",
    file: "milan-streets-v1.json",
    sha256: indexSha,
    bytes: Buffer.byteLength(text),
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    source: { file: "data/sources/milan-street-names.osm.json.gz", sha256: sourceManifest.sha256, osmBase: sourceManifest.osmBase, retrievedAt: sourceManifest.retrievedAt },
    counts: { streets: index.streets.length, distinctNames: new Set(index.streets.map((street) => street[0])).size, quarters: index.quarters.length, withVariants: index.streets.filter((street) => street[6]).length },
    method: "scripts/osm/build-milan-street-index.mjs (deterministic)",
  }, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const current = readFileSync(INDEX, "utf8");
    if (current !== text) throw new Error("public/data/milan-streets-v1.json is not what the snapshot builds; run the script without --check");
    console.log(`OK: index matches the snapshot (${index.streets.length} streets, sha256 ${indexSha})`);
  } else {
    mkdirSync(dirname(INDEX), { recursive: true });
    writeFileSync(INDEX, text);
    writeFileSync(INDEX_MANIFEST, manifest);
    console.log(`Wrote ${index.streets.length} streets (${Buffer.byteLength(text)} bytes, sha256 ${indexSha}).`);
  }
}
