/**
 * Phase 4.34 — offline audit of central-Milan traffic signals, stop and give-way signs, one-way
 * streets, turn restrictions and conditional access rules.
 *
 * Inputs are files already in the repository, never the network:
 *   - data/features/milan-road-features.json (scripts/osm/extract-road-features.mjs)
 *   - the checksummed OSM API 0.6 archives it was built from (data/sources/milan-pilot-*.osm.json.gz,
 *     provenance in data/sources/milan-pilot-osm.source.json)
 *   - lib/road-features.ts (matching distances), lib/access-conditions.ts (conditional parser),
 *     data/features/milan-ztl-areas.json (context only)
 *   - optionally the archived FOSSGIS Valhalla responses in outputs/phase425-benchmark/responses/
 *
 * Every finding is "suspicious, to check on site": OpenStreetMap is not ground truth and nothing
 * here has been verified physically. Output is deterministic (sorted, no clock): the only date is
 * the newest retrievedAt of the OSM sources.
 *
 *   node scripts/audit-milan-intersections.mjs [--out=outputs/phase434]
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConditional } from "../lib/access-conditions.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TYPES = ["traffic_signals", "crossing_signals", "stop", "give_way"];

/** Audit-only thresholds (the app's own distances are read from lib/road-features.ts). */
export const AUDIT = {
  /** Two mapped signals or signs of one kind this close on one way are likely one object mapped twice. */
  DUPLICATE_METERS: 5,
  /** Findings this close are reported as one site to visit. */
  SITE_GROUP_METERS: 20,
  /** Distance walked along a way from the via node to measure a turn angle. */
  TURN_PROBE_METERS: 10,
  /** A provider route vertex is an OSM node when it lies this close (polyline6 rounding is ~0.1 m). */
  NODE_MATCH_METERS: 0.3,
  /** Search radius for the nearest carriageway. */
  CARRIAGEWAY_SEARCH_METERS: 60,
  RANK_LIMIT: 40,
};

/** Car-capable highway classes (the extractor also accepts service, cycleway and busway). */
const CARRIAGEWAY = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "road",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
]);
const FOOT = new Set(["footway", "pedestrian", "path", "steps", "corridor", "platform", "bridleway", "elevator"]);
export function wayClass(highway) {
  if (CARRIAGEWAY.has(highway)) return "carriageway";
  if (highway === "service") return "service";
  if (highway === "busway") return "busway";
  if (highway === "cycleway") return "cycleway";
  if (FOOT.has(highway)) return "foot";
  return "other";
}
const VEHICLE_CLASSES = new Set(["carriageway", "service", "busway"]);
const APP_ACCESS_KEYS = ["access", "vehicle", "motor_vehicle", "motorcar", "motorcycle", "bicycle"];
const STANDARD_RESTRICTION = /^(no|only)_(left_turn|right_turn|straight_on|u_turn|entry|exit)$/;
const MODE_IT = { car: "auto", motorcycle: "moto", bicycle: "bici" };
const COSTING_MODE = { auto: "car", motorcycle: "motorcycle", bicycle: "bicycle" };
const EXEMPT_KEYS = { car: ["motorcar", "motor_vehicle", "vehicle"], motorcycle: ["motorcycle", "motor_vehicle", "vehicle"], bicycle: ["bicycle", "vehicle"] };
const RESTRICTION_IT = {
  no_left_turn: "divieto di svolta a sinistra", no_right_turn: "divieto di svolta a destra",
  no_straight_on: "divieto di proseguire diritto", no_u_turn: "divieto di inversione a U",
  only_left_turn: "obbligo di svolta a sinistra", only_right_turn: "obbligo di svolta a destra",
  only_straight_on: "obbligo di proseguire diritto", no_entry: "divieto di accesso", no_exit: "divieto di uscita",
};

/**
 * Reason codes: weight (sum per site gives the rank) and the one-line Italian note for the visit.
 * Weights favour what changes what a person sees or is routed through.
 */
export const REASONS = {
  PROVENANCE_MISMATCH: { weight: 10, note: "Verificare quale segnale esiste davvero: il dato dell'app non corrisponde all'archivio OSM." },
  ARCHIVED_ROUTE_TRAVERSES_RESTRICTION: { weight: 9, note: "Verificare il cartello di svolta: un percorso archiviato del provider esegue la manovra che OSM vieta." },
  ARCHIVED_ROUTE_TRAVERSES_TIMED_RESTRICTION: { weight: 6, note: "Leggere gli orari sul cartello di svolta: percorsi archiviati del provider (richieste senza orario) eseguono la manovra che OSM vieta in certe ore." },
  RESTRICTION_VALUE_MALFORMED: { weight: 7, note: "Verificare cartello e orari della manovra: il valore OSM non è leggibile dai navigatori." },
  RESTRICTION_ONLY_EXIT_AGAINST_ONEWAY: { weight: 6, note: "Verificare l'obbligo di svolta: l'unica uscita indicata in OSM è contromano per le auto." },
  RESTRICTION_GEOMETRY_MISMATCH: { weight: 6, note: "Verificare il cartello di svolta: il tipo in OSM non corrisponde alla forma dell'incrocio." },
  RESTRICTION_VIA_NOT_ON_MEMBER: { weight: 6, note: "Verificare la manovra regolata: in OSM il nodo dell'incrocio non appartiene alle strade indicate." },
  SIGNAL_ON_CYCLEWAY_NEAR_CARRIAGEWAY: { weight: 6, note: "Verificare se il semaforo vale solo per la ciclabile o anche per le auto sulla carreggiata accanto." },
  SIGN_JUNCTION_UPSTREAM_ON_ONEWAY: { weight: 6, note: "Verificare verso quale incrocio guarda il cartello: senza direzione OSM l'app lo lega all'incrocio alle spalle del senso unico." },
  SIGN_DIRECTION_AGAINST_ONEWAY: { weight: 5, note: "Verificare per quale senso di marcia è il cartello: in OSM è rivolto contro il senso unico." },
  SIGNAL_DIRECTION_AGAINST_ONEWAY: { weight: 5, note: "Verificare per quale senso di marcia è il semaforo: in OSM è rivolto contro il senso unico." },
  SIGNAL_NOT_ON_ROAD_WAY: { weight: 5, note: "Verificare se qui c'è un semaforo veicolare e su quale carreggiata: in OSM il nodo non è su nessuna strada." },
  SIGNAL_ON_TRAM_TRACK_ONLY: { weight: 3, note: "Verificare se il semaforo vale solo per i tram o anche per i veicoli sulla carreggiata: in OSM è solo sul binario." },
  SIGNAL_ONLY_ON_FOOTWAY: { weight: 4, note: "Verificare se il semaforo regola anche i veicoli o solo il percorso pedonale su cui è mappato." },
  CONDITIONAL_NOT_PARSED: { weight: 5, note: "Leggere sul cartello orari e categorie della regola: l'app non sa interpretare questa condizione OSM." },
  ONEWAY_DATED_KEY_CONFLICT: { weight: 5, note: "Verificare il senso unico in vigore: OSM indica un'inversione datata che il tag principale non riporta." },
  CLASSIFICATION_CONFLICT: { weight: 5, note: "Verificare se all'incrocio c'è un semaforo, un cartello di stop/precedenza o entrambi." },
  DUPLICATE_SIGNAL: { weight: 4, note: "Contare semafori o cartelli reali: in OSM ci sono due nodi uguali a pochi metri sulla stessa strada." },
  SIGN_NO_DIRECTION_AMBIGUOUS: { weight: 4, note: "Verificare verso quale dei due incroci vicini è rivolto il cartello (manca la direzione in OSM)." },
  SIGN_NOT_TIED_TO_APPROACH: { weight: 4, note: "Verificare su quale ramo dell'incrocio è il cartello: in OSM è sul nodo dell'incrocio o lontano da incroci." },
  ONEWAY_HOURS_CONFLICT: { weight: 4, note: "Leggere l'orario del senso unico sul cartello: OSM riporta orari diversi in due tag." },
  SIGNALISED_CROSSING_NOT_IN_DATASET: { weight: 3, note: "Verificare se l'attraversamento pedonale ha un semaforo che ferma i veicoli." },
  CROSSING_SIGNALS_CONTRADICTION: { weight: 3, note: "Verificare se l'attraversamento è semaforizzato: i tag OSM si contraddicono." },
  CONDITIONAL_KEY_NOT_EVALUATED: { weight: 3, note: "Leggere orari e senso della regola sul cartello: l'app non la valuta, la applica solo il provider." },
  SIGNAL_ON_SERVICE_NEAR_CARRIAGEWAY: { weight: 3, note: "Verificare se il semaforo regola la strada di servizio o la carreggiata principale vicina." },
  MERGED_DISTINCT_JUNCTIONS: { weight: 3, note: "Verificare se sono due incroci semaforizzati distinti: l'app li mostra come un solo semaforo." },
  RESTRICTION_VIA_NOT_ENDPOINT: { weight: 3, note: "Verificare la manovra regolata: la relazione OSM è ambigua (strada non spezzata all'incrocio)." },
  RESTRICTION_INCOMPLETE: { weight: 3, note: "Verificare il divieto/obbligo di svolta: la relazione OSM è incompleta." },
  RESTRICTION_ON_NON_VEHICLE_WAY: { weight: 3, note: "Verificare la manovra: la relazione OSM coinvolge una strada non carrabile." },
  RESTRICTION_TIME_DEPENDENT: { weight: 2, note: "Leggere sul cartello gli orari del divieto/obbligo di svolta." },
  RESTRICTION_FROM_ONEWAY_AWAY: { weight: 2, note: "Verificare se il divieto riguarda solo bus o bici in controsenso: le auto non arrivano da quel lato." },
  CROSSING_LIGHT_AS_JUNCTION_SIGNAL: { weight: 2, note: "Verificare se è un semaforo pedonale o un semaforo d'incrocio." },
  SIGNAL_ONLY_ON_CYCLEWAY: { weight: 2, note: "Verificare che il semaforo esista e regoli solo la pista ciclabile." },
  SIGNAL_ONLY_ON_SERVICE_ROAD: { weight: 2, note: "Verificare che il semaforo esista sulla strada di servizio (accesso, parcheggio, controviale)." },
  SIGNAL_ONLY_ON_BUSWAY: { weight: 2, note: "Verificare se il semaforo vale solo per la sede riservata ai mezzi pubblici." },
  SIGN_NOT_ON_ROAD: { weight: 2, note: "Verificare se il cartello riguarda i veicoli: in OSM non è su una strada carrabile." },
  ONEWAY_KEY_MALFORMED: { weight: 2, note: "Verificare il senso di marcia in vigore: in OSM c'è un tag di senso unico non standard." },
  RESTRICTION_AT_SIGNALS: { weight: 1, note: "Verificare che la segnaletica di svolta dell'incrocio semaforizzato corrisponda a OSM." },
  SIGN_FAR_FROM_JUNCTION: { weight: 1, note: "Verificare la distanza tra il cartello e l'incrocio che regola." },
};

// ---------------------------------------------------------------- small helpers

const RAD = Math.PI / 180;
/** Same equirectangular formula as scripts/osm/extract-road-features.mjs. */
export function meters(a, b) {
  const x = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.hypot(x, y) * 6_371_000;
}
function planar(p, origin) {
  return [(p.lon - origin.lon) * RAD * Math.cos(origin.lat * RAD) * 6_371_000, (p.lat - origin.lat) * RAD * 6_371_000];
}
function pointSegmentMeters(p, a, b) {
  const [ax, ay] = planar(a, p);
  const [bx, by] = planar(b, p);
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const round6 = (value) => Number(value.toFixed(6));
const round7 = (value) => Number(value.toFixed(7));
const round1 = (value) => Number(value.toFixed(1));
const coord = (node) => [round6(node.lon), round6(node.lat)];
const byNumber = (a, b) => a - b;
const sortedUnique = (values) => [...new Set(values)].sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b))));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const tally = (items, keyOf) => {
  const out = {};
  for (const item of items) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};
