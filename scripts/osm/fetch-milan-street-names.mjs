/**
 * Phase 4.35: downloads the OpenStreetMap snapshot the Milan street-name index is built from.
 *
 *   node scripts/osm/fetch-milan-street-names.mjs            # writes data/sources/milan-street-names.*
 *   node scripts/osm/build-milan-street-index.mjs            # deterministic: snapshot → public index
 *
 * One Overpass query, run by hand when the index is refreshed (never by the app, never in CI):
 * every named way with a `highway` tag inside the administrative boundary of the Comune di Milano
 * (admin_level 8), with its geometry, plus the named quarters (place=suburb/quarter/neighbourhood,
 * with their position) used only for the grey second line of a suggestion. Overpass public instances ask for occasional, light use; the script backs off on
 * 429/5xx and stops after a bounded number of attempts.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0. The snapshot keeps only the tags the index needs.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAPSHOT = resolve(repo, "data/sources/milan-street-names.osm.json.gz");
const MANIFEST = resolve(repo, "data/sources/milan-street-names.source.json");
const USER_AGENT = "Lastrico-Road-Intelligence/1.0 (ODbL-1.0; Milan street-name index; +https://github.com/campsh98-creator/Lastrico)";

export const OVERPASS_QUERY = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="8"]["name"="Milano"]->.comune;
way(area.comune)["highway"]["name"];
out tags geom qt;
node(area.comune)["place"~"^(suburb|quarter|neighbourhood)$"]["name"];
out qt;`;

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Only these tags reach the snapshot: names and the road class that ranks a suggestion.
const KEPT_TAGS = ["name", "alt_name", "official_name", "old_name", "short_name", "loc_name", "highway", "place"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const round = (value) => Math.round(value * 1e7) / 1e7;

function keepTags(tags = {}) {
  return Object.fromEntries(KEPT_TAGS.filter((key) => typeof tags[key] === "string").map((key) => [key, tags[key]]));
}

/** Overpass JSON → the minimal, stable snapshot (sorted by type and id, coordinates at 1e-7°). */
export function normaliseOverpass(raw) {
  if (!raw || !Array.isArray(raw.elements)) throw new Error("Invalid Overpass response: no elements array");
  const ways = [];
  const places = [];
  for (const element of raw.elements) {
    if (element.type === "way" && Array.isArray(element.geometry) && element.tags?.name) {
      ways.push({ id: element.id, tags: keepTags(element.tags), geometry: element.geometry.map(({ lon, lat }) => [round(lon), round(lat)]) });
    } else if (element.type === "node" && element.tags?.name && Number.isFinite(element.lon) && Number.isFinite(element.lat)) {
      places.push({ id: element.id, tags: keepTags(element.tags), coordinate: [round(element.lon), round(element.lat)] });
    }
  }
  const byId = (a, b) => a.id - b.id;
  return { ways: ways.sort(byId), places: places.sort(byId) };
}

async function download() {
  let wait = 20_000;
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: OVERPASS_QUERY }),
        signal: AbortSignal.timeout(200_000),
      });
      const text = await response.text();
      if (response.ok && text.trimStart().startsWith("{")) {
        const raw = JSON.parse(text);
        if (raw.remark && /runtime error|timed out/i.test(raw.remark)) throw new Error(`Overpass remark: ${raw.remark}`);
        return { raw, text, endpoint, serverDate: response.headers.get("date") };
      }
      console.warn(`[attempt ${attempt}] ${endpoint}: HTTP ${response.status}`);
    } catch (error) {
      console.warn(`[attempt ${attempt}] ${endpoint}: ${error?.message ?? error}`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 240_000);
  }
  throw new Error("Overpass did not answer after 9 attempts; try again later");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { raw, text, endpoint, serverDate } = await download();
  const snapshot = normaliseOverpass(raw);
  const serialised = JSON.stringify({
    generator: "lastrico-milan-street-names",
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    osmBase: raw.osm3s?.timestamp_osm_base ?? null,
    ...snapshot,
  });
  const gzipped = gzipSync(Buffer.from(serialised), { level: 9, mtime: 0 });
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, gzipped);
  writeFileSync(MANIFEST, `${JSON.stringify({
    schemaVersion: "1.0.0",
    provider: "OpenStreetMap via Overpass API",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
    attribution: "© OpenStreetMap contributors",
    selection: "Named highway ways inside the Comune di Milano (admin_level 8), with geometry; named suburb/quarter/neighbourhood nodes, with position.",
    query: OVERPASS_QUERY,
    endpoint,
    retrievedAt: new Date().toISOString(),
    serverDate,
    osmBase: raw.osm3s?.timestamp_osm_base ?? null,
    rawSha256: sha256(Buffer.from(text)),
    rawBytes: Buffer.byteLength(text),
    file: "milan-street-names.osm.json.gz",
    sha256: sha256(Buffer.from(serialised)),
    gzipSha256: sha256(gzipped),
    gzipBytes: gzipped.length,
    counts: { ways: snapshot.ways.length, places: snapshot.places.length },
  }, null, 2)}\n`);
  console.log(`Saved ${snapshot.ways.length} ways and ${snapshot.places.length} places from ${endpoint} (${gzipped.length} bytes gzip).`);
}
