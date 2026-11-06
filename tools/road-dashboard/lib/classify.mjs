// Surface semantics for the dashboard. These mirror PRODUCTION exactly; nothing is reinterpreted:
//  - category enum and order: lib/spatial-road-store.ts K_ENUM / scripts/osm/compile-compact-tiles.mjs
//  - raw OSM surface -> material -> category: scripts/osm/config.mjs (SURFACE_MATERIAL_MAP, SURFACE_CATEGORY_MAP)
//  - "known" coverage = rough (confirmed + probable) + smooth + unpaved, as in scoreRoadIntelligence()
// The category stored in each compact tuple is used as-is; the material map is only used for a consistency audit.

import { segmentLengthMeters } from "./geo.mjs";

export const CATEGORIES = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
export const KNOWN_CATEGORIES = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose"];

/**
 * What "confirmed" means everywhere in this tool: an explicit OSM `surface` tag in Lastrico's production data.
 * It is NOT a field survey; tag accuracy and freshness are not independently checked.
 */
export const CONFIRMED_NOTICE = "«Confermato» significa: tag OSM surface esplicito nei dati di produzione di Lastrico. Non è un rilievo sul campo: correttezza e aggiornamento del tag non sono verificati in modo indipendente.";

/** Display order of the five categories (production order CATEGORIES stays the decoding order). */
export const DISPLAY_ORDER = ["confirmed_smooth", "confirmed_rough", "probable_rough", "unpaved_loose", "unknown"];

/** Evidence level of each category: confirmed by an explicit tag, weak tag evidence, or no usable evidence. */
export const EVIDENCE_LEVELS = {
  osm_tag_explicit: "Confermato da tag OSM esplicito (non rilievo sul campo)",
  osm_tag_weak: "Indizio debole da tag OSM (paving_stones), non confermato",
  none: "Nessuna evidenza utilizzabile",
};

export const CATEGORY_INFO = {
  confirmed_rough: {
    label: "Pavé confermato (tag OSM)",
    short: "pavé confermato",
    evidence: "osm_tag_explicit",
    definition: "Tag OSM surface esplicito di pietra a blocchi: sett, cobblestone, unhewn_cobblestone (dal tag grezzo: sett, cobblestone, cobblestone:flattened*, milanese_paving*, pebblestone, unhewn_cobblestone). Confermato dal tag, non da un rilievo sul campo. Categoria produzione confirmed_rough, peso rugosità 1,0, confidenza 1,0.",
  },
  probable_rough: {
    label: "Pavé probabile (paving_stones)",
    short: "pavé probabile",
    evidence: "osm_tag_weak",
    definition: "Tag OSM surface=paving_stones (anche paving_stones:lanes): masselli/lastre, possibile superficie irregolare ma non pavé confermato. Categoria produzione probable_rough, peso rugosità 0,65, confidenza 0,65. Conta come superficie nota, non come pavé confermato.",
  },
  confirmed_smooth: {
    label: "Liscio confermato (tag OSM)",
    short: "liscio confermato",
    evidence: "osm_tag_explicit",
    definition: "Tag OSM surface esplicito asphalt o concrete (concrete:plates, concrete:lanes). Confermato dal tag, non da un rilievo sul campo. Categoria produzione confirmed_smooth. surface=paved NON rientra qui.",
  },
  unpaved_loose: {
    label: "Sterrato / sciolto (tag OSM)",
    short: "sterrato confermato",
    evidence: "osm_tag_explicit",
    definition: "Tag OSM surface esplicito non pavimentato o sciolto: unpaved, compacted, gravel, fine_gravel, ground, dirt, earth. Confermato dal tag, non da un rilievo sul campo. Categoria produzione unpaved_loose: nota, ma né pavé né liscia.",
  },
  unknown: {
    label: "Sconosciuto",
    short: "sconosciuto",
    evidence: "none",
    definition: "Nessuna evidenza utilizzabile: tag surface assente, generico (paved, che include anche i masselli), other o valore non supportato. Mai assunto liscio. Categoria produzione unknown.",
  },
};

// Audit copy of scripts/osm/config.mjs SURFACE_CATEGORY_MAP (normalised material -> category).
export const MATERIAL_TO_CATEGORY = {
  sett: "confirmed_rough",
  cobblestone: "confirmed_rough",
  unhewn_cobblestone: "confirmed_rough",
  paving_stones: "probable_rough",
  asphalt: "confirmed_smooth",
  concrete: "confirmed_smooth",
  paved: "unknown",
  unpaved: "unpaved_loose",
  compacted: "unpaved_loose",
  gravel: "unpaved_loose",
  fine_gravel: "unpaved_loose",
  other: "unknown",
  unknown: "unknown",
};