/** iCloud conflict copies ("name 2.json", "foo 3.bin") are never read. */
export const isConflictCopy = (name) => / [23](\.|$)/.test(path.basename(name));
export function inCoverage(coverage, lon, lat) {
  return coverage.some(([west, south, east, north]) => lon >= west && lon <= east && lat >= south && lat <= north);
}

/** JSON with keys sorted at every level, so reruns are byte-identical. */
export function stableStringify(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    return input;
  };
  return JSON.stringify(sort(value), null, 1) + "\n";
}

/** Valhalla shapes are encoded polylines with six decimals. Returns [lon, lat] pairs. */
export function decodePolyline6(text) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < text.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte;
      do {
        byte = text.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lon += delta;
    }
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}

// ---------------------------------------------------------------- constants read from the code

/** The app's matching distances, read from lib/road-features.ts so the audit cannot drift from it. */
export function readRoadFeatureConstants(sourceText) {
  const out = {};
  for (const name of ["SIGNAL_METERS", "SIGN_METERS", "JUNCTION_METERS", "SAME_JUNCTION_METERS"]) {
    const match = sourceText.match(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`));
    if (!match) throw new Error(`lib/road-features.ts: ${name} not found`);
    out[name] = Number(match[1]);
  }
  return out;
}

/** The extractor's road classes and distances, read from scripts/osm/extract-road-features.mjs. */
export function readExtractorConstants(sourceText) {
  const road = sourceText.match(/const ROAD = \/(.+)\/;/);
  const walk = sourceText.match(/walked > (\d+)\) break/);
  const crossing = sourceText.match(/meters\(signal, node\) <= (\d+)/);
  if (!road || !walk || !crossing) throw new Error("scripts/osm/extract-road-features.mjs: rules not found");
  return { ROAD: new RegExp(road[1]), roadPattern: road[1], SIGN_WALK_METERS: Number(walk[1]), CROSSING_NEAR_SIGNAL_METERS: Number(crossing[1]) };
}

// ---------------------------------------------------------------- loading (the only I/O)

export async function loadInputs(root = ROOT) {
  const at = (relative) => path.join(root, relative);
  const provenance = JSON.parse(await readFile(at("data/sources/milan-pilot-osm.source.json"), "utf8"));
  const sources = [];
  for (const source of provenance.sources) {
    // The provenance hashes the API response itself, i.e. the uncompressed JSON.
    const raw = gunzipSync(await readFile(at(`data/sources/${source.file}`)));
    sources.push({ file: source.file, bbox: source.bbox, retrievedAt: source.retrievedAt, expectedSha256: source.sha256, sha256: sha256(raw), elements: JSON.parse(raw).elements });
  }
  const featuresText = await readFile(at("data/features/milan-road-features.json"), "utf8");
  const ztlText = await readFile(at("data/features/milan-ztl-areas.json"), "utf8");
  return {
    provenance,
    sources,
    features: JSON.parse(featuresText),
    featuresSha256: sha256(featuresText),
    ztl: JSON.parse(ztlText),
    roadFeaturesConstants: readRoadFeatureConstants(await readFile(at("lib/road-features.ts"), "utf8")),
    extractorConstants: readExtractorConstants(await readFile(at("scripts/osm/extract-road-features.mjs"), "utf8")),
    archive: await loadArchive(at("outputs/phase425-benchmark/responses")),
  };
}

/** Archived provider responses (git-ignored; restored from provider-responses.tar.gz). */
export async function loadArchive(directory) {
  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json") && !isConflictCopy(name)).sort();
  } catch {
    return { present: false, directory: "outputs/phase425-benchmark/responses", routes: [], files: 0, bodyChecksumFailures: [], requestsWithDateTime: 0 };
  }
  const routes = [];
  const bodyChecksumFailures = [];
  let requestsWithDateTime = 0;
  for (const name of names) {
    const record = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    if (sha256(record.body) !== record.bodySha256) bodyChecksumFailures.push(name);
    if (record.status !== 200) continue;
    const request = JSON.parse(record.request.body);
    if (request.date_time) requestsWithDateTime += 1;
    const costing = request.costing;
    const body = JSON.parse(record.body);
    const trips = [body.trip, ...(body.alternates ?? []).map((alternate) => alternate.trip)].filter(Boolean);
    trips.forEach((trip, routeIndex) => routes.push({ key: record.key, routeIndex, costing, shapes: trip.legs.map((leg) => leg.shape) }));
  }
  return { present: names.length > 0, directory: "outputs/phase425-benchmark/responses", routes, files: names.length, bodyChecksumFailures, requestsWithDateTime };
}

// ---------------------------------------------------------------- the OSM model

/**
 * Elements of all source files, the newer file winning (same order and rule as the extractor),
 * plus the extractor's own road-way index, rebuilt exactly as it builds it.
 */
export function buildOsmModel(sources, extractorConstants) {
  const nodes = new Map(), ways = new Map(), relations = new Map();
  const versionConflicts = [];
  const occurrences = { node: 0, way: 0, relation: 0 };
  const roadWays = new Map();
  const roadNodeWays = new Map();
  for (const source of sources) {
    for (const element of source.elements) {
      const map = element.type === "node" ? nodes : element.type === "way" ? ways : relations;
      occurrences[element.type] += 1;
      const known = map.get(element.id);
      if (known && known.version !== element.version) versionConflicts.push({ type: element.type, id: element.id, versions: [known.version, element.version].sort(byNumber), keptVersion: element.version, file: source.file });
      map.set(element.id, element);
      if (element.type === "way" && extractorConstants.ROAD.test(element.tags?.highway ?? "")) {
        roadWays.set(element.id, element);
        for (const id of new Set(element.nodes)) {
          const set = roadNodeWays.get(id) ?? new Set();
          set.add(element.id);
          roadNodeWays.set(id, set);
        }
      }
    }
  }
  const highwayNodeWays = new Map();
  for (const way of ways.values()) {
    if (!way.tags?.highway) continue;
    for (const id of new Set(way.nodes)) {
      const list = highwayNodeWays.get(id) ?? [];
      list.push(way.id);
      highwayNodeWays.set(id, list);
    }
  }
  for (const list of highwayNodeWays.values()) list.sort(byNumber);
  versionConflicts.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  return { nodes, ways, relations, roadWays, roadNodeWays, highwayNodeWays, versionConflicts, occurrences };
}

/** Grid of carriageway segments for nearest-carriageway distances. */
function carriagewayGrid(model) {
  const CELL = 0.0005;
  const cells = new Map();
  for (const way of [...model.ways.values()].sort((a, b) => a.id - b.id)) {
    if (wayClass(way.tags?.highway) !== "carriageway") continue;
    for (let i = 1; i < way.nodes.length; i += 1) {
      const a = model.nodes.get(way.nodes[i - 1]);
      const b = model.nodes.get(way.nodes[i]);
      if (!a || !b) continue;
      for (let x = Math.floor(Math.min(a.lon, b.lon) / CELL); x <= Math.floor(Math.max(a.lon, b.lon) / CELL); x += 1) {
        for (let y = Math.floor(Math.min(a.lat, b.lat) / CELL); y <= Math.floor(Math.max(a.lat, b.lat) / CELL); y += 1) {
          const key = `${x}:${y}`;
          const list = cells.get(key) ?? [];
          list.push({ a, b, wayId: way.id });
          cells.set(key, list);
        }
      }
    }
  }
  return {
    nearest(point, excludeWays = new Set()) {
      const reach = Math.ceil((AUDIT.CARRIAGEWAY_SEARCH_METERS / 111_000) / CELL) + 1;
      const cx = Math.floor(point.lon / CELL), cy = Math.floor(point.lat / CELL);
      let best = null;
      for (let x = cx - reach; x <= cx + reach; x += 1) {
        for (let y = cy - reach; y <= cy + reach; y += 1) {
          for (const segment of cells.get(`${x}:${y}`) ?? []) {
            if (excludeWays.has(segment.wayId)) continue;
            const distance = pointSegmentMeters(point, segment.a, segment.b);
            if (distance <= AUDIT.CARRIAGEWAY_SEARCH_METERS && (!best || distance < best.distance || (distance === best.distance && segment.wayId < best.wayId))) best = { distance, wayId: segment.wayId };
          }
        }
      }
      return best;
    },
  };
}

function wayName(way) {
  return way?.tags?.name ?? null;
}
/** Names of the vehicle and cycle ways through a node (sorted). */
function nodeStreetNames(model, nodeId, classes = new Set(["carriageway", "service", "busway", "cycleway"])) {
  const names = [];
  for (const wayId of model.highwayNodeWays.get(nodeId) ?? []) {
    const way = model.ways.get(wayId);
    if (classes.has(wayClass(way.tags.highway)) && wayName(way)) names.push(wayName(way));
  }
  return sortedUnique(names);
}

/** How cars may travel along a way, as scripts/osm/normalize.mjs reads it ("unknown" = not enforced locally). */
export function carDirection(tags = {}) {
  const read = (value) => {
    const normalised = String(value).trim().toLowerCase();
    if (["no", "0", "false", ""].includes(normalised)) return "both";
    if (normalised === "-1") return "backward";
    if (["yes", "1", "true"].includes(normalised)) return "forward";
    return "unknown";
  };
  const oneway = (tags.oneway ?? (tags.junction === "roundabout" ? "yes" : "")).trim().toLowerCase();
  const reversed = oneway === "-1";
  for (const key of ["oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle"]) {
    if (tags[`${key}:conditional`]) return "unknown";
    if (tags[key] !== undefined) {
      const result = read(tags[key]);
      if (result === "unknown" || result === "both" || !reversed) return result;
      return result === "forward" ? "backward" : "forward";
    }
  }
  if (tags["oneway:conditional"]) return "unknown";
  return read(oneway);
}
const canTravel = (direction, step) => direction === "both" || direction === "unknown" || (direction === "forward" ? step === 1 : step === -1);
const bicycleContraflow = (tags = {}) => ["no", "0", "false"].includes(String(tags["oneway:bicycle"] ?? "").trim().toLowerCase())
  || ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"].some((key) => /^opposite/.test(tags[key] ?? ""));

// ---------------------------------------------------------------- the extractor, replicated

function junctionWalk(model, ex, node, steps) {
  const isJunction = (id) => (model.roadNodeWays.get(id)?.size ?? 0) > 1;
  const found = [];
  for (const wayId of model.roadNodeWays.get(node.id) ?? []) {
    const way = model.roadWays.get(wayId);
    const at = way.nodes.indexOf(node.id);
    for (const step of steps) {
      let walked = 0;
      for (let i = at + step; i >= 0 && i < way.nodes.length; i += step) {
        const previous = model.nodes.get(way.nodes[i - step]);
        const current = model.nodes.get(way.nodes[i]);
        if (!previous || !current) break;
        walked += meters(previous, current);
        if (walked > ex.SIGN_WALK_METERS) break;
        if (isJunction(current.id)) {
          found.push({ wayId, step, walked, node: current });
          break;
        }
      }
    }
  }
  return found;
}
/** The extractor's guardedJunction(): nearest junction along the way, in the tagged direction if any. */
function guardedJunction(model, ex, node) {
  const direction = node.tags.direction;
  const steps = direction === "forward" ? [1] : direction === "backward" ? [-1] : [1, -1];
  let best = null;
  for (const candidate of junctionWalk(model, ex, node, steps)) if (!best || candidate.walked < best.walked) best = candidate;
  return best;
}

/** Rebuilds data/features/milan-road-features.json from the raw archives with the extractor's rules. */
export function reproduceExtraction(model, ex) {
  const isJunction = (id) => (model.roadNodeWays.get(id)?.size ?? 0) > 1;
  const onRoad = [...model.nodes.values()].filter((node) => model.roadNodeWays.has(node.id) && node.tags);
  const signals = onRoad.filter((node) => node.tags.highway === "traffic_signals");
  const features = [];
  const counts = Object.fromEntries(TYPES.map((type) => [type, 0]));
  const notTied = [];
  const add = (node, type) => {
    const sign = type === "stop" || type === "give_way";
    const junction = sign && !isJunction(node.id) ? guardedJunction(model, ex, node)?.node ?? null : null;
    if (sign && !junction) {
      notTied.push({ id: node.id, type, reason: isJunction(node.id) ? "sign on the junction node itself" : `no junction within ${ex.SIGN_WALK_METERS} m along its way${node.tags.direction ? ` (direction=${node.tags.direction})` : ""}` });
      return;
    }
    counts[type] += 1;
    features.push([round7(node.lon), round7(node.lat), TYPES.indexOf(type), junction ? round7(junction.lon) : 0, junction ? round7(junction.lat) : 0, node.id]);
  };
  for (const node of signals) add(node, "traffic_signals");
  let crossingsNearSignals = 0;
  for (const node of onRoad) {
    const { highway, crossing } = node.tags;
    if (highway === "stop") add(node, "stop");
    else if (highway === "give_way") add(node, "give_way");
    else if (crossing === "traffic_signals" && highway !== "traffic_signals") {
      if (signals.some((signal) => meters(signal, node) <= ex.CROSSING_NEAR_SIGNAL_METERS)) crossingsNearSignals += 1;
      else add(node, "crossing_signals");
    }
  }
  features.sort((a, b) => a[5] - b[5]);
  notTied.sort((a, b) => a.id - b.id);
  return { features, counts: { ...counts, signalControlledCrossingsWithin40mOfASignal: crossingsNearSignals, signsNotTiedToOneApproach: notTied.length }, notTied };
}

// ---------------------------------------------------------------- check 1: provenance

function justifyingTag(tags = {}, type) {
  if (type === "traffic_signals") return tags.highway === "traffic_signals" ? "highway=traffic_signals" : null;
  if (type === "crossing_signals") {
    if (tags.crossing === "traffic_signals") return tags.highway === "crossing" ? "highway=crossing + crossing=traffic_signals" : "crossing=traffic_signals";
    if (tags["crossing:signals"] === "yes") return "crossing:signals=yes";
    return null;
  }
  return tags.highway === type ? `highway=${type}` : null;
}

export function checkProvenance({ provenance, sources, features, featuresSha256 }, model, reproduced, ex) {
  const checksums = sources.map((source) => ({ file: source.file, expected: source.expectedSha256, actual: source.sha256, ok: source.expectedSha256 === source.sha256 }));
  const datasetFiles = features.source?.files ?? [];
  const datasetSourcesMatch = datasetFiles.length === provenance.sources.length
    && provenance.sources.every((source, i) => datasetFiles[i]?.file === source.file && datasetFiles[i]?.sha256 === source.sha256);
  const coverageMatches = JSON.stringify(features.coverage) === JSON.stringify(provenance.sources.map((source) => source.bbox));
  const traced = [];
  const failures = [];
  const outsideCoverage = [];
  const seen = new Set();
  for (const [lon, lat, typeIndex, junctionLon, junctionLat, id] of features.features) {
    const type = features.types[typeIndex];
    const node = model.nodes.get(id);
    const problems = [];
    if (seen.has(id)) problems.push("node id listed twice");
    seen.add(id);
    const tag = node ? justifyingTag(node.tags, type) : null;
    if (!node) problems.push("node not in the raw sources");
    else {
      if (!tag) problems.push(`no tag justifies type ${type}`);
      if (round7(node.lon) !== lon || round7(node.lat) !== lat) problems.push(`coordinates differ (raw ${node.lon}, ${node.lat})`);
      if (!model.roadNodeWays.has(id)) problems.push(`not on a way matching the extractor's road classes`);
      const sign = type === "stop" || type === "give_way";
      if (!sign && (junctionLon !== 0 || junctionLat !== 0)) problems.push("non-sign feature carries a guarded junction");
      if (sign) {
        const junction = guardedJunction(model, ex, node)?.node;
        if (!junction || round7(junction.lon) !== junctionLon || round7(junction.lat) !== junctionLat) problems.push("guarded junction differs from the extractor's rule");
      }
    }
    if (!inCoverage(features.coverage, lon, lat)) outsideCoverage.push({ id, type, coordinate: [round6(lon), round6(lat)] });
    traced.push({ id, type, tag: tag ?? null, ok: problems.length === 0 });
    if (problems.length) failures.push({ id, type, coordinate: [round6(lon), round6(lat)], problems });
  }
  // The dataset must be exactly what the extractor's rules give on these archives.
  const key = (feature) => feature.join(",");
  const datasetKeys = new Set(features.features.map(key));
  const reproducedKeys = new Set(reproduced.features.map(key));
  const missingFromDataset = reproduced.features.filter((feature) => !datasetKeys.has(key(feature))).map((feature) => feature[5]);
  const notReproduced = features.features.filter((feature) => !reproducedKeys.has(key(feature))).map((feature) => feature[5]);
  const countsEqual = JSON.stringify(Object.entries(features.counts).sort()) === JSON.stringify(Object.entries(reproduced.counts).sort());
  return {
    checksums,
    checksumsVerified: checksums.every((item) => item.ok),
    datasetSha256: featuresSha256,
    datasetSourcesMatchProvenance: datasetSourcesMatch,
    coverageMatchesProvenance: coverageMatches,
    featuresChecked: features.features.length,
    featuresTraced: traced.filter((item) => item.ok).length,
    justifyingTags: tally(traced, (item) => `${item.type} ← ${item.tag ?? "none"}`),
    failures,
    traced,
    reproduction: { identical: missingFromDataset.length === 0 && notReproduced.length === 0 && countsEqual, countsEqual, datasetCounts: features.counts, reproducedCounts: reproduced.counts, missingFromDataset, notReproduced },
    featuresOutsideCoverage: { count: outsideCoverage.length, note: "Nodes of ways that cross a box edge: the extractor keeps them, the app's coverage flag still counts only the boxes.", items: outsideCoverage },
    elementVersionConflicts: { count: model.versionConflicts.length, note: "Same element with different versions in two archives (newest file kept, as the extractor does).", items: model.versionConflicts.map(({ type, id, versions, keptVersion }) => ({ type, id, versions, keptVersion })) },
  };
}

