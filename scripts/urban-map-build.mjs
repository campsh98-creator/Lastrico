/**
 * Builds the Phase 4.41 public ODbL extract from repository snapshots, offline.
 * Run with: node scripts/urban-map-build.mjs
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const sourceRoot = new URL("../data/sources/", import.meta.url);
const output = new URL("../public/urban-map/v1/", import.meta.url);
const cellSize = 0.02;
const manifests = {
  milan: [["milan-pilot-osm", true], ["milan-citywide-expansion", false]],
  roccella: [["roccella-pilot-osm", true]],
  rome: [["rome-osm", false]],
};
const road = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|.*_link)$/;
const poiAmenities = {
  pharmacy: "pharmacy", restaurant: "restaurant", fuel: "fuel", parking: "parking",
  charging_station: "charging", hospital: "hospital", school: "school", bus_station: "station",
  townhall: "public_facility", library: "public_facility", courthouse: "public_facility",
  fire_station: "public_facility", police: "public_facility", post_office: "public_facility",
  community_centre: "public_facility", public_building: "public_facility",
};
const roadPoint = { traffic_signals: "signal", stop: "stop", give_way: "give_way", crossing: "crossing" };
const streetCategories = new Set(["signal", "stop", "give_way", "crossing", "sign", "speed"]);

const round = (number) => Number(number.toFixed(7));
const coordinate = (node) => [round(node.lon), round(node.lat)];
const midpoint = (a, b) => [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
const cell = ([lon, lat]) => `${Math.floor(lon / cellSize)}_${Math.floor(lat / cellSize)}`;
const within = ([lon, lat], [west, south, east, north]) =>
  lon >= west && lon <= east && lat >= south && lat <= north;
const radians = Math.PI / 180;
const localVector = (a, b) => [(b[0] - a[0]) * Math.cos((a[1] + b[1]) * radians / 2), b[1] - a[1]];
const meters = (a, b) => Math.hypot(...localVector(a, b)) * 111_195;
const bearing = (a, b) => {
  const [east, north] = localVector(a, b);
  return (Math.round(Math.atan2(east, north) / radians) + 360) % 360;
};
const text = (value) => typeof value === "string" ? value.trim().slice(0, 120) : "";
const osmId = (element) => `${element.type}/${element.id}`;
const feature = (element, category, position) => ({
  id: `${osmId(element)}:${category}`, osm: osmId(element), category, coordinate: position,
});

function poiCategory(tags) {
  if (Object.hasOwn(poiAmenities, tags.amenity)) return poiAmenities[tags.amenity];
  if (tags.healthcare === "hospital" || tags.healthcare === "pharmacy") return tags.healthcare;
  if (tags.aeroway === "aerodrome" && tags.aerodrome !== "private" && tags.access !== "private") return "airport";
  if (["station", "halt"].includes(tags.railway) || tags.public_transport === "station") return "station";
  if (tags.leisure === "park") return "park";
  if (tags.shop === "supermarket") return "supermarket";
  if (tags.shop && !/^(no|vacant|closed|disused|abandoned|empty|yes)$/.test(tags.shop)) return "shop";
}

/** Retain one representative point for a mapped area; it is not an entrance. */
function pointFor(element, nodes, ways) {
  if (element.type === "node") return coordinate(element);
  const rings = element.type === "way" ? [element.nodes] : (element.members ?? [])
    .filter((member) => member.type === "way" && member.role === "outer")
    .map((member) => ways.get(member.ref)?.nodes);
  const points = rings.flatMap((ring) => (ring ?? []).map((id) => nodes.get(id)).filter(Boolean).map(coordinate));
  if (!points.length) return null;
  const extent = points.reduce(([west, south, east, north], [lon, lat]) => [
    Math.min(west, lon), Math.min(south, lat), Math.max(east, lon), Math.max(north, lat),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  return midpoint(extent.slice(0, 2), extent.slice(2));
}

function validSpeed(value) {
  // OSM uses km/h by default. Preserve an explicitly tagged mph value as mph.
  if (typeof value !== "string" || !/^[1-9]\d{0,2}(?: ?(?:km\/h|mph))?$/.test(value)) return null;
  const match = value.match(/^(\d+)(?: ?(mph|km\/h))?$/);
  return `${match[1]} ${match[2] ?? "km/h"}`;
}

function speedValues(tags) {
  // A variable or conditional limit is not a reliable unconditional display value.
  if (Object.entries(tags).some(([key, value]) =>
    /^maxspeed(?::(?:forward|backward))?:(?:conditional|variable)$/.test(key) && value !== "no")) return [];
  if (tags["maxspeed:type"] === "variable") return [];
  const base = validSpeed(tags.maxspeed);
  const forward = tags["maxspeed:forward"] === undefined ? base : validSpeed(tags["maxspeed:forward"]);
  const backward = tags["maxspeed:backward"] === undefined ? base : validSpeed(tags["maxspeed:backward"]);
  if (tags.oneway === "-1") return backward ? [[backward, -1]] : [];
  if (["yes", "1", "true"].includes(tags.oneway) || tags.junction === "roundabout" && tags.oneway !== "no") {
    return forward ? [[forward, 1]] : [];
  }
  if (forward && forward === backward) return [[forward, 0]];
  return [[forward, 1], [backward, -1]].filter(([value]) => value);
}

function directionalBearing(node, direction, links, nodes) {
  const incident = links.get(node.id);
  if (!incident || incident.length !== 1 || !["forward", "backward"].includes(direction)) return undefined;
  const way = incident[0];
  const at = way.nodes.indexOf(node.id);
  const before = nodes.get(way.nodes[at - 1]);
  const after = nodes.get(way.nodes[at + 1]);
  const [from, to] = direction === "forward" ? [before, node] : [after, node];
  // Incoming geometry establishes the approach. Terminal nodes on its opposite end are ambiguous.
  return from && meters(coordinate(from), coordinate(to)) > 0 ? bearing(coordinate(from), coordinate(to)) : undefined;
}

function explicitSign(value) {
  const tag = text(value);
  if (!tag || /^(no|none|unknown|IT|IT:Nome strada)$/i.test(tag)) return null;
  return tag === "yes" ? "" : tag;
}

function addRoadNode(add, element, tags, position, links, nodes) {
  const setDirection = (item, direction) => {
    if (!direction || direction === "both") return;
    const degrees = directionalBearing(element, direction, links, nodes);
    if (degrees === undefined) item.directionUncertain = true;
    else item.bearing = degrees;
  };
  const type = Object.hasOwn(roadPoint, tags.highway) && roadPoint[tags.highway];
  if (type && !(type === "crossing" && tags.crossing === "no")) {
    const direction = type === "signal" ? tags["traffic_signals:direction"] ?? tags.direction : tags.direction;
    const next = feature(element, type, position);
    setDirection(next, direction);
    add(next);
  }
  for (const [key, direction, variant] of [
    ["traffic_sign", tags["traffic_sign:direction"] ?? tags.direction, ""],
    ["traffic_sign:forward", "forward", ":forward"],
    ["traffic_sign:backward", "backward", ":backward"],
  ]) {
    const code = explicitSign(tags[key]);
    if (code === null || type && (!code || code === tags.highway)) continue;
    const limit = validSpeed(tags.maxspeed);
    const sign = feature(element, limit && code === "maxspeed" ? "speed" : "sign", position);
    sign.id += variant;
    if (code) sign.detail = code === "maxspeed" && limit ? limit : code;
    setDirection(sign, direction);
    add(sign);
  }
}

function speedSegments(element, nodes, boxes) {
  // At most one representative road segment per way and tile. The endpoint pair is preserved
  // so a consumer can check the actual alignment instead of treating this as a physical sign.
  const segments = new Map();
  for (let index = 1; index < element.nodes.length; index += 1) {
    const first = nodes.get(element.nodes[index - 1]);
    const second = nodes.get(element.nodes[index]);
    if (!first || !second) continue;
    const segment = [coordinate(first), coordinate(second)];
    const position = midpoint(...segment);
    const length = meters(...segment);
    if (length < 2 || !boxes.some((box) => within(position, box))) continue;
    const tile = cell(position);
    if (length > (segments.get(tile)?.length ?? 0)) segments.set(tile, { segment, position, length });
  }
  return segments;
}

function roadSegmentSigns(tags) {
  return [
    [explicitSign(tags.traffic_sign), 0],
    [explicitSign(tags["traffic_sign:forward"]), 1],
    [explicitSign(tags["traffic_sign:backward"]), -1],
  ].filter(([code]) => code && code !== "maxspeed");
}

async function readArea(sets) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  const elementSets = { node: nodes, way: ways, relation: relations };
  const pointElements = new Set();
  const taggedRoadNodes = new Set();
  const pointBoxes = [];
  const roadBoxes = [];
  const provenance = [];
  for (const [id, full] of sets) {
    const manifest = `${id}.source.json`;
    const { provider, sources } = JSON.parse(await readFile(new URL(manifest, sourceRoot), "utf8"));
    for (const source of sources) {
      const raw = gunzipSync(await readFile(new URL(source.file, sourceRoot)));
      if (createHash("sha256").update(raw).digest("hex") !== source.sha256) {
        throw new Error(`OSM integrity check failed for ${source.file}`);
      }
      const { elements } = JSON.parse(raw);
      provenance.push({ manifest, provider, file: source.file, sha256: source.sha256,
        retrievedAt: source.retrievedAt, bbox: source.bbox, osmBaseTimestamp: source.osmBaseTimestamp });
      roadBoxes.push(source.bbox);
      if (full) pointBoxes.push(source.bbox);
      for (const element of elements) {
        const map = elementSets[element.type];
        if (!map || !full && element.type === "relation") continue;
        const current = map.get(element.id);
        // Tagged, versioned API nodes take precedence over Overpass skeleton copies.
        if (!current || (element.version ?? 0) > (current.version ?? 0)) map.set(element.id, element);
        if (!full || !element.tags) continue;
        if (poiCategory(element.tags)) pointElements.add(osmId(element));
        if (element.type === "node") taggedRoadNodes.add(element.id);
      }
    }
  }
  return { nodes, ways, relations, pointElements, taggedRoadNodes, pointBoxes, roadBoxes, provenance };
}

function dropDuplicatePois(features) {
  const indices = new Map();
  return features.filter((entry) => {
    const key = entry.name && `${entry.category}:${entry.name.toLocaleLowerCase("it")}`;
    if (!key) return true;
    const seen = indices.get(key) ?? [];
    // Keep genuinely separate locations from repeated chains. Cross-type deduplication
    // handles typical OSM double mapping (point and area for the same place).
    if (seen.some((prior) => prior.osm.split("/")[0] !== entry.osm.split("/")[0] &&
      meters(prior.coordinate, entry.coordinate) < 22)) return false;
    seen.push(entry);
    indices.set(key, seen);
    return true;
  });
}

const result = [];
const counts = {};
const pointBoxes = [];
const roadBoxes = [];
const provenance = [];
for (const [area, sets] of Object.entries(manifests)) {
  const extract = await readArea(sets);
  pointBoxes.push(...extract.pointBoxes);
  roadBoxes.push(...extract.roadBoxes);
  provenance.push(...extract.provenance);
  const { nodes, ways, relations, taggedRoadNodes } = extract;
  const features = [];
  const add = (next) => features.push(next);
  const links = new Map();
  for (const element of ways.values()) {
    const tags = element.tags;
    if (!tags || !road.test(tags.highway ?? "") || tags.area === "yes") continue;
    for (const id of new Set(element.nodes)) {
      if (!taggedRoadNodes.has(id)) continue;
      const incident = links.get(id) ?? [];
      incident.push(element);
      links.set(id, incident);
    }
    const limits = speedValues(tags);
    const signs = roadSegmentSigns(tags);
    if (!limits.length && !signs.length) continue;
    for (const [tile, { segment, position }] of speedSegments(element, nodes, extract.roadBoxes)) {
      for (const [category, entries] of [["speed", limits], ["sign", signs]]) {
        for (const [value, direction] of entries) {
          const next = feature(element, category, position);
          next.id += `:${tile}:${direction}`;
          next.detail = value;
          next.segment = segment;
          if (direction) next.bearing = bearing(...(direction > 0 ? segment : [...segment].reverse()));
          add(next);
        }
      }
    }
  }
  for (const id of taggedRoadNodes) {
    const element = nodes.get(id);
    if (!element.tags || !extract.pointBoxes.some((box) => within(coordinate(element), box))) continue;
    addRoadNode(add, element, element.tags, coordinate(element), links, nodes);
  }
  const pois = [];
  for (const id of extract.pointElements) {
    const [type, number] = id.split("/");
    const element = ({ node: nodes, way: ways, relation: relations })[type].get(Number(number));
    const tags = element.tags;
    if (!tags) continue;
    const category = poiCategory(tags);
    const position = category && pointFor(element, nodes, ways);
    if (!position || !extract.pointBoxes.some((box) => within(position, box))) continue;
    const next = feature(element, category, position);
    const name = text(tags["name:it"] ?? tags.name ?? tags.brand ?? tags.operator);
    const address = [text(tags["addr:street"]), text(tags["addr:housenumber"])].filter(Boolean).join(" ");
    if (name) next.name = name;
    if (address) next.detail = address;
    pois.push(next);
  }
  features.push(...dropDuplicatePois(pois.sort((a, b) => a.osm.localeCompare(b.osm, "en"))));
  counts[area] = {};
  for (const item of features) counts[area][item.category] = (counts[area][item.category] ?? 0) + 1;
  result.push(...features);
}

const tiles = { places: new Map(), street: new Map() };
for (const item of result.sort((a, b) => a.id.localeCompare(b.id, "en"))) {
  const group = tiles[streetCategories.has(item.category) ? "street" : "places"];
  const tile = cell(item.coordinate);
  const entries = group.get(tile) ?? [];
  entries.push(item);
  group.set(tile, entries);
}
await mkdir(output, { recursive: true });
await Promise.all(Object.entries(tiles).flatMap(([group, groupTiles]) =>
  [...groupTiles].map(([tile, entries]) => writeFile(new URL(`${group}_${tile}.json`, output), JSON.stringify(entries) + "\n"))));
await writeFile(new URL("manifest.json", output), JSON.stringify({
  version: 1, cellSize, attribution: "© OpenStreetMap contributors",
  copyright: "https://www.openstreetmap.org/copyright", license: "ODbL-1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
  tiles: Object.fromEntries(Object.entries(tiles).map(([group, groupTiles]) => [group, [...groupTiles.keys()].sort()])),
  pointBoxes, roadBoxes, counts, provenance,
}, null, 2) + "\n");
console.log(JSON.stringify({ counts, tiles: { places: tiles.places.size, street: tiles.street.size }, features: result.length }));
