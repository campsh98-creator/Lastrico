/** Fetch CKAN package_show for the Comune di Milano datasets under audit and print a resource table. */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["ds2889_database-topografico-dbt-2020-shp", "ds538_atm-percorsi-linee-di-superficie-urbane"];
for (const id of ids) {
  const r = await request(`https://dati.comune.milano.it/api/3/action/package_show?id=${id}`, { cacheName: `ckan-${id}.json`, accept: "application/json" });
  const j = r.json();
  const p = j.result;
  console.log(`\n== ${id} (HTTP ${r.status}${r.cached ? ", cached" : ""})`);
  console.log(`title: ${p.title}\nlicense_id: ${p.license_id} | license_title: ${p.license_title}\nmetadata_created: ${p.metadata_created} | metadata_modified: ${p.metadata_modified}`);
  console.log(`frequency/extras: ${JSON.stringify((p.extras || []).map((e) => [e.key, e.value]))}`);
  for (const res of p.resources || []) console.log(` - [${res.format}] ${res.name} | ${res.url} | size=${res.size} | mime=${res.mimetype} | created=${res.created} | modified=${res.last_modified} | datastore_active=${res.datastore_active} | id=${res.id}`);
  await writeFile(join(EVID, `ckan-${id}.summary.json`), JSON.stringify({ id, title: p.title, license_id: p.license_id, license_title: p.license_title, license_url: p.license_url, metadata_modified: p.metadata_modified, extras: p.extras, notes: p.notes, resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, url: x.url, size: x.size, mimetype: x.mimetype, created: x.created, last_modified: x.last_modified, datastore_active: x.datastore_active, description: x.description })) }, null, 2));
}