// ---------------------------------------------------------------- check 2: placement

function placementOf(model, nodeId) {
  const classes = sortedUnique((model.highwayNodeWays.get(nodeId) ?? []).map((wayId) => wayClass(model.ways.get(wayId).tags.highway)));
  const has = (name) => classes.includes(name);
  if (has("carriageway")) return { classes, category: "carriageway" };
  if (has("service")) return { classes, category: "service-only" };
  if (has("busway")) return { classes, category: "busway-only" };
  if (has("cycleway")) return { classes, category: "cycleway-only" };
  if (has("foot")) return { classes, category: "foot-only" };
  if (classes.length) return { classes, category: "other-highway-only" };
  return { classes, category: "no-highway-way" };
}

export function checkPlacement(inputs, model, constants, grid) {
  const { features } = inputs;
  const datasetIds = new Map(features.features.map((feature) => [feature[5], features.types[feature[2]]]));
  // Population: every dataset feature, plus every raw signal or sign node inside the boxes.
  const population = new Map();
  for (const [id, type] of datasetIds) population.set(id, type);
  for (const node of model.nodes.values()) {
    const highway = node.tags?.highway;
    if (!["traffic_signals", "stop", "give_way"].includes(highway) || population.has(node.id)) continue;
    if (inCoverage(features.coverage, node.lon, node.lat)) population.set(node.id, highway);
  }
  const ids = [...population.keys()].sort(byNumber);
  // Non-highway ways through the population (tram tracks, railways, untagged ways).
  const otherWays = new Map();
  const wanted = new Set(ids);
  for (const way of [...model.ways.values()].sort((a, b) => a.id - b.id)) {
    if (way.tags?.highway) continue;
    for (const id of new Set(way.nodes)) {
      if (!wanted.has(id)) continue;
      const label = way.tags?.railway ? `railway=${way.tags.railway}` : way.tags && Object.keys(way.tags).length ? Object.entries(way.tags).slice(0, 1).map(([key, value]) => `${key}=${value}`)[0] : "untagged way";
      otherWays.set(id, sortedUnique([...(otherWays.get(id) ?? []), label]));
    }
  }
  const items = [];
  const summary = {};
  for (const id of ids) {
    const node = model.nodes.get(id);
    const type = population.get(id);
    const inDataset = datasetIds.has(id);
    const placed = placementOf(model, id);
    const { classes } = placed;
    const others = otherWays.get(id) ?? [];
    const category = placed.category !== "no-highway-way" ? placed.category
      : others.length && others.every((label) => label === "railway=tram") ? "tram-track-only"
        : others.length ? "non-road-way-only" : "no-way";
    const nearest = category === "carriageway" ? { distance: 0, wayId: null } : grid.nearest(node, new Set(model.highwayNodeWays.get(id) ?? []));
    const nearestMeters = nearest ? round1(nearest.distance) : null;
    const near = nearest !== null && nearest.distance <= constants.SIGNAL_METERS;
    const bucket = `${type}${inDataset ? "" : " (not in dataset)"}`;
    summary[bucket] ??= {};
    summary[bucket][category] = (summary[bucket][category] ?? 0) + 1;
    const signal = type === "traffic_signals" || type === "crossing_signals";
    let code = null;
    if (signal && category === "cycleway-only") code = near ? "SIGNAL_ON_CYCLEWAY_NEAR_CARRIAGEWAY" : "SIGNAL_ONLY_ON_CYCLEWAY";
    else if (signal && category === "service-only") code = near ? "SIGNAL_ON_SERVICE_NEAR_CARRIAGEWAY" : "SIGNAL_ONLY_ON_SERVICE_ROAD";
    else if (signal && category === "busway-only") code = "SIGNAL_ONLY_ON_BUSWAY";
    else if (type === "traffic_signals" && category === "tram-track-only") code = "SIGNAL_ON_TRAM_TRACK_ONLY";
    else if (type === "traffic_signals" && (category === "non-road-way-only" || category === "no-way")) code = "SIGNAL_NOT_ON_ROAD_WAY";
    else if (type === "traffic_signals" && (category === "foot-only" || category === "other-highway-only")) code = "SIGNAL_ONLY_ON_FOOTWAY";
    else if (!signal && !inDataset && category !== "carriageway" && category !== "service-only") code = "SIGN_NOT_ON_ROAD";
    if (!code) continue;
    items.push({
      code, id, type, inDataset, category, wayClasses: classes, nonRoadWays: others,
      nearestCarriagewayMeters: nearestMeters, nearestCarriagewayWayId: nearest?.wayId ?? null,
      withinAppSignalMeters: near, coordinate: coord(node),
    });
  }
  return {
    population: ids.length,
    note: `Car-capable carriageway = ${[...CARRIAGEWAY].join(", ")}. "withinAppSignalMeters": a car route on the nearest carriageway passes within lib/road-features.ts SIGNAL_METERS (${constants.SIGNAL_METERS} m), so the app would show this signal on it.`,
    byTypeAndCategory: summary,
    flagged: tally(items, (item) => item.code),
    items,
  };
}

// ---------------------------------------------------------------- check 3: duplicates and clusters

const groupOf = (type) => (type === "crossing_signals" ? "traffic_signals" : type);
function directionOf(node, type) {
  return (groupOf(type) === "traffic_signals" ? node.tags["traffic_signals:direction"] ?? node.tags.direction : node.tags.direction) ?? null;
}

