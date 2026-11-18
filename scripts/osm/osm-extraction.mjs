import { createHash } from "node:crypto";

export const RAILWAY_VALUES = "rail|light_rail|tram|subway|narrow_gauge|funicular|monorail|preserved|disused|abandoned|construction";
export const RAILWAY_ROUTE_VALUES = "train|light_rail|tram|subway|monorail|funicular";
const railwayTypes = new RegExp(`^(${RAILWAY_VALUES})$`);
export const RAILWAY_LIFECYCLE_KEYS = ["disused:railway", "abandoned:railway", "construction:railway"];
const railwayRoutes = new RegExp(`^(${RAILWAY_ROUTE_VALUES})$`);

export const isRailwayWay = (tags) => railwayTypes.test(tags?.railway ?? "") ||
  RAILWAY_LIFECYCLE_KEYS.some((key) => railwayTypes.test(tags?.[key] ?? ""));
export const isRestrictionRelation = (tags) => /^restriction(?::.+)?$/.test(tags?.type ?? "");
const isRailwayRoute = (tags) => tags?.type === "route" && railwayRoutes.test(tags.route ?? "");
const references = (element) => `${element.type}/${element.id}`;
const types = ["node", "way", "relation"];
const isId = (value) => Number.isSafeInteger(value) && value > 0;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const accessKey = /^(?:access|vehicle|motor_vehicle|motorcar|motorcycle|bicycle|foot|oneway)(?::|$)/;
const surfaceKey = /(?:^|:)surface(?:[:_]|$)|(?:^|:)smoothness(?::|$)/;
const transportKey = /^(?:highway|railway|public_transport|tram|train|light_rail|subway|trolley_wire|embedded_rails)(?::|$)/;
const nodeFeatureKey = /^(?:barrier|crossing|traffic_calming|traffic_signals|traffic_signal|stop|give_way|direction|kerb|button_operated|ford)(?::|$)/;
const contextKey = /^(?:name|ref|layer|bridge|tunnel|level|level_crossing|service|gauge|electrified|usage|tracks|construction|area|tracktype|cycleway|footway|sidewalk|junction|lanes|turn|survey:date|check_date|source)(?::|$)/;
const relationKey = /^(?:type|restriction|except|implicit|day_on|day_off|hour_on|hour_off|route|network|operator|from|to|via|name|ref|source|check_date|survey:date)(?::|$)/;

export function osmFoundationTags(type, tags = {}) {
  const allowed = (key) => type === "relation"
    ? relationKey.test(key)
    : accessKey.test(key) || surfaceKey.test(key) || transportKey.test(key) ||
      contextKey.test(key) || RAILWAY_LIFECYCLE_KEYS.includes(key) || (type === "node" && nodeFeatureKey.test(key));
  return Object.fromEntries(Object.keys(tags).sort()
    .filter((key) => typeof tags[key] === "string" && allowed(key))
    .map((key) => [key, tags[key]]));
}

function cleanElement(element, legacySyntheticNodeVersions) {
  const { type, id, version, timestamp, changeset, visible } = element;
  if (!types.includes(type) || !isId(id)) throw new Error("Invalid OSM element type or id");
  const clean = { type, id };
  if (isId(version) && !(legacySyntheticNodeVersions && type === "node" && version === 1 && !timestamp)) {
    clean.version = version;
  }
  if (typeof timestamp === "string") clean.timestamp = timestamp;
  if (isId(changeset)) clean.changeset = changeset;
  if (visible === false) clean.visible = false;

  if (type === "node" && Number.isFinite(element.lon) && Number.isFinite(element.lat)) {
    const { lon, lat } = element;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error(`Invalid OSM node coordinates: ${id}`);
    Object.assign(clean, { lon, lat });
  }
  if (type === "way" && Array.isArray(element.nodes)) {
    if (!element.nodes.every(isId)) throw new Error(`Invalid OSM node reference in way ${id}`);
    clean.nodes = element.nodes;
  }
  if (type === "relation" && Array.isArray(element.members)) {
    clean.members = element.members.map((member) => {
      const { type, ref, role } = member;
      if (!types.includes(type) || !isId(ref) || typeof role !== "string") {
        throw new Error(`Invalid OSM member reference in relation ${id}`);
      }
      return { type, ref, role };
    });
  }
  clean.tags = osmFoundationTags(type, element.tags);
  return clean;
}

