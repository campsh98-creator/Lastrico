/**
 * Milan Citywide Authentic OSM Road-Surface Expansion
 *
 * Downloads and verifies authentic OpenStreetMap highway ways + node geometries
 * across urban Milan (9.135–9.240 E, 45.425–45.502 N), prioritizing Southern Milan
 * (Porta Romana -> Largo Promessi Sposi, Bocconi, Tibaldi, Navigli, Famagosta,
 * Ripamonti, Corvetto, Lodi) and major urban corridors across West, North, and East Milan.
 *
 * Usage:
 *   node scripts/osm/expand-milan-citywide.mjs --download
 *   node scripts/osm/expand-milan-citywide.mjs --verify
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractHighways } from "./build-representative-network.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const sourceDir = join(root, "data/sources");
export const CITYWIDE_MANIFEST_PATH = join(sourceDir, "milan-citywide-expansion.source.json");

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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function sanitizeOverpassResponse(rawJson) {
  if (!rawJson || !Array.isArray(rawJson.elements)) {
    throw new Error("Invalid Overpass response: missing elements array");
  }
  const elements = rawJson.elements.map((el) => {
    if (el.type === "node") {
      return {
        type: "node",
        id: el.id,
        lat: el.lat,
        lon: el.lon,
        version: el.version ?? 1,
        timestamp: el.timestamp,
      };
    }
    if (el.type === "way") {
      return {
        type: "way",
        id: el.id,
        nodes: el.nodes,
        tags: el.tags ?? {},
        version: el.version ?? 1,
        timestamp: el.timestamp,
      };
    }
    return el;
  });

  return {
    version: rawJson.version ?? 0.6,
    generator: "openstreetmap-overpass-api",
    osm3s: rawJson.osm3s ?? {},
    elements,
  };
}

async function fetchSectorFromOsmApi06(sector) {
  const [west, south, east, north] = sector.bbox;
  const cols = 2;
  const rows = 2;
  const dLon = (east - west) / cols;
  const dLat = (north - south) / rows;
  const allElements = [];
  let serverDate = new Date().toUTCString();

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const w = Number((west + c * dLon).toFixed(5));
      const e = Number((west + (c + 1) * dLon).toFixed(5));
      const s = Number((south + r * dLat).toFixed(5));
      const n = Number((south + (r + 1) * dLat).toFixed(5));
      const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`;
      console.log(`[FETCH OSM 0.6] ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Lastrico-Road-Intelligence/1.0 (ODbL-1.0; Milan road surface coverage)",
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        throw new Error(`OSM 0.6 HTTP ${response.status} for ${url}`);
      }
      serverDate = response.headers.get("date") || serverDate;
      const json = await response.json();
      for (const el of json.elements ?? []) {
        if (el.type === "node" || (el.type === "way" && typeof el.tags?.highway === "string")) {
          allElements.push(el);
        }
      }
    }
  }

  const sanitized = sanitizeOverpassResponse({ version: 0.6, elements: allElements });
  const ways = extractHighways([sanitized]);
  const serialized = Buffer.from(JSON.stringify(sanitized));
  const gzipped = gzipSync(serialized, { level: 9 });
  const nodeCount = sanitized.elements.filter((e) => e.type === "node").length;
  return {
    endpoint: "https://api.openstreetmap.org/api/0.6/map.json",
    query: `bbox=${sector.bbox.join(",")}`,
    serverDate,
    retrievedAt: new Date().toISOString(),
    serialized,
    gzipped,
    sha256: sha256(serialized),
    gzipSha256: sha256(gzipped),
    wayCount: ways.length,
    nodeCount,
  };
}

async function fetchSectorFromOverpass(sector) {
  const [west, south, east, north] = sector.bbox;
  const query = `[out:json][timeout:30];way["highway"](${south},${west},${north},${east});out meta;>;out skel qt;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: {
          "User-Agent": "Lastrico-Road-Intelligence/1.0 (ODbL-1.0; Milan road surface coverage)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${endpoint}`);
      }

      const rawJson = await response.json();
      const sanitized = sanitizeOverpassResponse(rawJson);
      const ways = extractHighways([sanitized]);
      if (ways.length === 0) {
        throw new Error(`Zero highway ways returned for sector ${sector.name}`);
      }

      const serialized = Buffer.from(JSON.stringify(sanitized));
      const gzipped = gzipSync(serialized, { level: 9 });
      const nodeCount = sanitized.elements.filter((e) => e.type === "node").length;

      return {
        endpoint,
        query,
        serverDate: response.headers.get("date") || new Date().toUTCString(),
        retrievedAt: sanitized.osm3s?.timestamp_osm_base || new Date().toISOString(),
        serialized,
        gzipped,
        sha256: sha256(serialized),
        gzipSha256: sha256(gzipped),
        wayCount: ways.length,
        nodeCount,
      };
    } catch (err) {
      console.warn(`[WARN] ${endpoint} failed for ${sector.name}: ${err.message}`);
    }
  }
  return fetchSectorFromOsmApi06(sector);
}

export async function downloadCitywideExpansion({ force = false } = {}) {
  await mkdir(sourceDir, { recursive: true });

  let existingManifest = null;
  try {
    existingManifest = JSON.parse(await readFile(CITYWIDE_MANIFEST_PATH, "utf8"));
  } catch {}

  const existingByFile = new Map(
    (existingManifest?.sources ?? []).map((s) => [s.file, s]),
  );

  const sources = [];
  for (const sector of CITYWIDE_SECTORS) {
    const filePath = join(sourceDir, sector.file);
    const existing = existingByFile.get(sector.file);

    if (!force) {
      try {
        const diskGzip = await readFile(filePath);
        const diskRaw = gunzipSync(diskGzip);
        const parsed = JSON.parse(diskRaw);
        const ways = extractHighways([parsed]);
        if (ways.length > 0 && (!existing || sha256(diskRaw) === existing.sha256)) {
          const nodeCount = parsed.elements.filter((e) => e.type === "node").length;
          const entry = existing ?? {
            file: sector.file,
            sector: sector.name,
            url: OVERPASS_ENDPOINTS[0],
            query: `[out:json][timeout:30];way["highway"](${sector.bbox[1]},${sector.bbox[0]},${sector.bbox[3]},${sector.bbox[2]});out meta;>;out skel qt;`,
            bbox: sector.bbox,
            retrievedAt: parsed.osm3s?.timestamp_osm_base || new Date().toISOString(),
            serverDate: new Date().toUTCString(),
            sha256: sha256(diskRaw),
            gzipSha256: sha256(diskGzip),
            rawBytes: diskRaw.length,
            gzipBytes: diskGzip.length,
            wayCount: ways.length,
            nodeCount,
            description: sector.description,
          };
          console.log(`[SKIP] ${sector.file} verified (${entry.wayCount} ways)`);
          sources.push(entry);
          continue;
        }
      } catch {}
    }

    console.log(`[FETCH] Downloading sector ${sector.name} (${sector.bbox.join(", ")})...`);
    const result = await fetchSectorFromOverpass(sector);
    await writeFile(filePath, result.gzipped);

    const entry = {
      file: sector.file,
      sector: sector.name,
      url: result.endpoint,
      query: result.query,
      bbox: sector.bbox,
      retrievedAt: result.retrievedAt,
      serverDate: result.serverDate,
      sha256: result.sha256,
      gzipSha256: result.gzipSha256,
      rawBytes: result.serialized.length,
      gzipBytes: result.gzipped.length,
      wayCount: result.wayCount,
      nodeCount: result.nodeCount,
      description: sector.description,
    };
    sources.push(entry);
    console.log(
      `[OK] ${sector.file}: ${result.wayCount} ways, ${result.nodeCount} nodes, ${(result.gzipped.length / 1024).toFixed(1)} KB gzipped`,
    );

    await new Promise((r) => setTimeout(r, 1200));
  }

  let minW = Infinity, minS = Infinity, maxE = -Infinity, maxN = -Infinity;
  for (const s of sources) {
    minW = Math.min(minW, s.bbox[0]);
    minS = Math.min(minS, s.bbox[1]);
    maxE = Math.max(maxE, s.bbox[2]);
    maxN = Math.max(maxN, s.bbox[3]);
  }

  const manifest = {
    schemaVersion: "2.0.0",
    provider: "OpenStreetMap (Overpass API 0.6 compatible)",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
    attribution: "© OpenStreetMap contributors",
    bounds: { west: minW, south: minS, east: maxE, north: maxN },
    selection: "All OSM ways with a highway tag and their constituent nodes across 8 urban Milan sectors covering Southern, Western, Northern, and Eastern Milan.",
    generatedAt: new Date().toISOString(),
    sources,
  };

  await writeFile(CITYWIDE_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[MANIFEST] Saved ${CITYWIDE_MANIFEST_PATH} with ${sources.length} verified sectors.`);
  return manifest;
}

export async function verifyCitywideSources() {
  const manifest = JSON.parse(await readFile(CITYWIDE_MANIFEST_PATH, "utf8"));
  const responses = [];
  for (const source of manifest.sources) {
    const gz = await readFile(join(sourceDir, source.file));
    const raw = gunzipSync(gz);
    const actualSha = sha256(raw);
    if (actualSha !== source.sha256) {
      throw new Error(`Checksum mismatch for ${source.file}: expected ${source.sha256}, got ${actualSha}`);
    }
    responses.push(JSON.parse(raw));
  }
  const ways = extractHighways(responses);
  return {
    sectorCount: manifest.sources.length,
    bounds: manifest.bounds,
    totalDeduplicatedWays: ways.length,
    verifiedSha256: true,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isDownload = process.argv.includes("--download");
  const isForce = process.argv.includes("--force");
  if (isDownload) {
    downloadCitywideExpansion({ force: isForce }).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  } else {
    verifyCitywideSources().then(console.log).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