export function checkDuplicatesAndClusters(inputs, model, constants) {
  const { features } = inputs;
  const entries = features.features.map((feature) => ({ id: feature[5], type: features.types[feature[2]], node: model.nodes.get(feature[5]) })).filter((entry) => entry.node);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const isJunction = (id) => (model.roadNodeWays.get(id)?.size ?? 0) > 1;
  // Duplicates: same kind, same way, a few metres apart, not facing opposite directions.
  const duplicates = new Map();
  let oppositeDirectionPairs = 0;
  for (const way of [...model.roadWays.values()].sort((a, b) => a.id - b.id)) {
    const onWay = sortedUnique(way.nodes.filter((id) => byId.has(id)));
    for (let i = 0; i < onWay.length; i += 1) {
      for (let j = i + 1; j < onWay.length; j += 1) {
        const a = byId.get(onWay[i]), b = byId.get(onWay[j]);
        if (groupOf(a.type) !== groupOf(b.type)) continue;
        const distance = meters(a.node, b.node);
        if (distance > AUDIT.DUPLICATE_METERS) continue;
        const da = directionOf(a.node, a.type), db = directionOf(b.node, b.type);
        if (da && db && da !== db) {
          oppositeDirectionPairs += 1;
          continue;
        }
        const key = `${a.id}-${b.id}`;
        if (!duplicates.has(key)) duplicates.set(key, { ids: [a.id, b.id], types: [a.type, b.type], wayId: way.id, meters: round1(distance), samePosition: distance === 0, directions: [da, db], coordinate: coord(a.node) });
      }
    }
  }
  // Junction clusters: single linkage at the app's SAME_JUNCTION_METERS over the signal group.
  const signals = entries.filter((entry) => groupOf(entry.type) === "traffic_signals").sort((a, b) => a.id - b.id);
  const parent = new Map(signals.map((entry) => [entry.id, entry.id]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const CELL = 0.0005;
  const cells = new Map();
  for (const entry of signals) {
    const key = `${Math.floor(entry.node.lon / CELL)}:${Math.floor(entry.node.lat / CELL)}`;
    cells.set(key, [...(cells.get(key) ?? []), entry]);
  }
  const closePairs = [];
  for (const entry of signals) {
    const cx = Math.floor(entry.node.lon / CELL), cy = Math.floor(entry.node.lat / CELL);
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        for (const other of cells.get(`${x}:${y}`) ?? []) {
          if (other.id <= entry.id) continue;
          const distance = meters(entry.node, other.node);
          if (distance > constants.SAME_JUNCTION_METERS) continue;
          closePairs.push({ a: entry, b: other, distance });
          const ra = find(entry.id), rb = find(other.id);
          if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
        }
      }
    }
  }
  closePairs.sort((p, q) => p.a.id - q.a.id || p.b.id - q.b.id);
  const clusters = new Map();
  for (const entry of signals) {
    const root = find(entry.id);
    clusters.set(root, [...(clusters.get(root) ?? []), entry.id]);
  }
  const names = (id) => nodeStreetNames(model, id);
  const disjoint = (a, b) => a.length > 0 && b.length > 0 && !a.some((name) => b.includes(name));
  const clusterOf = new Map();
  for (const [root, members] of clusters) for (const id of members) clusterOf.set(id, root);
  const spanning = new Set();
  const distinctJunctions = new Map();
  for (const { a, b, distance } of closePairs) {
    if (!disjoint(names(a.id), names(b.id))) continue;
    const root = clusterOf.get(a.id);
    spanning.add(root);
    if (isJunction(a.id) && isJunction(b.id)) {
      const item = distinctJunctions.get(root) ?? { clusterRoot: root, pairs: [] };
      item.pairs.push({ ids: [a.id, b.id], meters: round1(distance), streets: [names(a.id), names(b.id)] });
      distinctJunctions.set(root, item);
    }
  }
  const sizes = [...clusters.values()].map((members) => members.length);
  const diameter = (members) => {
    let max = 0;
    for (let i = 0; i < members.length; i += 1) for (let j = i + 1; j < members.length; j += 1) max = Math.max(max, meters(byId.get(members[i]).node, byId.get(members[j]).node));
    return round1(max);
  };
  const largest = [...clusters.entries()].sort((p, q) => q[1].length - p[1].length || p[0] - q[0]).slice(0, 10)
    .map(([root, members]) => ({ clusterRoot: root, size: members.length, diameterMeters: diameter(members), ids: members.slice().sort(byNumber), streets: sortedUnique(members.flatMap(names)), coordinate: coord(byId.get(root).node) }));
  return {
    duplicateMeters: AUDIT.DUPLICATE_METERS,
    duplicates: { count: duplicates.size, samePosition: [...duplicates.values()].filter((item) => item.samePosition).length, oppositeDirectionPairsNotCounted: oppositeDirectionPairs, items: [...duplicates.values()] },
    clusters: {
      sameJunctionMeters: constants.SAME_JUNCTION_METERS,
      note: "Single linkage over traffic_signals + crossing_signals (the app's merge group). The app merges consecutive markers less than SAME_JUNCTION_METERS apart along a route.",
      signals: signals.length,
      clusters: clusters.size,
      sizeHistogram: tally(sizes, (size) => (size >= 10 ? "10+" : String(size))),
      maxSize: Math.max(0, ...sizes),
      spanningDifferentRoads: spanning.size,
      largest,
      mergedDistinctJunctions: { count: distinctJunctions.size, note: "Clusters holding two signalised junction nodes whose street names have nothing in common: likely two separate junctions that one route would see as one marker.", items: [...distinctJunctions.values()].map((item) => ({ ...item, coordinate: coord(byId.get(item.pairs[0].ids[0]).node) })) },
    },
  };
}

// ---------------------------------------------------------------- check 4: signs

export function checkSigns(inputs, model, constants, ex, reproduced) {
  const { features } = inputs;
  const signs = features.features.filter((feature) => ["stop", "give_way"].includes(features.types[feature[2]]));
  const directions = {};
  const items = [];
  let farFromJunction = 0;
  const bothSides = { count: 0, onOneway: 0 };
  const distances = [];
  for (const feature of signs) {
    const node = model.nodes.get(feature[5]);
    if (!node) continue;
    const type = features.types[feature[2]];
    const direction = node.tags.direction ?? null;
    directions[`${type}: ${direction ?? "none"}`] = (directions[`${type}: ${direction ?? "none"}`] ?? 0) + 1;
    const chosen = guardedJunction(model, ex, node);
    if (!chosen) continue;
    const straight = meters(node, chosen.node);
    distances.push(straight);
    const way = model.roadWays.get(chosen.wayId);
    const travel = carDirection(way.tags);
    const base = { id: node.id, type, direction, wayId: chosen.wayId, junctionId: chosen.node.id, junctionMeters: round1(straight), alongWayMeters: round1(chosen.walked), coordinate: coord(node) };
    if (straight > constants.JUNCTION_METERS) {
      farFromJunction += 1;
      items.push({ code: "SIGN_FAR_FROM_JUNCTION", ...base });
    }
    const contraflow = bicycleContraflow(way.tags);
    if (direction === "forward" || direction === "backward") {
      const step = direction === "forward" ? 1 : -1;
      if (!canTravel(travel, step)) items.push({ code: "SIGN_DIRECTION_AGAINST_ONEWAY", ...base, oneway: way.tags.oneway ?? null, bicycleContraflow: contraflow });
    } else {
      const both = junctionWalk(model, ex, node, [1, -1]);
      const steps = new Set(both.filter((candidate) => candidate.wayId === chosen.wayId).map((candidate) => candidate.step));
      const otherJunctions = sortedUnique(both.filter((candidate) => candidate.node.id !== chosen.node.id).map((candidate) => candidate.node.id));
      if (steps.size === 2) {
        bothSides.count += 1;
        if (travel === "forward" || travel === "backward") bothSides.onOneway += 1;
      }
      if (!canTravel(travel, chosen.step)) {
        const ahead = both.filter((candidate) => candidate.wayId === chosen.wayId && candidate.step !== chosen.step)[0] ?? null;
        items.push({ code: "SIGN_JUNCTION_UPSTREAM_ON_ONEWAY", ...base, oneway: way.tags.oneway ?? null, bicycleContraflow: contraflow, junctionAheadId: ahead?.node.id ?? null, junctionAheadMeters: ahead ? round1(ahead.walked) : null });
      }
      else if (steps.size === 2 && otherJunctions.length > 0 && travel !== "forward" && travel !== "backward") items.push({ code: "SIGN_NO_DIRECTION_AMBIGUOUS", ...base, otherJunctionIds: otherJunctions });
    }
  }
  const notTied = reproduced.notTied.map((item) => {
    const node = model.nodes.get(item.id);
    return { code: "SIGN_NOT_TIED_TO_APPROACH", ...item, direction: node.tags.direction ?? null, junctionWays: model.roadNodeWays.get(item.id)?.size ?? 0, coordinate: coord(node) };
  });
  const bucket = (limit) => distances.filter((distance) => distance <= limit).length;
  items.sort((a, b) => a.code.localeCompare(b.code) || a.id - b.id);
  return {
    signsInDataset: signs.length,
    byTypeAndDirection: directions,
    withDirectionTag: signs.filter((feature) => ["forward", "backward"].includes(model.nodes.get(feature[5])?.tags.direction)).length,
    withoutDirectionTag: signs.filter((feature) => !["forward", "backward"].includes(model.nodes.get(feature[5])?.tags.direction)).length,
    withoutDirectionJunctionsOnBothSides: { ...bothSides, note: `Signs with no direction tag and a junction within ${ex.SIGN_WALK_METERS} m on both sides. On a one-way street the travel direction decides; the extractor picks the nearer one, flagged SIGN_JUNCTION_UPSTREAM_ON_ONEWAY when that is behind the traffic. On a two-way street it is SIGN_NO_DIRECTION_AMBIGUOUS.` },
    notTiedToOneApproach: { count: notTied.length, datasetCount: features.counts.signsNotTiedToOneApproach, items: notTied },
    junctionDistance: {
      note: `Straight-line sign → guarded junction. The app needs the route within JUNCTION_METERS (${constants.JUNCTION_METERS} m) of the junction and the junction at most 35 m after the sign; the extractor walks at most ${ex.SIGN_WALK_METERS} m. A sign farther than ${constants.JUNCTION_METERS} m is legal, listed for context.`,
      withinJunctionMeters: bucket(constants.JUNCTION_METERS),
      fartherThanJunctionMeters: farFromJunction,
      max: round1(Math.max(0, ...distances)),
    },
    flagged: tally(items, (item) => item.code),
    items,
  };
}

// ---------------------------------------------------------------- check 5: classification

export function checkClassification(inputs, model, ex) {
  const { features } = inputs;
  const inBoxes = (node) => inCoverage(features.coverage, node.lon, node.lat);
  const datasetType = new Map(features.features.map((feature) => [feature[5], features.types[feature[2]]]));
  const signals = [...model.nodes.values()].filter((node) => node.tags?.highway === "traffic_signals" && model.roadNodeWays.has(node.id));
  const items = [];
  const info = { trafficSignalsValues: {}, trafficSignalsWithCrossingNo: 0, allWayStops: [], signalisedCrossingsWithin40mOfSignal: 0 };
  for (const node of [...model.nodes.values()].sort((a, b) => a.id - b.id)) {
    const tags = node.tags;
    if (!tags) continue;
    const relevant = inBoxes(node) || datasetType.has(node.id);
    if (!relevant) continue;
    const base = { id: node.id, inDataset: datasetType.has(node.id), datasetType: datasetType.get(node.id) ?? null, coordinate: coord(node) };
    if (tags.highway === "traffic_signals") {
      const value = tags.traffic_signals ?? "none";
      info.trafficSignalsValues[value] = (info.trafficSignalsValues[value] ?? 0) + 1;
      if (tags.crossing === "no") info.trafficSignalsWithCrossingNo += 1;
      if (tags.crossing === "traffic_signals" || tags.traffic_signals === "crossing") items.push({ code: "CROSSING_LIGHT_AS_JUNCTION_SIGNAL", ...base, tags: pick(tags, ["highway", "crossing", "traffic_signals", "crossing_ref", "button_operated"]) });
      if (tags.stop || tags.give_way || tags.highway === "stop") items.push({ code: "CLASSIFICATION_CONFLICT", ...base, tags: pick(tags, ["highway", "stop", "give_way"]) });
    }
    if ((tags.highway === "stop" || tags.highway === "give_way") && (tags.traffic_signals || tags["traffic_signals:direction"] || tags.crossing === "traffic_signals")) {
      items.push({ code: "CLASSIFICATION_CONFLICT", ...base, tags: pick(tags, ["highway", "direction", "traffic_signals", "traffic_signals:direction", "crossing"]) });
    }
    if (tags.highway === "stop" && tags.stop === "all") info.allWayStops.push(node.id);
    const signalsYes = tags["crossing:signals"] === "yes";
    if (tags.crossing === "traffic_signals" && tags["crossing:signals"] === "no") items.push({ code: "CROSSING_SIGNALS_CONTRADICTION", ...base, tags: pick(tags, ["highway", "crossing", "crossing:signals"]) });
    if (signalsYes && ["uncontrolled", "no", "unmarked", "informal"].includes(tags.crossing)) items.push({ code: "CROSSING_SIGNALS_CONTRADICTION", ...base, tags: pick(tags, ["highway", "crossing", "crossing:signals"]) });
    if (signalsYes && tags.crossing !== "traffic_signals" && tags.highway !== "traffic_signals" && model.roadNodeWays.has(node.id) && inBoxes(node)) {
      if (signals.some((signal) => meters(signal, node) <= ex.CROSSING_NEAR_SIGNAL_METERS)) info.signalisedCrossingsWithin40mOfSignal += 1;
      else items.push({ code: "SIGNALISED_CROSSING_NOT_IN_DATASET", ...base, tags: pick(tags, ["highway", "crossing", "crossing:signals", "crossing:markings"]), note: "crossing:signals=yes without crossing=traffic_signals: valid tagging the extractor does not read." });
    }
  }
  return {
    note: "Each node has one highway value, so 'both signal and sign' means a sign node carrying signal tags, or the reverse.",
    ...info,
    flagged: tally(items, (item) => item.code),
    items,
  };
}
function pick(tags, keys) {
  return Object.fromEntries(keys.filter((key) => tags[key] !== undefined).map((key) => [key, tags[key]]));
}

