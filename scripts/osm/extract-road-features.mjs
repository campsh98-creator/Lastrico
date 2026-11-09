/**
 * Phase 4.31 — traffic signals, stop and give-way signs from the checksummed central-Milan OSM
 * archives already in the repository (OSM API 0.6 map responses, 26–28 Oct 2026). No network.
 *
 * Kept: nodes on a road way tagged highway=traffic_signals, highway=stop, highway=give_way, and
 * signal-controlled crossings (crossing=traffic_signals) more than 40 m from any traffic signal,
 * i.e. mid-block pedestrian lights a driver must stop at. Nothing is inferred.
 * The citywide archives carry no node tags, so coverage is the 11 central boxes only.
 *
 *   node scripts/osm/extract-road-features.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const root = new URL("../../", import.meta.url);
const provenance = JSON.parse(await readFile(new URL("data/sources/milan-pilot-osm.source.json", root), "utf8"));
const ROAD = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|cycleway|busway)$/;
const TYPES = ["traffic_signals", "crossing_signals", "stop", "give_way"];

const nodes = new Map();
const roadNodeWays = new Map();
const roadWays = new Map();
for (const source of provenance.sources) {
  // The provenance hashes the API response itself, i.e. the uncompressed JSON.
  const raw = gunzipSync(await readFile(new URL(`data/sources/${source.file}`, root)));
  const sha = createHash("sha256").update(raw).digest("hex");
  if (sha !== source.sha256) throw new Error(`${source.file}: sha256 ${sha} does not match provenance`);
  const { elements } = JSON.parse(raw);
  for (const element of elements) {
    if (element.type === "node") nodes.set(element.id, element);
    else if (element.type === "way" && ROAD.test(element.tags?.highway ?? "")) {
      roadWays.set(element.id, element);
      for (const id of new Set(element.nodes)) {
        const ways = roadNodeWays.get(id) ?? new Set();
        ways.add(element.id);
        roadNodeWays.set(id, ways);
      }
    }
  }
}

const meters = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6_371_000;
};
const onRoad = [...nodes.values()].filter((node) => roadNodeWays.has(node.id) && node.tags);
const signals = onRoad.filter((node) => node.tags.highway === "traffic_signals");
const features = [];
const counts = Object.fromEntries(TYPES.map((type) => [type, 0]));
const isJunction = (id) => (roadNodeWays.get(id)?.size ?? 0) > 1;
/**
 * The junction a stop or give-way sign guards: the nearest junction node within 25 m along its
 * way, in the tagged direction when there is one (forward = towards the way's end). The app
 * shows the sign only on a route that passes the sign and then that junction.
 */
function guardedJunction(node) {
  const direction = node.tags.direction;
  let best = null;
  for (const wayId of roadNodeWays.get(node.id)) {
    const way = roadWays.get(wayId);
    const at = way.nodes.indexOf(node.id);
    for (const step of direction === "forward" ? [1] : direction === "backward" ? [-1] : [1, -1]) {
      let walked = 0;
      for (let i = at + step; i >= 0 && i < way.nodes.length; i += step) {
        const previous = nodes.get(way.nodes[i - step]);
        const current = nodes.get(way.nodes[i]);
        if (!previous || !current) break;
        walked += meters(previous, current);
        if (walked > 25) break;
        if (isJunction(current.id)) {
          if (!best || walked < best.walked) best = { walked, node: current };
          break;
        }
      }
    }
  }
  return best?.node ?? null;
}
const round = (value) => Number(value.toFixed(7));
let unattributedSigns = 0;
const add = (node, type) => {
  const sign = type === "stop" || type === "give_way";
  // A sign on a junction node, or with no junction close by, cannot be tied to one approach.
  const junction = sign && !isJunction(node.id) ? guardedJunction(node) : null;
  if (sign && !junction) {
    unattributedSigns += 1;
    return;
  }
  counts[type] += 1;
  features.push([round(node.lon), round(node.lat), TYPES.indexOf(type), junction ? round(junction.lon) : 0, junction ? round(junction.lat) : 0, node.id]);
};
for (const node of signals) add(node, "traffic_signals");
let crossingsNearSignals = 0;
for (const node of onRoad) {
  const { highway, crossing } = node.tags;
  if (highway === "stop") add(node, "stop");
  else if (highway === "give_way") add(node, "give_way");
  else if (crossing === "traffic_signals" && highway !== "traffic_signals") {
    if (signals.some((signal) => meters(signal, node) <= 40)) crossingsNearSignals += 1;
    else add(node, "crossing_signals");
  }
}
features.sort((a, b) => a[5] - b[5]);

const out = {
  schema: "lastrico-road-features",
  version: 1,
  area: "milan",
  generatedBy: "scripts/osm/extract-road-features.mjs",
  source: {
    provider: provenance.provider,
    licence: "© OpenStreetMap contributors, ODbL 1.0",
    provenance: "data/sources/milan-pilot-osm.source.json",
    files: provenance.sources.map(({ file, sha256, retrievedAt }) => ({ file, sha256, retrievedAt })),
  },
  /** Only these boxes were read: outside them the app shows no features and says so. */
  coverage: provenance.sources.map((source) => source.bbox),
  types: TYPES,
  counts: { ...counts, signalControlledCrossingsWithin40mOfASignal: crossingsNearSignals, signsNotTiedToOneApproach: unattributedSigns },
  /** [lon, lat, type index, guarded junction lon, lat (signs only, else 0, 0), OSM node id] */
  features,
};
await mkdir(new URL("data/features/", root), { recursive: true });
await writeFile(new URL("data/features/milan-road-features.json", root), JSON.stringify(out) + "\n");
console.log(JSON.stringify({ ...out.counts, total: features.length, boxes: out.coverage.length }));
