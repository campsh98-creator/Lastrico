/**
 * Verify the checked-in Milan OSM sectors, or extract one named sector to a local directory.
 *   node scripts/osm/expand-milan-citywide.mjs --verify
 *   node scripts/osm/expand-milan-citywide.mjs --sector s-east --cache response.json --output-dir .cache/osm
 *   node scripts/osm/expand-milan-citywide.mjs --sector s-east --download --output-dir .cache/osm
 */
import { mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  RAILWAY_LIFECYCLE_KEYS, RAILWAY_ROUTE_VALUES, RAILWAY_VALUES, sanitizeOsmResponse, sha256, summarizeOsmExtract,
} from "./osm-extraction.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir = join(root, "data/sources");
const manifestName = "milan-citywide-expansion.source.json";
export const CITYWIDE_MANIFEST_PATH = join(sourceDir, manifestName);
const endpoint = "https://overpass-api.de/api/interpreter";

export const CITYWIDE_SECTORS = [
  {
    name: "s-central",
    file: "milan-citywide-s-central.osm.json.gz",
    bbox: [9.170, 45.425, 9.205, 45.455],
    description: "Southern Milan Central (Porta Romana, Porta Lodovica, Bocconi, Tibaldi, Largo Promessi Sposi, Viale Toscana, Ripamonti, Vigentino)",
  },
  {
    name: "s-west",
    file: "milan-citywide-s-west.osm.json.gz",
    bbox: [9.135, 45.425, 9.170, 45.455],
    description: "Southern Milan West (Naviglio Pavese, Naviglio Grande, Porta Ticinese, Romolo, Famagosta, Barona, Giambellino)",
  },
  {
    name: "s-east",
    file: "milan-citywide-s-east.osm.json.gz",
    bbox: [9.205, 45.425, 9.240, 45.455],
    description: "Southern Milan East (Lodi TIBB, Fondazione Prada, Brenta, Corvetto, Corso Lodi, Calvairate)",
  },
  {
    name: "west",
    file: "milan-citywide-west.osm.json.gz",
    bbox: [9.135, 45.450, 9.175, 45.480],
    description: "Western Milan (Porta Genova, Tortona, Solari, Washington, Wagner, De Angeli, Pagano, Bande Nere, CityLife South)",
  },
  {
    name: "east",
    file: "milan-citywide-east.osm.json.gz",
    bbox: [9.200, 45.450, 9.240, 45.480],
    description: "Eastern Milan (Cinque Giornate, Premuda, Tricolore, Porta Vittoria, Corso XXII Marzo, Dateo, Indipendenza, Città Studi South, Argonne)",
  },
  {
    name: "n-west",
    file: "milan-citywide-n-west.osm.json.gz",
    bbox: [9.135, 45.475, 9.175, 45.502],
    description: "North-Western Milan (Arco della Pace, Sempione, CityLife North, Portello, Cenisio, Ghisolfa, Bovisa)",
  },
  {
    name: "n-central",
    file: "milan-citywide-n-central.osm.json.gz",
    bbox: [9.169, 45.475, 9.210, 45.502],
    description: "Northern Milan Central (Arena, Sarpi, Porta Garibaldi, Isola, Monumentale, Farini, Maciachini, Melchiorre Gioia, Stazione Centrale)",
  },
  {
    name: "n-east",
    file: "milan-citywide-n-east.osm.json.gz",
    bbox: [9.210, 45.480, 9.240, 45.502],
    description: "North-Eastern Milan (Corso Buenos Aires, Loreto, Pasteur, NoLo, Città Studi / Politecnico, Piola, Lambrate)",
  },
];

export function buildCitywideSectorQuery([west, south, east, north]) {
  const bbox = `(${south},${west},${north},${east})`;
  const restriction = '["type"~"^restriction(:.*)?$"]';
  const route = `["type"="route"]["route"~"^(${RAILWAY_ROUTE_VALUES})$"]`;
  // Restriction members can extend beyond the box and still provide topology for
  // a junction inside it. Transit route members are references, not a network crawl.
  return [
    "[out:json][timeout:60];",
    `way["highway"]${bbox}->.roads;`,
    "(",
    ...["railway", ...RAILWAY_LIFECYCLE_KEYS].map((key) => `  way["${key}"~"^(${RAILWAY_VALUES})$"]${bbox};`),
    ")->.rails;",
    "(",
    `  node["highway"~"^(traffic_signals|stop|give_way|crossing|mini_roundabout|motorway_junction)$"]${bbox};`,
    `  node["railway"~"^(tram_stop|level_crossing|crossing|tram_crossing|switch|signal|station|halt)$"]${bbox};`,
    `  node["barrier"]${bbox};`,
    `  node["public_transport"]${bbox};`,
    `  node["traffic_calming"]${bbox};`,
    ")->.features;",
    `(rel${restriction}${bbox};rel(bw.roads)${restriction};)->.turns;`,
    `(rel(bw.rails)${route};rel(bn.features)${route};)->.transit;`,
    "(.roads;.roads >;.rails;.rails >;.features;.turns;.turns >;.transit;);",
    "out meta;",
  ].join("\n");
}