// ---------------------------------------------------------------- check 6: one-way and turn restrictions

function wayInCoverage(model, way, coverage) {
  return way.nodes.some((id) => {
    const node = model.nodes.get(id);
    return node && inCoverage(coverage, node.lon, node.lat);
  });
}
function middleNode(model, way) {
  const present = way.nodes.map((id) => model.nodes.get(id)).filter(Boolean);
  return present[Math.floor(present.length / 2)] ?? null;
}
function probe(model, way, index, step) {
  let walked = 0;
  let previous = model.nodes.get(way.nodes[index]);
  for (let i = index + step; i >= 0 && i < way.nodes.length; i += step) {
    const current = model.nodes.get(way.nodes[i]);
    if (!current) return null;
    walked += meters(previous, current);
    previous = current;
    if (walked >= AUDIT.TURN_PROBE_METERS) break;
  }
  return walked > 0 ? previous : null;
}
/** Signed turn angle in degrees, positive = left (counter-clockwise). */
function turnAngle(from, via, to) {
  const [ix, iy] = planar(via, from);
  const [ox, oy] = planar(to, via);
  return Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy) / RAD;
}
function turnMismatch(kindTurn, angle, sameWay) {
  if (kindTurn === "left_turn") return angle < -20;
  if (kindTurn === "right_turn") return angle > 20;
  if (kindTurn === "straight_on") return Math.abs(angle) > 60;
  if (kindTurn === "u_turn") return !sameWay && Math.abs(angle) < 90;
  return false;
}

export function analyseRestriction(model, relation, signalNodes, constants) {
  const tags = relation.tags;
  const members = relation.members;
  const from = members.filter((member) => member.role === "from");
  const via = members.filter((member) => member.role === "via");
  const to = members.filter((member) => member.role === "to");
  const valueKeys = Object.keys(tags).filter((key) => key === "restriction" || key.startsWith("restriction:")).sort();
  const value = tags.restriction ?? tags[valueKeys.find((key) => key !== "restriction:conditional")] ?? tags["restriction:conditional"] ?? "";
  const kindMatch = String(value).match(/^(no|only)_([a-z_]+?)(?:\s*@.*)?$/);
  const timed = Boolean(tags.hour_on || tags.hour_off || tags.day_on || tags.day_off || tags["restriction:conditional"] || String(value).includes("@"));
  const codes = [];
  const details = [];
  const malformed = valueKeys.some((key) => key !== "restriction:conditional" && !STANDARD_RESTRICTION.test(tags[key]));
  if (malformed) {
    codes.push("RESTRICTION_VALUE_MALFORMED");
    details.push(`valore non standard: ${valueKeys.map((key) => `${key}=${tags[key]}`).join("; ")}`);
  }
  if (timed) {
    codes.push("RESTRICTION_TIME_DEPENDENT");
    details.push(`regola oraria: ${["hour_on", "hour_off", "day_on", "day_off", "restriction:conditional"].filter((key) => tags[key]).map((key) => `${key}=${tags[key]}`).join("; ") || value}`);
  }
  const fromWay = from.length === 1 && from[0].type === "way" ? model.ways.get(from[0].ref) : null;
  const toWay = to.length === 1 && to[0].type === "way" ? model.ways.get(to[0].ref) : null;
  const viaNode = via.length === 1 && via[0].type === "node" ? model.nodes.get(via[0].ref) : null;
  const viaKind = via.length === 0 ? "none" : via.every((member) => member.type === "node") ? "node" : "way";
  const missingRoles = [from.length ? null : "from", via.length ? null : "via", to.length ? null : "to"].filter(Boolean);
  const absentMembers = members.filter((member) => !(member.type === "node" ? model.nodes : member.type === "way" ? model.ways : model.relations).has(member.ref)).map((member) => `${member.role}:${member.type}/${member.ref}`).sort();
  if (missingRoles.length) {
    codes.push("RESTRICTION_INCOMPLETE");
    details.push(`ruoli mancanti: ${missingRoles.join(", ")}`);
  }
  const result = {
    id: relation.id, version: relation.version, timestamp: relation.timestamp, restriction: value, valueKeys,
    except: tags.except ?? null, kind: kindMatch?.[1] ?? null, turn: kindMatch?.[2] ?? null, timed,
    viaKind, fromWayId: from[0]?.ref ?? null, viaId: via[0]?.ref ?? null, toWayId: to[0]?.ref ?? null,
    absentMembers, checkable: false, viaAtEndpoints: null, angle: null, codes, details, signalsWithinMeters: null,
  };
  if (!fromWay || !toWay || !viaNode) return result;
  const fromIndex = fromWay.nodes.indexOf(viaNode.id);
  const toIndex = toWay.nodes.indexOf(viaNode.id);
  if (fromIndex < 0 || toIndex < 0) {
    codes.push("RESTRICTION_VIA_NOT_ON_MEMBER");
    details.push(`il nodo via ${viaNode.id} non è sulla strada ${fromIndex < 0 ? `di provenienza ${fromWay.id}` : `di destinazione ${toWay.id}`}`);
    return result;
  }
  for (const way of [fromWay, toWay]) {
    if (!VEHICLE_CLASSES.has(wayClass(way.tags?.highway)) && wayClass(way.tags?.highway) !== "cycleway") {
      codes.push("RESTRICTION_ON_NON_VEHICLE_WAY");
      details.push(`la strada ${way.id} è highway=${way.tags?.highway}`);
      break;
    }
  }
  const endpoint = (way, index) => (way.nodes[0] !== way.nodes[way.nodes.length - 1]) && (index === 0 || index === way.nodes.length - 1);
  result.viaAtEndpoints = endpoint(fromWay, fromIndex) && endpoint(toWay, toIndex);
  if (!result.viaAtEndpoints) {
    codes.push("RESTRICTION_VIA_NOT_ENDPOINT");
    details.push("la strada di provenienza o di destinazione non termina nel nodo via");
  } else {
    result.checkable = true;
    // Arriving on the from-way: towards its last node is forward travel, towards its first is backward.
    const arriveStep = fromIndex === fromWay.nodes.length - 1 ? 1 : -1;
    const leaveStep = toIndex === 0 ? 1 : -1;
    const inbound = probe(model, fromWay, fromIndex, -arriveStep);
    const outbound = probe(model, toWay, toIndex, leaveStep);
    if (inbound && outbound && result.turn) {
      const angle = turnAngle(inbound, viaNode, outbound);
      result.angle = round1(angle);
      if (turnMismatch(result.turn, angle, fromWay.id === toWay.id)) {
        codes.push("RESTRICTION_GEOMETRY_MISMATCH");
        details.push(`${value} ma la geometria è una svolta di ${round1(angle)}° (${angle > 0 ? "sinistra" : "destra"})`);
      }
    }
    const fromTravel = carDirection(fromWay.tags);
    const toTravel = carDirection(toWay.tags);
    result.carCanArrive = canTravel(fromTravel, arriveStep);
    result.carCanLeave = canTravel(toTravel, leaveStep);
    const contraflow = (tags) => ["bicycle", "psv", "bus", "taxi"].filter((mode) => mode === "bicycle" ? bicycleContraflow(tags) : ["no", "0", "false"].includes(String(tags[`oneway:${mode}`] ?? "")));
    if (!result.carCanArrive) {
      // Cars cannot arrive: the relation can only concern contraflow traffic, so its exit is not judged for cars.
      codes.push("RESTRICTION_FROM_ONEWAY_AWAY");
      const modes = contraflow(fromWay.tags);
      details.push(`la strada di provenienza ${fromWay.id} è a senso unico in uscita dal nodo${modes.length ? ` (controsenso ammesso per ${modes.join(", ")})` : ""}`);
    } else if (result.kind === "only" && !result.carCanLeave) {
      codes.push("RESTRICTION_ONLY_EXIT_AGAINST_ONEWAY");
      const modes = contraflow(toWay.tags);
      details.push(`l'unica uscita ${toWay.id} è a senso unico verso il nodo${modes.length ? ` (controsenso ammesso per ${modes.join(", ")})` : ""}`);
    }
    result.redundantForCars = result.kind === "no" && !result.carCanLeave;
  }
  let nearestSignal = null;
  for (const signal of signalNodes) {
    const distance = meters(signal, viaNode);
    if (distance <= constants.SAME_JUNCTION_METERS && (!nearestSignal || distance < nearestSignal.distance)) nearestSignal = { distance, id: signal.id };
  }
  if (nearestSignal) {
    result.signalsWithinMeters = round1(nearestSignal.distance);
    result.nearestSignalId = nearestSignal.id;
    codes.push("RESTRICTION_AT_SIGNALS");
  }
  return result;
}

