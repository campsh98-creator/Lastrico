#!/usr/bin/env node
/**
 * First real check of the live-traffic integration, run once by the owner after creating the free TomTom key:
 *
 *   TOMTOM_API_KEY=... node scripts/traffic-live-check.mjs
 *
 * It spends TWO tile requests (one flow tile, one incident tile over central Milan), decodes them with the same reader
 * the Worker uses, and prints what the integration assumes: the layer names, the tags, the range of `traffic_level`, whether
 * both carriageways of a road appear as separate lines, and the provider's cache headers. The key is never printed.
 * Exit code 0 only if both tiles decode and the flow tile holds `traffic_level` values between 0 and 1.
 */
import { decodeMvt } from "../lib/traffic/mvt.ts";
import { tileForCoordinate } from "../lib/traffic/tiles.ts";
import { tileUrl } from "../worker/traffic-hub.ts";

const key = process.env.TOMTOM_API_KEY;
if (!key) {
  console.error("Set TOMTOM_API_KEY first (free TomTom developer key, no card needed).");
  process.exit(2);
}

const DUOMO = [9.1919, 45.4641];
const failures = [];

async function fetchTile(kind, zoom) {
  const tile = tileForCoordinate(DUOMO, zoom);
  const response = await fetch(tileUrl(kind, tile.z, tile.x, tile.y, key), { headers: { Accept: "application/x-protobuf" } });
  const headers = Object.fromEntries(["cache-control", "etag", "content-type"].map((name) => [name, response.headers.get(name)]));
  console.log(`${kind} tile ${tile.z}/${tile.x}/${tile.y}: HTTP ${response.status}`, headers);
  if (!response.ok) { failures.push(`${kind}: HTTP ${response.status}`); return null; }
  const bytes = new Uint8Array(await response.arrayBuffer());
  console.log(`  ${bytes.length} bytes`);
  try { return decodeMvt(bytes); } catch (error) { failures.push(`${kind}: tile not readable (${error.message})`); return null; }
}

const flow = await fetchTile("flow", 14);
if (flow) {
  const layer = flow.layers["Traffic flow"];
  if (!layer) failures.push(`flow: no "Traffic flow" layer (layers: ${Object.keys(flow.layers).join(", ")})`);
  else {
    const levels = layer.features.map((f) => f.properties.traffic_level).filter((v) => typeof v === "number");
    const tags = new Set(layer.features.flatMap((f) => Object.keys(f.properties)));
    console.log(`  features ${layer.features.length}, parts ${layer.features.reduce((n, f) => n + f.parts.length, 0)}, extent ${layer.extent}`);
    console.log(`  tags: ${[...tags].join(", ")}`);
    if (levels.length) console.log(`  traffic_level min ${Math.min(...levels)} max ${Math.max(...levels)} (relative: expected 0..1)`);
    console.log(`  road_closure features: ${layer.features.filter((f) => f.properties.road_closure === true).length}`);
    if (!levels.length || Math.max(...levels) > 1.0001 || Math.min(...levels) < 0) failures.push("flow: traffic_level is missing or outside 0..1");
    // Direction check: a two-way road should show up as lines in opposite directions with the same endpoints.
    const lines = layer.features.flatMap((f) => f.parts.map((part) => part));
    const key2 = (p) => `${Math.round(p[0] / 8)},${Math.round(p[1] / 8)}`;
    const ends = new Set(lines.map((part) => `${key2(part[0])}>${key2(part.at(-1))}`));
    const paired = lines.filter((part) => ends.has(`${key2(part.at(-1))}>${key2(part[0])}`)).length;
    console.log(`  lines with a reversed twin (separate carriageways): ${paired} of ${lines.length}`);
  }
}

const incidents = await fetchTile("incidents", 12);
if (incidents) {
  for (const [name, layer] of Object.entries(incidents.layers)) {
    console.log(`  layer "${name}": ${layer.features.length} features`);
    const sample = layer.features[0]?.properties;
    if (sample) console.log("   first:", JSON.stringify(sample).slice(0, 240));
  }
}

if (failures.length) {
  console.error("\nCHECK FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("\nOK: both tiles decode; flow values are in range. Compare the lines above with the assumptions in outputs/traffic-provider-decision.md.");