function getSector(name) {
  const sector = CITYWIDE_SECTORS.find((candidate) => candidate.name === name);
  if (!sector) throw new Error(`Choose one Milan sector: ${CITYWIDE_SECTORS.map((item) => item.name).join(", ")}`);
  return sector;
}

function rawBytes(bytes) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function withStagingDirectory(outputDir, action) {
  if (!outputDir) throw new Error("--output-dir is required for extraction");
  const stagingDir = resolve(outputDir);
  const publishedDir = await realpath(sourceDir);
  if (isWithin(publishedDir, stagingDir)) throw new Error("Choose an output directory outside the checked-in OSM sources");
  // Resolve the nearest existing ancestor before creating folders through symlinks.
  let ancestor = stagingDir;
  for (;;) {
    try {
      const realAncestor = await realpath(ancestor);
      if (isWithin(publishedDir, resolve(realAncestor, relative(ancestor, stagingDir)))) {
        throw new Error("Choose an output directory outside the checked-in OSM sources");
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      ancestor = dirname(ancestor);
    }
  }
  await mkdir(stagingDir, { recursive: true });
  const lockPath = join(stagingDir, ".extraction.lock");
  const lock = await open(lockPath, "wx");
  try {
    return await action(stagingDir);
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function writeAtomic(path, bytes) {
  const pending = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, bytes, { flag: "wx" });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function stageSector(outputDir, sector, bytes, capture = {}) {
  const input = rawBytes(bytes);
  const inputSha256 = sha256(input);
  if (capture.sha256 && capture.sha256 !== inputSha256) throw new Error("Cached response checksum mismatch");
  if (capture.status && capture.status !== 200) throw new Error(`Captured Overpass status ${capture.status}`);
  const raw = JSON.parse(input);
  const extracted = sanitizeOsmResponse(raw);
  const statistics = summarizeOsmExtract(extracted);
  const sectorQuery = capture.query === buildCitywideSectorQuery(sector.bbox);
  if (!statistics.highways || (sectorQuery && (
    statistics.missingWayGeometries || statistics.incompleteTurnRestrictions ||
    !extracted.osm3s.timestamp_osm_base ||
    Object.values(statistics.missingVersions).some(Boolean) ||
    extracted.elements.some((element) => !element.timestamp || !element.changeset)
  ))) throw new Error(`Incomplete OSM extract for ${sector.name}`);

  const serialized = Buffer.from(JSON.stringify(extracted));
  const compressed = gzipSync(serialized, { level: 9 });
  const digest = sha256(serialized);
  const file = `${sector.file.replace(".osm.json.gz", "")}.${digest}.osm.json.gz`;
  const source = {
    file,
    sector: sector.name,
    requestedSectorBbox: sector.bbox,
    bbox: sectorQuery ? sector.bbox : capture.bbox ?? null,
    coverage: sectorQuery ? "sector-query" : "cached-response",
    description: sector.description,
    url: capture.endpoint ?? capture.url ?? null,
    query: capture.query ?? null,
    querySha256: capture.query ? sha256(capture.query) : null,
    snapshotAt: extracted.osm3s.timestamp_osm_base,
    retrievedAt: capture.retrievedAt ?? null,
    requestedAt: capture.utc ?? null,
    serverDate: capture.serverDate ?? null,
    inputSha256,
    sha256: digest,
    gzipSha256: sha256(compressed),
    rawBytes: serialized.length,
    gzipBytes: compressed.length,
    wayCount: statistics.highways,
    nodeCount: statistics.nodes,
    statistics,
  };

  const path = join(outputDir, manifestName);
  const previous = await readManifest(path);
  if (previous && previous.schemaVersion !== "3.0.0") throw new Error("Use a staging directory with a version 3 extraction manifest");
  const sourceBySector = new Map((previous?.sources ?? []).map((item) => [item.sector, item]));
  sourceBySector.set(sector.name, source);
  const sources = CITYWIDE_SECTORS.map(({ name }) => sourceBySector.get(name)).filter(Boolean);
  const manifest = {
    schemaVersion: "3.0.0",
    provider: "OpenStreetMap via Overpass",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
    attribution: "© OpenStreetMap contributors",
    selection: "Highways, railway infrastructure, tagged nodes, turn restrictions and local railway route references.",
    completeSectorCoverage: CITYWIDE_SECTORS.every(({ name }) => sourceBySector.get(name)?.coverage === "sector-query"),
    sources,
  };

  // A failed fetch or write keeps the prior manifest and its named artifacts usable.
  await writeAtomic(join(outputDir, file), compressed);
  await writeAtomic(path, JSON.stringify(manifest, null, 2) + "\n");
  return { manifestPath: path, source };
}

export async function importCitywideSector({ sector: sectorName, outputDir, cachePath, capturePath } = {}) {
  const sector = getSector(sectorName);
  if (!cachePath) throw new Error("--cache is required for offline extraction");
  const [bytes, capture] = await Promise.all([
    readFile(cachePath),
    capturePath ? readFile(capturePath, "utf8").then(JSON.parse) : undefined,
  ]);
  return withStagingDirectory(outputDir, (dir) => stageSector(dir, sector, bytes, capture));
}

export async function downloadCitywideExpansion({ sector: sectorName, outputDir, fetchImpl = globalThis.fetch } = {}) {
  const sector = getSector(sectorName);
  return withStagingDirectory(outputDir, async (dir) => {
    const query = buildCitywideSectorQuery(sector.bbox);
    const receiptPath = join(dir, ".last-overpass-request.json");
    const receipt = await readManifest(receiptPath);
    if (Date.now() < (receipt?.nextRequestAfter ?? 0)) throw new Error("Wait before making another Overpass request");
    // Single request, explicit sector, no retry or fallback. Respect Retry-After.
    const utc = new Date().toISOString();
    await writeAtomic(receiptPath, JSON.stringify({ nextRequestAfter: Date.now() + 2_000 }));
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": "Lastrico-Road-Intelligence/1.0 (+https://github.com/campsh98-creator/Lastrico)",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryDate = retryAfter === null ? 0 : /^\d+$/.test(retryAfter)
        ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter) || 0;
      const minimumWait = [429, 504].includes(response.status) ? 60_000 : 2_000;
      await writeAtomic(receiptPath, JSON.stringify({ nextRequestAfter: Math.max(Date.now() + minimumWait, retryDate) }));
      throw new Error(`Overpass HTTP ${response.status} for ${sector.name}.${retryAfter ? ` Retry-After: ${retryAfter}` : ""}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return stageSector(dir, sector, bytes, {
      endpoint, query, utc, retrievedAt: new Date().toISOString(), serverDate: response.headers.get("date"),
    });
  });
}

export async function verifyCitywideSources({ directory = sourceDir } = {}) {
  const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  const legacy = manifest.schemaVersion === "2.0.0";
  if (!legacy && manifest.schemaVersion !== "3.0.0") throw new Error("Unsupported citywide source manifest");
  const wayIds = new Set();
  const sectors = new Set();
  const enrichedSectors = new Set();
  for (const source of manifest.sources) {
    const sector = getSector(source.sector);
    if (sectors.has(sector.name) || basename(source.file) !== source.file) throw new Error(`Invalid source in manifest: ${source.file}`);
    sectors.add(sector.name);
    const gz = await readFile(join(directory, source.file));
    if (source.gzipSha256 && sha256(gz) !== source.gzipSha256) throw new Error(`Gzip checksum mismatch for ${source.file}`);
    const raw = gunzipSync(gz);
    if (sha256(raw) !== source.sha256) throw new Error(`Checksum mismatch for ${source.file}`);
    const parsed = JSON.parse(raw);
    if (!legacy && (
      !["sector-query", "cached-response"].includes(source.coverage) ||
      JSON.stringify(source.requestedSectorBbox) !== JSON.stringify(sector.bbox) ||
      JSON.stringify(source.statistics) !== JSON.stringify(summarizeOsmExtract(parsed)) ||
      (source.query ? sha256(source.query) : null) !== source.querySha256 ||
      source.snapshotAt !== parsed.osm3s?.timestamp_osm_base ||
      (source.coverage === "sector-query" && (
        source.query !== buildCitywideSectorQuery(sector.bbox) ||
        JSON.stringify(source.bbox) !== JSON.stringify(sector.bbox)
      ))
    )) throw new Error(`Provenance mismatch for ${source.file}`);
    if (source.coverage === "sector-query") enrichedSectors.add(sector.name);
    for (const element of parsed.elements) if (element.type === "way" && element.tags?.highway) wayIds.add(element.id);
  }
  if (!legacy && manifest.completeSectorCoverage !== (enrichedSectors.size === CITYWIDE_SECTORS.length)) {
    throw new Error("Provenance mismatch for declared sector coverage");
  }
  return {
    sectorCount: manifest.sources.length,
    bounds: manifest.bounds ?? null,
    totalDeduplicatedWays: wayIds.size,
    verifiedSha256: true,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    download: { type: "boolean" }, verify: { type: "boolean" }, sector: { type: "string" },
    cache: { type: "string" }, capture: { type: "string" }, "output-dir": { type: "string" },
  } });
  const outputDir = values["output-dir"];
  if (values.download && values.cache || values.verify && (values.download || values.cache) ||
    values.capture && !values.cache || values.sector && !values.cache && !values.download) {
    throw new Error("Choose --verify, --download or --cache");
  }
  if (values.download) return downloadCitywideExpansion({ sector: values.sector, outputDir });
  if (values.cache) return importCitywideSector({
    sector: values.sector, outputDir, cachePath: values.cache, capturePath: values.capture,
  });
  return verifyCitywideSources({ directory: outputDir });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then(console.log).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
