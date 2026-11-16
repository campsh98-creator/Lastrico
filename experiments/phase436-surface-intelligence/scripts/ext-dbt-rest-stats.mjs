/**
 * DBT 2020 (Comune di Milano) — value distributions of every attribute field of the transport layers, citywide and inside the
 * Piazzale Lodi / Corso Lodi / Via Lazzaro Papi landmark box, via ArcGIS REST outStatistics (no feature download).
 * Box (WGS84, public landmarks): 9.2025,45.4430,9.2175,45.4550 (~1.2 x 1.3 km).
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = "https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer";
const BOX = "9.2025,45.4430,9.2175,45.4550";
const schema = JSON.parse(await (await import("node:fs/promises")).readFile(join(EVID, "dbt-rest-transport-schemas.json"), "utf8")).layers;
const only = process.argv[2] ? process.argv[2].split(",") : Object.keys(schema);
const skip = /^(OBJECTID|objectid_1|Shape.*|shape.*|classref|CLASSREF|segmentid|SEGMENTID|SUBREGID|classid|scril|CLASSID)$/i;
const out = {};
async function groupBy(layer, field, inBox) {
  const stats = encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }, { statisticType: "sum", onStatisticField: "Shape_Length", outStatisticFieldName: "len" }]));
  const geom = inBox ? `&geometry=${BOX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` : "";
  // 'objectid' name differs (FID vs OBJECTID): use the layer's real OID field alias
  const oid = schema[layer].fields.find((f) => f.type === "esriFieldTypeOID").name;
  const lenName = schema[layer].fields.find((f) => /^shape_length$/i.test(f.name))?.name;
  const st = encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: oid, outStatisticFieldName: "n" }, ...(lenName ? [{ statisticType: "sum", onStatisticField: lenName, outStatisticFieldName: "len" }] : [])]));
  const url = `${base}/${layer}/query?where=1%3D1&groupByFieldsForStatistics=${encodeURIComponent(field)}&outStatistics=${st}${geom}&f=json`;
  const r = await request(url, { cacheName: `dbt-stats-${layer}-${field}-${inBox ? "box" : "all"}.json`, accept: "application/json" });
  const j = r.json();
  if (j.error) return { error: j.error };
  return (j.features || []).map((f) => f.attributes).sort((a, b) => b.n - a.n);
}
for (const id of only) {
  const L = schema[id];
  out[id] = { name: L.name, geometryType: L.geometryType, total: L.count, fields: {} };
  for (const f of L.fields) {
    if (skip.test(f.name) || f.type === "esriFieldTypeOID" || f.type === "esriFieldTypeGeometry") continue;
    if (/^shape_(length|area)$/i.test(f.name)) continue;
    if (f.name.toUpperCase() === "NOME" || /^VIA_ID$/i.test(f.name)) continue; // names/ids handled separately
    const all = await groupBy(id, f.name, false);
    const box = await groupBy(id, f.name, true);
    out[id].fields[f.name] = { citywide: all, box };
    const fmt = (rows) => Array.isArray(rows) ? rows.slice(0, 8).map((r) => `${JSON.stringify(r[f.name])}:${r.n}`).join("  ") + (rows.length > 8 ? `  … (${rows.length} distinct)` : "") : JSON.stringify(rows);
    console.log(`L${id} ${L.name} | ${f.name}\n   citywide: ${fmt(all)}\n   box:      ${fmt(box)}`);
  }
}
await writeFile(join(EVID, process.argv[2] ? `dbt-rest-value-stats-${process.argv[2].replaceAll(",", "_")}.json` : "dbt-rest-value-stats.json"), JSON.stringify({ retrievedUtc: new Date().toISOString(), service: base, boxWgs84: BOX, layers: out }, null, 1));
