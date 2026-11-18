/**
 * Phase 4.39: what each OSM source actually looked for, and where.
 *
 * An empty answer is only evidence of absence where the extraction asked the question. The Phase 4.38
 * sidecar keeps every source with its endpoint, bounding box and (when known) query. From those we derive
 * per source whether railway ways and turn restrictions were requested, and the union of the boxes that
 * were interrogated. A segment outside that union has UNKNOWN rails, never "no rails".
 *
 * Capabilities come from the request itself, never from what came back: a box with no tram in it is still a
 * box where trams were asked for.
 */

/** [west, south, east, north] */
export const inBox = (box, [lon, lat]) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];

/**
 * What a source's request covered. Returns { rails, restrictions, basis }.
 * - OSM API 0.6 `map` returns every object touching the box (ways, relations): rails and restrictions asked.
 * - An Overpass query is read as text: `railway` and `restriction` must appear in it.
 * - Anything else (a legacy source with no stored request) is treated as NOT covering either topic.
 */
export function sourceCapabilities(source) {
  const endpoint = String(source.endpoint ?? "");
  if (/\/api\/0\.6\/map(\.json)?\?/.test(endpoint)) {
    return { rails: true, restrictions: true, basis: "osm-api-map-all-objects-in-bbox" };
  }
  if (typeof source.query === "string" && source.query.length) {
    return {
      rails: /railway/.test(source.query),
      restrictions: /restriction/.test(source.query),
      basis: "overpass-query-text",
    };
  }
  return { rails: false, restrictions: false, basis: "no-stored-request" };
}

/**
 * Corridors of a query that asked for railway ways only AROUND named streets, such as the Phase 4.36 Lodi sample:
 *   way["name"="Corso Lodi"]["highway"](...)->.cl;   way["railway"~"..."](around.cl:30)->.rails3;
 * The large box in such a query only finds the named street; it is NOT the area searched for rails. The area is the
 * set of points within `radiusM` of a way with that name. Returns [{ name, radiusM }], empty when the query has no such shape.
 */
export function railCorridors(query) {
  if (typeof query !== "string") return [];
  const nameOf = new Map();
  for (const m of query.matchAll(/way\["name"="([^"]+)"\](?:\["highway"\])?\([^)]*\)->\.(\w+);/g)) nameOf.set(m[2], m[1]);
  const corridors = [];
  for (const m of query.matchAll(/way\["railway"[^\]]*\]\(around\.(\w+):(\d+)\)/g)) {
    if (nameOf.has(m[1])) corridors.push({ name: nameOf.get(m[1]), radiusM: Number(m[2]) });
  }
  return corridors.sort((a, b) => a.name.localeCompare(b.name) || a.radiusM - b.radiusM);
}

/**
 * Coverage of every foundation group. `sources` are the manifest's source records of one group.
 * `boxes.rails` / `boxes.restrictions` are the boxes of sources that asked the question over a whole box.
 * `corridors` are the around-a-street areas of sources that asked only along named streets (not boxes).
 */
export function groupCoverage(group) {
  const per = group.sources.map((source, index) => {
    const caps = sourceCapabilities(source);
    // A box-less source with an around-query is a corridor source: its large bbox must never be read as coverage.
    const corridors = !source.bbox && caps.rails ? railCorridors(source.query) : [];
    return { index, file: source.file, bbox: source.bbox ?? null, ...caps, corridors };
  });
  const boxesFor = (topic) => per.filter((entry) => entry[topic] && entry.bbox).map((entry) => entry.bbox);
  return {
    name: group.name,
    sources: per,
    boxes: { rails: boxesFor("rails"), restrictions: boxesFor("restrictions") },
    corridors: per.flatMap((entry) => entry.corridors),
    sourcesWithoutBox: per.filter((entry) => !entry.bbox).length,
  };
}

/** True when the point lies in the union of boxes (a segment midpoint, not an interval). */
export const covered = (boxes, point) => boxes.some((box) => inBox(box, point));

/** Compact [start, length] runs of true values: the per-tile coverage the overlay stores. */
export function runsOf(flags) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - start]);
      start = -1;
    }
  }
  return runs;
}

/** Expands runs back to a Uint8Array of the given length. */
export function expandRuns(runs, length) {
  const flags = new Uint8Array(length);
  for (const [start, count] of runs) flags.fill(1, start, Math.min(length, start + count));
  return flags;
}