/** Unknown with a generic but non-classifiable value (e.g. paved/other) vs. no usable value at all. */
export const GENERIC_UNKNOWN_MATERIALS = new Set(["paved", "other"]);

export const HIGHWAY_CLASSES = [
  "unknown", "steps", "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
  "residential", "living_street", "service", "pedestrian", "cycleway", "footway", "path", "track",
];

/** Classes considered the "main vehicular network" for a comparable coverage figure. */
export const MAIN_NETWORK_CLASSES = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
]);
export const MAJOR_CLASSES = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

/**
 * Routing-relevance weight per highway class used by the hotspot score.
 * A documented, hand-set PROXY of how often a through route is likely to use the class;
 * it is NOT a pavé likelihood and is never used for routing.
 */
export const ROUTING_CLASS_WEIGHT = {
  motorway: 1.0,
  trunk: 1.0,
  primary: 1.0,
  secondary: 0.9,
  tertiary: 0.8,
  unclassified: 0.6,
  cycleway: 0.6,
  residential: 0.5,
  living_street: 0.4,
  pedestrian: 0.3,
  unknown: 0.3,
  service: 0.2,
  track: 0.2,
  footway: 0.1,
  path: 0.1,
  steps: 0.0,
};

const DIRS = ["both", "forward", "backward", "unknown"];

/**
 * Decode one compact tuple (slim 11-field Milan v1.2.0 or legacy 14-field Roccella v1.1.0)
 * into the subset of fields the dashboard needs. Length follows production rules:
 * slim tuples recompute it from coordinates (as hydrateTuple does), legacy tuples carry it.
 */
export function decodeTuple(tuple, meta) {
  const slim = tuple.length === 11;
  const wayId = slim ? tuple[0] : tuple[1];
  const nameId = slim ? tuple[1] : tuple[2];
  const c = slim ? tuple[2] : tuple[3];
  const kId = slim ? tuple[3] : tuple[4];
  const svId = slim ? tuple[5] : tuple[6];
  const flags = slim ? tuple[6] : tuple[7];
  const mdBits = slim ? tuple[7] : tuple[8];
  const maBits = slim ? tuple[8] : tuple[9];
  const hc = slim ? (HIGHWAY_CLASSES[tuple[9]] ?? "unknown") : (tuple[10] ?? "unknown");
  const length = slim ? segmentLengthMeters(c[0], c[1], c[2], c[3]) : tuple[11];
  const category = CATEGORIES[kId] ?? "unknown";
  const material = svId >= 0 ? (meta.surfaceVals[svId] ?? "unknown") : "unknown";
  // Mode access exactly as scoreRoadIntelligence(): modeAccess wins, else legacy motor/bicycle flags.
  const car = maBits >= 0 ? (maBits & 1) !== 0 : (flags & 2) !== 0;
  const motorcycle = maBits >= 0 ? (maBits & 2) !== 0 : (flags & 2) !== 0;
  const bicycle = maBits >= 0 ? (maBits & 4) !== 0 : (flags & 4) !== 0;
  const carDir = mdBits >= 0 ? DIRS[(mdBits >> 4) & 3] : ((flags & 1) ? "forward" : "both");
  return {
    wayId,
    name: nameId >= 0 ? (meta.names[nameId] ?? null) : null,
    lon0: c[0], lat0: c[1], lon1: c[2], lat1: c[3],
    length,
    category,
    material,
    highwayClass: hc,
    car, motorcycle, bicycle,
    // A segment is "routable" for the dashboard if at least one Lastrico mode may use it.
    routable: car || motorcycle || bicycle,
    carDirectionKnown: carDir !== "unknown",
  };
}

/** Stable undirected key for a segment of an OSM way (direction can be reversed by normalisation). */
export function segmentKey(wayId, lon0, lat0, lon1, lat1) {
  const a = `${lon0},${lat0}`;
  const b = `${lon1},${lat1}`;
  return a <= b ? `${wayId}|${a}|${b}` : `${wayId}|${b}|${a}`;
}

export function emptyBreakdown() {
  return { confirmed_rough: 0, probable_rough: 0, confirmed_smooth: 0, unpaved_loose: 0, unknown: 0 };
}

export function knownShare(breakdown) {
  let total = 0;
  for (const k of CATEGORIES) total += breakdown[k];
  if (total <= 0) return null;
  return (total - breakdown.unknown) / total;
}