export function checkOnewayAndRestrictions(inputs, model, constants) {
  const { features } = inputs;
  const coverage = features.coverage;
  const ways = [...model.ways.values()].filter((way) => way.tags?.highway && wayInCoverage(model, way, coverage)).sort((a, b) => a.id - b.id);
  const drivable = ways.filter((way) => ["carriageway", "service"].includes(wayClass(way.tags.highway)));
  const oneway = {
    scope: "highway ways of class carriageway or service with at least one node inside the 11 boxes",
    ways: drivable.length,
    onewayValues: tally(drivable, (way) => way.tags.oneway ?? (way.tags.junction === "roundabout" ? "(roundabout, implied yes)" : "(none)")),
    carDirectionAsLastricoReadsIt: tally(drivable, (way) => carDirection(way.tags)),
    onewayBicycle: tally(drivable.filter((way) => way.tags["oneway:bicycle"]), (way) => way.tags["oneway:bicycle"]),
    cyclewayOpposite: drivable.filter((way) => ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"].some((key) => /^opposite/.test(way.tags[key] ?? ""))).length,
    modalOnewayKeys: tally(drivable.flatMap((way) => Object.keys(way.tags).filter((key) => /^oneway:/.test(key))), (key) => key),
    cyclewayWays: ways.filter((way) => wayClass(way.tags.highway) === "cycleway").length,
    onewayCyclewayWays: ways.filter((way) => wayClass(way.tags.highway) === "cycleway" && ["yes", "-1"].includes(way.tags.oneway)).length,
    turnLanesWays: drivable.filter((way) => Object.keys(way.tags).some((key) => key.startsWith("turn:lanes"))).length,
  };
  const onewayItems = [];
  for (const way of drivable) {
    const tags = way.tags;
    const dated = Object.keys(tags).filter((key) => /^oneway:\d{4}-\d{2}-\d{2}/.test(key));
    for (const key of dated) {
      const conflict = carDirection({ oneway: tags[key] }) !== carDirection({ oneway: tags.oneway ?? "" });
      onewayItems.push({ code: conflict ? "ONEWAY_DATED_KEY_CONFLICT" : "ONEWAY_KEY_MALFORMED", wayId: way.id, name: wayName(way), tags: pick(tags, ["oneway", key]), coordinate: coord(middleNode(model, way)) });
    }
    if (tags["oneway:conditional"] && (tags["oneway:hour_on"] || tags["oneway:hour_off"])) {
      const window = `${tags["oneway:hour_on"] ?? "?"}-${tags["oneway:hour_off"] ?? "?"}`;
      if (!tags["oneway:conditional"].replace(/\s/g, "").includes(window)) {
        onewayItems.push({ code: "ONEWAY_HOURS_CONFLICT", wayId: way.id, name: wayName(way), tags: pick(tags, ["oneway", "oneway:conditional", "oneway:hour_on", "oneway:hour_off"]), coordinate: coord(middleNode(model, way)) });
      }
    }
  }
  oneway.flagged = tally(onewayItems, (item) => item.code);
  oneway.items = onewayItems;

  const signalNodes = features.features.filter((feature) => features.types[feature[2]] === "traffic_signals").map((feature) => model.nodes.get(feature[5])).filter(Boolean);
  const all = [...model.relations.values()].filter((relation) => relation.tags?.type === "restriction" || relation.tags?.type?.startsWith("restriction:")).sort((a, b) => a.id - b.id);
  // In scope: the via node lies in a box; without a via node in the archive, any member way does.
  const scoped = all.filter((relation) => {
    const viaNodes = relation.members.filter((member) => member.role === "via" && member.type === "node").map((member) => model.nodes.get(member.ref)).filter(Boolean);
    if (viaNodes.length) return viaNodes.some((node) => inCoverage(coverage, node.lon, node.lat));
    return relation.members.some((member) => member.type === "way" && model.ways.has(member.ref) && wayInCoverage(model, model.ways.get(member.ref), coverage));
  });
  const analysed = scoped.map((relation) => analyseRestriction(model, relation, signalNodes, constants));
  const modeKeys = tally(analysed.flatMap((item) => item.valueKeys.filter((key) => key !== "restriction")), (key) => key);
  return {
    oneway,
    restrictions: {
      relationsInArchive: all.length,
      inScope: analysed.length,
      scope: "type=restriction relations with a member node inside the 11 boxes (via node, or member ways when no via node is in the archive)",
      byValue: tally(analysed, (item) => item.restriction || "(none)"),
      withExcept: analysed.filter((item) => item.except).length,
      exceptValues: tally(analysed.filter((item) => item.except), (item) => item.except),
      modeSpecificKeys: modeKeys,
      timeDependent: analysed.filter((item) => item.timed).length,
      viaKinds: tally(analysed, (item) => item.viaKind),
      withAbsentMembers: analysed.filter((item) => item.absentMembers.length).length,
      checkableGeometry: analysed.filter((item) => item.checkable).length,
      redundantForCars: analysed.filter((item) => item.redundantForCars).length,
      atSignalisedJunctions: analysed.filter((item) => item.signalsWithinMeters !== null).length,
      flagged: tally(analysed.flatMap((item) => item.codes), (code) => code),
      enforcement: "Turn restrictions are enforced by the routing provider (FOSSGIS Valhalla) when it builds the route. Lastrico's local scoring (lib/road-intelligence-scoring.ts) checks only way-level access and one-way direction; it never reads restriction relations.",
      localDataCan: [
        "check that each relation is complete and internally consistent (roles, via node on both ways, ways split at the via node)",
        "compare the restriction type with the junction geometry (left/right/straight/U-turn angle)",
        "compare it with the one-way tags of the same ways",
        "replay archived provider routes and see whether any performs a mapped forbidden manoeuvre",
      ],
      localDataCannot: [
        "say whether the sign exists on the street, or its exact hours and exemptions",
        "know which OSM version the provider's routing graph was built from",
        "evaluate time-dependent restrictions for a given departure",
        "check restrictions whose members lie outside the 11 archived boxes",
      ],
      items: analysed,
    },
  };
}

// ---------------------------------------------------------------- check 7: conditional rules

export function checkConditionals(inputs, model, parse = parseConditional) {
  const { features, ztl } = inputs;
  const ztlByWay = new Map();
  for (const area of ztl.areas ?? []) for (const id of area.wayIds) if (!ztlByWay.has(id)) ztlByWay.set(id, area.id);
  const ways = [...model.ways.values()].filter((way) => way.tags?.highway && wayInCoverage(model, way, features.coverage)).sort((a, b) => a.id - b.id);
  const items = [];
  for (const way of ways) {
    for (const key of Object.keys(way.tags).filter((name) => name.endsWith(":conditional")).sort()) {
      const value = way.tags[key];
      const base = key.replace(/:conditional$/, "");
      const group = APP_ACCESS_KEYS.includes(base) ? "access key read by lib/access-conditions.ts"
        : base === "oneway" ? "oneway: Lastrico treats the direction as unknown (not enforced locally)"
          : /^(access|vehicle|motor_vehicle|motorcar|motorcycle|bicycle):(forward|backward|both_ways)$/.test(base) ? "directional access: not read by Lastrico"
            : "not a Lastrico mode key";
      const rules = parse(value);
      const parsed = rules.length > 0 && rules.every((rule) => rule.condition.kind !== "unknown");
      items.push({
        wayId: way.id, name: wayName(way), highway: way.tags.highway, key, value, group, parsed,
        kinds: rules.map((rule) => `${rule.value} @ ${rule.condition.kind}`),
        unparsedConditions: rules.filter((rule) => rule.condition.kind === "unknown").map((rule) => rule.condition.text || "(no @ condition)"),
        ztlArea: ztlByWay.get(way.id) ?? null, coordinate: coord(middleNode(model, way)),
      });
    }
  }
  const relevantMode = (item) => item.group !== "not a Lastrico mode key";
  const unsupported = items.filter((item) => !item.parsed || (relevantMode(item) && !item.group.startsWith("access key")))
    .map((item) => ({ ...item, why: !item.parsed ? "condition not parsed by lib/access-conditions.ts parseConditional" : "key not evaluated by Lastrico (left to the provider)" }));
  const isVehicleWay = (item) => VEHICLE_CLASSES.has(wayClass(item.highway)) || item.highway === "cycleway";
  for (const item of unsupported) {
    item.code = !item.parsed && item.group.startsWith("access key") ? "CONDITIONAL_NOT_PARSED"
      : relevantMode(item) && isVehicleWay(item) ? "CONDITIONAL_KEY_NOT_EVALUATED" : null;
  }
  return {
    parser: "lib/access-conditions.ts parseConditional (imported, not replicated)",
    scope: "highway ways with at least one node inside the 11 boxes",
    tags: items.length,
    byKey: tally(items, (item) => item.key),
    byGroup: tally(items, (item) => item.group),
    appKeys: { keys: APP_ACCESS_KEYS.map((key) => `${key}:conditional`), tags: items.filter((item) => item.group.startsWith("access key")).length, parsed: items.filter((item) => item.group.startsWith("access key") && item.parsed).length, notParsed: items.filter((item) => item.group.startsWith("access key") && !item.parsed).length },
    parsed: items.filter((item) => item.parsed).length,
    notParsed: items.filter((item) => !item.parsed).length,
    distinctValues: tally(items, (item) => `${item.key}=${item.value}`),
    unsupported,
    items,
  };
}

// ---------------------------------------------------------------- check 8: archived provider routes

export function checkArchivedRoutes(inputs, model, restrictions) {
  const { archive } = inputs;
  const base = {
    ran: false, archivePresent: archive.present, files: archive.files, bodyChecksumFailures: archive.bodyChecksumFailures.length, requestsWithDateTime: archive.requestsWithDateTime,
    method: "Route vertices are matched to OSM nodes of the archive (polyline6 vs 7-decimal nodes, within 0.3 m). A forbidden manoeuvre is an arrival on the from-way's last edge into the via node followed by a departure on the to-way's first edge (no_*), or by any other way (only_*). Only relations with a via node at the end of both ways are checked.",
  };
  if (!archive.present) return { ...base, skipped: "outputs/phase425-benchmark/responses/ is not unpacked (see outputs/phase425-benchmark/PROVIDER_ARCHIVE.md)." };
  const KEY_SCALE = 1e6;
  const index = new Map();
  for (const [id] of model.highwayNodeWays) {
    const node = model.nodes.get(id);
    if (!node) continue;
    const key = `${Math.round(node.lon * KEY_SCALE)}:${Math.round(node.lat * KEY_SCALE)}`;
    index.set(key, [...(index.get(key) ?? []), node]);
  }
  const match = ([lon, lat]) => {
    const x = Math.round(lon * KEY_SCALE), y = Math.round(lat * KEY_SCALE);
    const hits = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const node of index.get(`${x + dx}:${y + dy}`) ?? []) if (meters(node, { lon, lat }) <= AUDIT.NODE_MATCH_METERS) hits.push(node.id);
    return hits.length === 1 ? hits[0] : null;
  };
  const checkable = restrictions.items.filter((item) => item.checkable && item.kind);
  const byVia = new Map();
  for (const item of checkable) byVia.set(item.viaId, [...(byVia.get(item.viaId) ?? []), item]);
  const hasEdge = (way, a, b) => {
    for (let i = 1; i < way.nodes.length; i += 1) if ((way.nodes[i - 1] === a && way.nodes[i] === b) || (way.nodes[i - 1] === b && way.nodes[i] === a)) return true;
    return false;
  };
  const edgeOnHighway = (a, b) => (model.highwayNodeWays.get(a) ?? []).some((wayId) => hasEdge(model.ways.get(wayId), a, b));
  const applies = (item, relation, mode) => {
    const tags = relation.tags;
    const specific = { car: "restriction:motorcar", motorcycle: "restriction:motorcycle", bicycle: "restriction:bicycle" }[mode];
    if (!tags.restriction && !tags[specific] && !tags["restriction:conditional"]) return "not for this mode";
    const except = String(tags.except ?? "").split(";").map((value) => value.trim());
    if (EXEMPT_KEYS[mode].some((key) => except.includes(key))) return "exempt";
    if (item.timed) return "time-dependent";
    return "applies";
  };
  const stats = new Map();
  let routes = 0, routesInBoxes = 0, verticesInBoxes = 0, verticesMatched = 0;
  const seenShapes = new Set();
  let duplicateShapes = 0;
  for (const route of archive.routes) {
    const mode = COSTING_MODE[route.costing];
    if (!mode) continue;
    routes += 1;
    const shapeKey = `${mode}|${route.shapes.join("|")}`;
    if (seenShapes.has(shapeKey)) duplicateShapes += 1;
    seenShapes.add(shapeKey);
    let touched = false;
    for (const shape of route.shapes) {
      const points = decodePolyline6(shape).filter((point, i, list) => i === 0 || point[0] !== list[i - 1][0] || point[1] !== list[i - 1][1]);
      const ids = points.map((point) => {
        if (!inCoverage(inputs.features.coverage, point[0], point[1])) return match(point);
        touched = true;
        verticesInBoxes += 1;
        const id = match(point);
        if (id !== null) verticesMatched += 1;
        return id;
      });
      for (let i = 1; i < ids.length - 1; i += 1) {
        const candidates = byVia.get(ids[i]);
        if (!candidates) continue;
        for (const item of candidates) {
          const relation = model.relations.get(item.id);
          const stat = stats.get(item.id) ?? { relationId: item.id, restriction: item.restriction, arrivals: 0, unresolved: 0, traversals: {} };
          stats.set(item.id, stat);
          const prev = ids[i - 1], next = ids[i + 1];
          if (prev === null || next === null) {
            stat.unresolved += 1;
            continue;
          }
          if (!hasEdge(model.ways.get(item.fromWayId), prev, ids[i])) continue;
          stat.arrivals += 1;
          const onTo = hasEdge(model.ways.get(item.toWayId), ids[i], next);
          if (item.kind === "only" && !onTo && !edgeOnHighway(ids[i], next)) {
            stat.unresolved += 1;
            continue;
          }
          const forbidden = item.kind === "no" ? onTo : !onTo;
          if (!forbidden) continue;
          const verdict = applies(item, relation, mode);
          const bucket = (stat.traversals[`${mode}:${verdict}`] ??= { mode, verdict, routes: 0, responses: [] });
          bucket.routes += 1;
          if (!bucket.responses.includes(route.key)) bucket.responses.push(route.key);
        }
      }
    }
    if (touched) routesInBoxes += 1;
  }
  const items = [];
  for (const stat of [...stats.values()].sort((a, b) => a.relationId - b.relationId)) {
    for (const bucket of Object.values(stat.traversals).sort((a, b) => a.mode.localeCompare(b.mode) || a.verdict.localeCompare(b.verdict))) {
      items.push({ relationId: stat.relationId, restriction: stat.restriction, mode: bucket.mode, verdict: bucket.verdict, routes: bucket.routes, responses: bucket.responses.length, sampleResponses: bucket.responses.sort().slice(0, 3) });
    }
  }
  const violations = items.filter((item) => item.verdict === "applies");
  const byVerdict = {};
  for (const item of items) {
    const entry = (byVerdict[item.verdict] ??= { relations: [], routes: 0 });
    if (!entry.relations.includes(item.relationId)) entry.relations.push(item.relationId);
    entry.routes += item.routes;
  }
  return {
    ...base,
    ran: true,
    routes,
    duplicateRouteShapes: duplicateShapes,
    routesThroughBoxes: routesInBoxes,
    vertexMatchRateInBoxes: verticesInBoxes ? Number((verticesMatched / verticesInBoxes).toFixed(4)) : null,
    restrictionsCheckable: checkable.length,
    restrictionsReachedFromTheirFromWay: [...stats.values()].filter((stat) => stat.arrivals > 0).length,
    unresolvedPassages: [...stats.values()].reduce((sum, stat) => sum + stat.unresolved, 0),
    forbiddenManoeuvres: {
      applying: violations.length,
      exemptOrNotForMode: items.filter((item) => item.verdict === "exempt" || item.verdict === "not for this mode").length,
      timeDependent: items.filter((item) => item.verdict === "time-dependent").length,
      byVerdict,
      note: "Counts are relation × mode entries; 'time-dependent' manoeuvres are not judged because no archived request carries a departure time (date_time).",
    },
    caveat: "The provider's OSM data date is unknown: a relation edited after its graph was built, or a mismatch in this matching, can explain a traversal. Each one is suspicious, not proven.",
    items,
  };
}

