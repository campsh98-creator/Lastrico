/**
 * Comune di Milano CKAN: (1) keyword package_search for road works / maintenance / pavement; (2) ds925 manomissioni live feed filtered by the public streets
 * of interest (datastore_search q=...). Public metadata only.
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
const base = "https://dati.comune.milano.it/api/3/action";
const terms = ["manutenzione strade", "asfaltatura", "cantieri", "pavimentazione", "lavori stradali", "pavé", "porfido", "binari", "tram"];
const out = { search: {}, ds925: {} };
for (const t of terms) {
  const r = await request(`${base}/package_search?q=${encodeURIComponent(t)}&rows=20`, { cacheName: `ckan-search-${t.replace(/\W+/g, "_")}.json`, accept: "application/json" });
  const j = r.json();
  out.search[t] = { count: j.result.count, top: (j.result.results || []).map((p) => `${p.name} | ${p.title} | ${String(p.metadata_modified).slice(0, 10)}`).slice(0, 8) };
  console.log(`\n"${t}": ${j.result.count} packages`); out.search[t].top.forEach((s) => console.log("   " + s));
}
// ds925 feed: fields + street-of-interest records
const pkg = await request(`${base}/package_show?id=ds925_avvisi-di-manomissione`, { cacheName: "ckan-ds925.json", accept: "application/json" });
const res = pkg.json().result.resources.map((r) => ({ id: r.id, name: r.name, format: r.format, size: r.size, datastore: r.datastore_active, modified: r.last_modified }));
console.log("\nds925 resources:", JSON.stringify(res));
const ds = res.find((r) => r.datastore);
if (ds) {
  const f = await request(`${base}/datastore_search?resource_id=${ds.id}&limit=1`, { cacheName: "ds925-fields.json", accept: "application/json" });
  const fj = f.json().result; out.ds925.fields = fj.fields.map((x) => x.id); out.ds925.total = fj.total; console.log("ds925 fields:", out.ds925.fields.join(", "), "| total records:", fj.total);
  for (const q of ["Lodi", "Papi"]) {
    const r = await request(`${base}/datastore_search?resource_id=${ds.id}&q=${encodeURIComponent(q)}&limit=50`, { cacheName: `ds925-q-${q}.json`, accept: "application/json" });
    const j = r.json().result; out.ds925[q] = { total: j.total, rows: j.records.map((x) => ({ via: x["Nome via"] ?? x["Nome via inizio"], area: x["Tipologia area coinvolta"], pav: x["Pavimentazione area occupata"], from: x["Data inizio"] ?? x["Data inizio lavori"], to: x["Data fine"] ?? x["Data fine lavori"] })) };
    console.log(`ds925 q=${q}: ${j.total}`, JSON.stringify(out.ds925[q].rows.slice(0, 8)));
  }
  const pet = await request(`${base}/datastore_search?resource_id=${ds.id}&filters=${encodeURIComponent(JSON.stringify({ "Pavimentazione area occupata": "Pietra" }))}&limit=50`, { cacheName: "ds925-pietra.json", accept: "application/json" });
  out.ds925.pietra = { total: pet.json().result.total }; console.log("ds925 Pavimentazione=Pietra:", out.ds925.pietra.total);
}
await writeFile(`${EVID}/ckan-works-search.json`, JSON.stringify({ retrievedUtc: new Date().toISOString(), ...out }, null, 1));