function preferElement(current, next) {
  if (!current) return next;
  if (current.version && next.version && current.version !== next.version) {
    return current.version > next.version ? current : next;
  }
  if (JSON.stringify(current) === JSON.stringify(next)) return current;
  // Overpass can emit overlapping "out tags"/"out meta" records of one entity.
  // Choose a superset only when it agrees on every field shared by both records.
  const contains = (richer, poorer) => Object.entries(poorer).every(([key, value]) => key === "tags"
    ? Object.entries(value).every(([tag, tagValue]) => richer.tags[tag] === tagValue)
    : JSON.stringify(richer[key]) === JSON.stringify(value));
  if (contains(current, next)) return current;
  if (contains(next, current)) return next;
  throw new Error(`Conflicting OSM records inside one response: ${references(next)}`);
}

/** Preserve topology and relevant evidence from one response, retaining its version boundaries. */
export function sanitizeOsmResponse(raw, { legacySyntheticNodeVersions = false } = {}) {
  if (!Array.isArray(raw?.elements) || raw.remark) throw new Error("Invalid or incomplete OSM response");
  const elements = new Map();
  for (const element of raw.elements) {
    const clean = cleanElement(element, legacySyntheticNodeVersions);
    const key = references(clean);
    elements.set(key, preferElement(elements.get(key), clean));
  }

  const selected = new Set();
  for (const element of elements.values()) {
    if (element.visible === false) selected.add(references(element));
    if (element.type === "relation" && (isRestrictionRelation(element.tags) || isRailwayRoute(element.tags))) {
      selected.add(references(element));
      for (const { type, ref } of element.members ?? []) {
        // Standalone transit lines can span many sectors. Keep member IDs and local
        // objects already selected by the query, without pulling in the full line.
        if (isRestrictionRelation(element.tags)) selected.add(`${type}/${ref}`);
      }
    }
    if (element.type === "way" && (typeof element.tags.highway === "string" || isRailwayWay(element.tags))) {
      selected.add(references(element));
    }
    if (element.type === "node" && Object.keys(element.tags).some((key) =>
      nodeFeatureKey.test(key) || accessKey.test(key) || transportKey.test(key) || surfaceKey.test(key))) {
      selected.add(references(element));
    }
  }
  for (const element of elements.values()) {
    if (element.type === "way" && selected.has(references(element))) {
      for (const id of element.nodes ?? []) selected.add(`node/${id}`);
    }
  }

  const { timestamp_osm_base, copyright } = raw.osm3s ?? {};
  return {
    version: raw.version ?? 0.6,
    generator: "openstreetmap-extract",
    upstreamGenerator: raw.upstreamGenerator ?? raw.generator ?? null,
    osm3s: { timestamp_osm_base: timestamp_osm_base ?? null, ...(copyright ? { copyright } : {}) },
    elements: [...elements.values()].filter((element) => selected.has(references(element)))
      .sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type) || a.id - b.id),
  };
}

export function summarizeOsmExtract({ elements }) {
  const available = new Set(elements.filter(({ visible }) => visible !== false).map(references));
  const summary = {
    nodes: 0, taggedNodes: 0, highways: 0, railwayWays: 0, relations: 0, turnRestrictions: 0,
    missingWayGeometries: 0, incompleteTurnRestrictions: 0, missingRelationMemberLists: 0,
    missingVersions: { node: 0, way: 0, relation: 0 },
  };
  const geometryNodes = new Set(elements.filter((element) =>
    element.type === "node" && element.visible !== false && Number.isFinite(element.lon) && Number.isFinite(element.lat))
    .map(references));
  for (const element of elements) {
    if (element.version === undefined) summary.missingVersions[element.type]++;
    if (element.visible === false) continue;
    if (element.type === "node") {
      if (!geometryNodes.has(references(element))) available.delete(references(element));
      summary.nodes++;
      if (Object.keys(element.tags).length > 0) summary.taggedNodes++;
    } else if (element.type === "way") {
      if (element.tags.highway) summary.highways++;
      if (isRailwayWay(element.tags)) summary.railwayWays++;
      if (!element.nodes || element.nodes.length < 2 || element.nodes.some((id) => !geometryNodes.has(`node/${id}`))) {
        summary.missingWayGeometries++;
        available.delete(references(element));
      }
    }
  }
  for (const element of elements) {
    if (element.type !== "relation" || element.visible === false) continue;
    summary.relations++;
    if (!element.members) summary.missingRelationMemberLists++;
    if (isRestrictionRelation(element.tags)) {
      summary.turnRestrictions++;
      if (!element.members?.length || element.members.some(({ type, ref }) => !available.has(`${type}/${ref}`))) {
        summary.incompleteTurnRestrictions++;
      }
    }
  }
  return summary;
}