// ---------------------------------------------------------------- ranking

function addSite(sites, finding) {
  const site = sites.get(finding.key) ?? { key: finding.key, coordinate: finding.coordinate, nodes: new Set(), ways: new Set(), relations: new Set(), codes: new Set(), details: [], streets: new Set(), findings: 0 };
  for (const id of finding.nodes ?? []) site.nodes.add(id);
  for (const id of finding.ways ?? []) site.ways.add(id);
  for (const id of finding.relations ?? []) site.relations.add(id);
  for (const name of finding.streets ?? []) site.streets.add(name);
  site.codes.add(finding.code);
  if (finding.detail && !site.details.includes(finding.detail)) site.details.push(finding.detail);
  site.findings += 1;
  sites.set(finding.key, site);
}
const siteScore = (codes, findings) => [...codes].reduce((sum, code) => sum + REASONS[code].weight, 0) + Math.min(3, findings - codes.size);

export function rankSites(model, checks) {
  const sites = new Map();
  const nodeSite = (id, code, detail, extra = {}) => {
    const node = model.nodes.get(id);
    if (!node) return;
    let streets = nodeStreetNames(model, id);
    if (!streets.length) streets = nodeStreetNames(model, id, new Set(["carriageway", "service", "busway", "cycleway", "foot", "other"]));
    addSite(sites, { key: `node:${id}`, coordinate: coord(node), nodes: [id, ...(extra.nodes ?? [])], ways: extra.ways, relations: extra.relations, streets: [...streets, ...(extra.streets ?? [])], code, detail });
  };
  for (const failure of checks.provenance.failures) nodeSite(failure.id, "PROVENANCE_MISMATCH", failure.problems.join("; "));
  for (const item of checks.placement.items) {
    const nearest = item.nearestCarriagewayWayId ? model.ways.get(item.nearestCarriagewayWayId) : null;
    nodeSite(item.id, item.code, `${item.type} su ${item.category}${item.nonRoadWays.length ? ` (${item.nonRoadWays.join(", ")})` : ""}${item.nearestCarriagewayMeters !== null ? `, carreggiata a ${item.nearestCarriagewayMeters} m` : ""}${item.inDataset ? "" : " (escluso dal dataset)"}`, { ways: nearest ? [nearest.id] : [], streets: nearest && wayName(nearest) ? [wayName(nearest)] : [] });
  }
  for (const item of checks.duplicates.duplicates.items) nodeSite(item.ids[0], "DUPLICATE_SIGNAL", `${item.types.join("/")} ${item.ids.join(" e ")} a ${item.meters} m sulla way ${item.wayId}`, { nodes: item.ids, ways: [item.wayId] });
  for (const item of checks.duplicates.clusters.mergedDistinctJunctions.items) {
    const first = item.pairs[0];
    nodeSite(first.ids[0], "MERGED_DISTINCT_JUNCTIONS", `semafori ${first.ids.join(" e ")} a ${first.meters} m su strade diverse`, { nodes: item.pairs.flatMap((pair) => pair.ids) });
  }
  for (const item of [...checks.signs.items, ...checks.signs.notTiedToOneApproach.items]) {
    if (item.code === "SIGN_FAR_FROM_JUNCTION" && item.junctionMeters <= 15) continue; // context only
    nodeSite(item.id, item.code, `${item.type}${item.direction ? ` direction=${item.direction}` : " senza direction"}${item.junctionId ? `, incrocio ${item.junctionId} a ${item.junctionMeters} m` : `: ${item.reason}`}${item.oneway ? `, oneway=${item.oneway}` : ""}`, { nodes: item.junctionId ? [item.junctionId] : [], ways: item.wayId ? [item.wayId] : [] });
  }
  for (const item of checks.classification.items) nodeSite(item.id, item.code, Object.entries(item.tags).map(([key, value]) => `${key}=${value}`).join(" "));
  const traversals = new Map();
  const timedTraversals = new Map();
  for (const item of checks.archivedRoutes.items ?? []) {
    const target = item.verdict === "applies" ? traversals : item.verdict === "time-dependent" ? timedTraversals : null;
    if (target) target.set(item.relationId, [...(target.get(item.relationId) ?? []), item]);
  }
  for (const item of checks.restrictions.restrictions.items) {
    const codes = [...item.codes];
    if (traversals.has(item.id)) codes.unshift("ARCHIVED_ROUTE_TRAVERSES_RESTRICTION");
    if (timedTraversals.has(item.id)) codes.unshift("ARCHIVED_ROUTE_TRAVERSES_TIMED_RESTRICTION");
    if (!codes.length) continue;
    const via = item.viaKind === "node" ? model.nodes.get(item.viaId) : null;
    const anchor = via ?? [item.fromWayId, item.toWayId].map((id) => model.ways.get(id)).filter(Boolean).map((way) => middleNode(model, way))[0];
    if (!anchor) continue;
    const streets = [item.fromWayId, item.toWayId].map((id) => wayName(model.ways.get(id))).filter(Boolean);
    const label = `relazione ${item.id} ${RESTRICTION_IT[item.restriction] ?? item.restriction}${item.except ? ` (eccetto ${item.except})` : ""}`;
    for (const code of codes) {
      let detail = label;
      if (code === "ARCHIVED_ROUTE_TRAVERSES_RESTRICTION") detail = `${label}: manovra eseguita in ${traversals.get(item.id).map((t) => `${t.routes} percorsi ${MODE_IT[t.mode]}`).join(", ")}`;
      else if (code === "ARCHIVED_ROUTE_TRAVERSES_TIMED_RESTRICTION") detail = `${label}, ${item.details.find((text) => text.startsWith("regola oraria")) ?? "regola oraria"}: manovra eseguita in ${timedTraversals.get(item.id).map((t) => `${t.routes} percorsi ${MODE_IT[t.mode]}`).join(", ")}`;
      else if (code === "RESTRICTION_AT_SIGNALS") detail = `${label}: semaforo a ${item.signalsWithinMeters} m`;
      else if (item.details.length) detail = `${label}: ${item.details.join("; ")}`;
      addSite(sites, { key: via ? `node:${via.id}` : `relation:${item.id}`, coordinate: coord(anchor), nodes: via ? [via.id] : [], ways: [item.fromWayId, item.toWayId].filter(Boolean), relations: [item.id], streets, code, detail });
    }
  }
  // Way-level findings: one site per street, so one street split into many ways is listed once.
  const wayFindings = [
    ...checks.restrictions.oneway.items.map((item) => ({ ...item, rule: Object.entries(item.tags).map(([key, value]) => `${key}=${value}`).join(" ") })),
    ...checks.conditionals.unsupported.filter((item) => item.code).map((item) => ({ ...item, rule: `${item.key}=${item.value}` })),
  ];
  for (const item of wayFindings.sort((a, b) => a.wayId - b.wayId)) {
    const key = item.name ? `street:${item.name}` : `way:${item.wayId}`;
    addSite(sites, { key, coordinate: item.coordinate, ways: [item.wayId], streets: item.name ? [item.name] : [], code: item.code, detail: `${item.rule}${item.ztlArea ? ` (ZTL ${item.ztlArea})` : ""}` });
  }
  // Group sites within SITE_GROUP_METERS (greedy, strongest first), one visit per junction.
  const ordered = [...sites.values()].map((site) => ({ ...site, score: siteScore(site.codes, site.findings) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const groups = [];
  for (const site of ordered) {
    const point = { lon: site.coordinate[0], lat: site.coordinate[1] };
    const group = site.key.startsWith("street:") || site.key.startsWith("way:") ? null
      : groups.find((candidate) => !candidate.wayLevel && meters(candidate.point, point) <= AUDIT.SITE_GROUP_METERS);
    if (group) {
      for (const name of ["nodes", "ways", "relations", "codes", "streets"]) for (const value of site[name]) group[name].add(value);
      group.details.push(...site.details);
      group.findings += site.findings;
      group.members.push(site.key);
    } else {
      groups.push({ ...site, point, wayLevel: site.key.startsWith("street:") || site.key.startsWith("way:"), nodes: new Set(site.nodes), ways: new Set(site.ways), relations: new Set(site.relations), codes: new Set(site.codes), streets: new Set(site.streets), details: [...site.details], members: [site.key] });
    }
  }
  const ranked = groups.map((group) => {
    const codes = [...group.codes].sort((a, b) => REASONS[b].weight - REASONS[a].weight || a.localeCompare(b));
    const notes = codes.map((code) => REASONS[code].note);
    return {
      score: siteScore(group.codes, group.findings),
      reasons: codes,
      ids: { nodes: sortedUnique([...group.nodes]), ways: sortedUnique([...group.ways]), relations: sortedUnique([...group.relations]) },
      coordinate: group.coordinate,
      streets: sortedUnique([...group.streets]),
      checkOnSite: notes.length > 1 ? `${notes[0]} Inoltre: ${notes[1].charAt(0).toLowerCase()}${notes[1].slice(1)}` : notes[0],
      details: sortedUnique(group.details).slice(0, 6),
      sites: group.members.sort(),
    };
  }).sort((a, b) => b.score - a.score || a.sites[0].localeCompare(b.sites[0]));
  return {
    method: "Score = sum of the weights of the distinct reason codes at a site + 1 per extra finding (max +3). Node findings within SITE_GROUP_METERS are one site; way-level rules are grouped by street and rule.",
    weights: Object.fromEntries(Object.entries(REASONS).map(([code, reason]) => [code, reason.weight])),
    notes: Object.fromEntries(Object.entries(REASONS).map(([code, reason]) => [code, reason.note])),
    sites: ranked.length,
    items: ranked.slice(0, AUDIT.RANK_LIMIT).map((item, i) => ({ rank: i + 1, ...item })),
    remaining: ranked.slice(AUDIT.RANK_LIMIT).map((item) => ({ score: item.score, reasons: item.reasons, ids: item.ids, coordinate: item.coordinate, streets: item.streets })),
  };
}

// ---------------------------------------------------------------- the audit

export function buildAudit(inputs) {
  const ex = inputs.extractorConstants;
  const constants = inputs.roadFeaturesConstants;
  const model = buildOsmModel(inputs.sources, ex);
  const reproduced = reproduceExtraction(model, ex);
  const grid = carriagewayGrid(model);
  const provenance = checkProvenance(inputs, model, reproduced, ex);
  const placement = checkPlacement(inputs, model, constants, grid);
  const duplicates = checkDuplicatesAndClusters(inputs, model, constants);
  const signs = checkSigns(inputs, model, constants, ex, reproduced);
  const classification = checkClassification(inputs, model, ex);
  const restrictions = checkOnewayAndRestrictions(inputs, model, constants);
  const conditionals = checkConditionals(inputs, model);
  const archivedRoutes = checkArchivedRoutes(inputs, model, restrictions.restrictions);
  const checks = { provenance, placement, duplicates, signs, classification, restrictions, conditionals, archivedRoutes };
  const ranking = rankSites(model, checks);
  return {
    schema: "lastrico-intersection-audit",
    version: 1,
    phase: "4.34",
    area: "milan",
    generatedBy: "scripts/audit-milan-intersections.mjs",
    dataAsOf: inputs.sources.map((source) => source.retrievedAt).sort().at(-1),
    status: "Suspicious items to check on site. OpenStreetMap is not ground truth; nothing here was verified physically.",
    licence: "Derived from © OpenStreetMap contributors, ODbL 1.0",
    inputs: {
      sources: inputs.sources.map(({ file, bbox, retrievedAt, sha256: actual }) => ({ file, bbox, retrievedAt, sha256: actual })),
      dataset: "data/features/milan-road-features.json",
      ztlAreas: "data/features/milan-ztl-areas.json",
      appConstants: { file: "lib/road-features.ts", ...constants },
      extractorRules: { file: "scripts/osm/extract-road-features.mjs", roadClasses: ex.roadPattern, signWalkMeters: ex.SIGN_WALK_METERS, crossingNearSignalMeters: ex.CROSSING_NEAR_SIGNAL_METERS },
      auditThresholds: AUDIT,
      coverage: inputs.features.coverage,
      elements: { nodes: model.nodes.size, ways: model.ways.size, relations: model.relations.size, occurrences: model.occurrences },
    },
    checks,
    ranking,
  };
}

export async function runAudit(root = ROOT) {
  const inputs = await loadInputs(root);
  const audit = buildAudit(inputs);
  return { audit, json: stableStringify(audit), markdown: renderMarkdown(audit), inputs };
}

// ---------------------------------------------------------------- Italian summary

const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
export function renderMarkdown(audit) {
  const { provenance: p, placement, duplicates: d, signs: s, classification: c, restrictions: r, conditionals: k, archivedRoutes: a } = audit.checks;
  const verdictText = (entry, label) => (entry ? `Relazioni ${label}: ${entry.relations.join(", ")} (${entry.routes} percorsi). ` : "");
  const flagged = (object) => Object.entries(object).sort().map(([code, count]) => `${code} ${count}`).join(", ") || "nessuno";
  const lines = [];
  lines.push("# Phase 4.34 — Verifica semafori, segnali e svolte (Milano centro)", "");
  lines.push(`Audit offline e deterministico dei dati OSM usati da Lastrico per semafori, stop, precedenze, sensi unici, divieti di svolta e regole orarie. Dati OSM al ${audit.dataAsOf.slice(0, 10)}. Generato da \`${audit.generatedBy}\`; dettaglio completo in \`intersection-audit.json\`.`, "");
  lines.push("**Stato:** elenco di punti *sospetti da verificare sul posto*. Nessun punto è stato verificato fisicamente e nessuno è dichiarato errato.", "");
  lines.push("## Cosa è stato controllato", "");
  lines.push("| Controllo | Risultato |", "| --- | --- |");
  lines.push(`| 1. Provenienza | Checksum delle ${p.checksums.length} fonti: ${p.checksumsVerified ? "tutti corretti" : "**NON corrispondono**"}. ${p.featuresTraced}/${p.featuresChecked} elementi del dataset ricondotti a un nodo OSM con il tag che ne giustifica il tipo, stesse coordinate. Dataset ricostruito dalle fonti con le regole dell'estrattore: ${p.reproduction.identical ? "identico" : "**diverso**"}. ${p.featuresOutsideCoverage.count} elementi stanno appena fuori dagli 11 riquadri; ${p.elementVersionConflicts.count} elementi (${flagged(tally(p.elementVersionConflicts.items, (item) => item.type))}) hanno versioni diverse tra due archivi. |`);
  lines.push(`| 2. Posizione dei segnali | ${placement.population} nodi (dataset + nodi grezzi nei riquadri). Segnalati: ${flagged(placement.flagged)}. |`);
  lines.push(`| 3. Doppioni e gruppi | ${d.duplicates.count} coppie probabili doppioni (stesso tipo, stessa strada, ≤ ${d.duplicateMeters} m; ${d.duplicates.oppositeDirectionPairsNotCounted} coppie con direzioni opposte escluse). ${d.clusters.signals} semafori in ${d.clusters.clusters} gruppi entro ${d.clusters.sameJunctionMeters} m (max ${d.clusters.maxSize}); ${d.clusters.spanningDifferentRoads} gruppi uniscono strade con nomi diversi, ${d.clusters.mergedDistinctJunctions.count} sembrano due incroci distinti mostrati come uno. |`);
  lines.push(`| 4. Stop e precedenze | ${s.signsInDataset} cartelli nel dataset: ${s.withDirectionTag} con direzione, ${s.withoutDirectionTag} senza. ${s.notTiedToOneApproach.count} non legati a un ramo (dataset: ${s.notTiedToOneApproach.datasetCount}). ${s.junctionDistance.fartherThanJunctionMeters} oltre ${audit.inputs.appConstants.JUNCTION_METERS} m dall'incrocio (max ${s.junctionDistance.max} m, ammesso). Segnalati: ${flagged(s.flagged)}. |`);
  lines.push(`| 5. Classificazione | Segnalati: ${flagged(c.flagged)}. Altri ${c.signalisedCrossingsWithin40mOfSignal} attraversamenti con \`crossing:signals=yes\` entro 40 m da un semaforo (già coperti). |`);
  lines.push(`| 6. Sensi unici e svolte | ${r.oneway.ways} strade carrabili nei riquadri; senso per le auto come lo legge Lastrico: ${flagged(r.oneway.carDirectionAsLastricoReadsIt)}. \`oneway:bicycle\`: ${flagged(r.oneway.onewayBicycle)}. ${r.restrictions.inScope} relazioni di svolta (${flagged(r.restrictions.byValue)}); ${r.restrictions.withExcept} con \`except\`, ${r.restrictions.timeDependent} con orari, ${r.restrictions.atSignalisedJunctions} a incroci semaforizzati, ${r.restrictions.checkableGeometry} con geometria verificabile. Segnalati: ${flagged({ ...r.restrictions.flagged, ...r.oneway.flagged })}. |`);
  lines.push(`| 7. Regole condizionali | ${k.tags} tag \`*:conditional\`; chiavi lette dall'app: ${k.appKeys.tags} (${k.appKeys.parsed} interpretate, ${k.appKeys.notParsed} non interpretate). Non interpretate in totale: ${k.notParsed}. ${k.unsupported.length} regole non supportate elencate nel JSON. |`);
  lines.push(`| 8. Percorsi archiviati del provider | ${a.ran ? `${a.routes} percorsi Valhalla archiviati (${a.routesThroughBoxes} nei riquadri, vertici agganciati a nodi OSM: ${(a.vertexMatchRateInBoxes * 100).toFixed(1)}%). ${a.restrictionsReachedFromTheirFromWay}/${a.restrictionsCheckable} svolte regolate raggiunte almeno una volta; manovre vietate eseguite da percorsi a cui il divieto si applica: **${a.forbiddenManoeuvres.applying}**. ${verdictText(a.forbiddenManoeuvres.byVerdict["time-dependent"], "con orari, non giudicabili (nessuna richiesta indica l'orario di partenza)")}${verdictText(a.forbiddenManoeuvres.byVerdict.exempt, "esenti per il mezzo (except)")}` : `non eseguito: ${a.skipped}`} |`);
  lines.push("");
  lines.push("I divieti e gli obblighi di svolta sono applicati dal provider di percorso (FOSSGIS Valhalla), non dal punteggio locale di Lastrico, che controlla solo accessi e sensi unici delle singole strade.", "");
  lines.push(`## Elenco prioritario (primi ${audit.ranking.items.length} di ${audit.ranking.sites} punti)`, "");
  lines.push("| # | Punteggio | Motivi | ID OSM | Coordinate [lon, lat] | Strade | Cosa verificare sul posto |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of audit.ranking.items) {
    const ids = [
      item.ids.nodes.length ? `nodi ${item.ids.nodes.slice(0, 4).join(", ")}${item.ids.nodes.length > 4 ? "…" : ""}` : null,
      item.ids.ways.length ? `way ${item.ids.ways.slice(0, 3).join(", ")}${item.ids.ways.length > 3 ? "…" : ""}` : null,
      item.ids.relations.length ? `rel ${item.ids.relations.slice(0, 3).join(", ")}${item.ids.relations.length > 3 ? "…" : ""}` : null,
    ].filter(Boolean).join("; ");
    lines.push(`| ${item.rank} | ${item.score} | ${cell(item.reasons.join(", "))} | ${cell(ids)} | ${item.coordinate[0]}, ${item.coordinate[1]} | ${cell(item.streets.slice(0, 3).join(", ") || "—")} | ${cell(item.checkOnSite)} |`);
  }
  lines.push("");
  lines.push("## Limiti", "");
  lines.push("- OpenStreetMap non è la verità a terra: ogni voce è un sospetto da controllare, non un errore accertato.");
  lines.push("- Nessun punto è stato verificato fisicamente; l'audit legge solo file già presenti nel repository, senza rete.");
  lines.push("- I divieti e gli obblighi di svolta sono applicati dal provider (FOSSGIS Valhalla) con i suoi dati OSM, di data non nota; Lastrico non li legge né li applica localmente.");
  lines.push(`- Copertura: solo gli 11 riquadri centrali degli archivi OSM del ${[...new Set(audit.inputs.sources.map((source) => source.retrievedAt.slice(0, 10)))].join(" e ")}; fuori da questi l'app non mostra semafori né cartelli.`);
  lines.push("- Le regole con orari non sono valutate per un orario di partenza; le relazioni con membri fuori dai riquadri o con via su strada non sono verificabili qui.");
  lines.push("- Le relazioni di svolta si controllano solo per coerenza interna, forma dell'incrocio e sensi unici: la presenza reale del cartello e le sue eccezioni si vedono solo sul posto.");
  lines.push(`- Il controllo sui percorsi archiviati ${a.ran ? "usa le risposte Valhalla del 7–8 novembre 2026: un passaggio può dipendere da dati diversi del provider o dall'aggancio dei vertici." : "non è stato eseguito perché l'archivio non è estratto."}`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI

async function main() {
  const outArg = process.argv.slice(2).find((arg) => arg.startsWith("--out="));
  const out = outArg ? path.resolve(process.cwd(), outArg.slice("--out=".length)) : path.join(ROOT, "outputs/phase434");
  const { audit, json, markdown } = await runAudit(ROOT);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "intersection-audit.json"), json);
  await writeFile(path.join(out, "intersection-audit.md"), markdown);
  console.log(JSON.stringify({
    out: path.relative(process.cwd(), out) || ".",
    checksumsVerified: audit.checks.provenance.checksumsVerified,
    featuresTraced: `${audit.checks.provenance.featuresTraced}/${audit.checks.provenance.featuresChecked}`,
    restrictions: audit.checks.restrictions.restrictions.inScope,
    archivedRouteCheck: audit.checks.archivedRoutes.ran,
    rankedSites: audit.ranking.sites,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
