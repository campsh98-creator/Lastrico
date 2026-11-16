/** Real field lists, coded-value domains, geometry types and record counts for DBT 2020 transport layers (ArcGIS REST, metadata + count only). */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = "https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer";
const layers = (process.argv[2] || "1,19,20,35,37,38,39,40,41,42,45,34").split(",").map(Number);
const out = {};
for (const id of layers) {
  const r = await request(`${base}/${id}?f=pjson`, { cacheName: `dbt-rest-layer-${id}.json`, accept: "application/json" });
  const j = r.json();
  const c = await request(`${base}/${id}/query?where=1%3D1&returnCountOnly=true&f=json`, { cacheName: `dbt-rest-count-${id}.json`, accept: "application/json" });
  const count = c.json().count;
  const fields = (j.fields || []).map((f) => ({ name: f.name, alias: f.alias, type: f.type, length: f.length, domain: f.domain ? { type: f.domain.type, name: f.domain.name, codedValues: f.domain.codedValues } : null }));
  out[id] = { name: j.name, geometryType: j.geometryType, description: (j.description || "").slice(0, 300), count, fieldCount: fields.length, fields };
  console.log(`\n== layer ${id} ${j.name} | ${j.geometryType} | ${count} features | ${fields.length} fields`);
  for (const f of fields) console.log(`   ${f.name} (${f.alias}) ${f.type}${f.length ? "(" + f.length + ")" : ""}${f.domain ? " DOMAIN[" + (f.domain.codedValues || []).map((v) => v.code + "=" + v.name).join(" | ") + "]" : ""}`);
}
await writeFile(join(EVID, "dbt-rest-transport-schemas.json"), JSON.stringify({ retrievedUtc: new Date().toISOString(), service: base, layers: out }, null, 1));
