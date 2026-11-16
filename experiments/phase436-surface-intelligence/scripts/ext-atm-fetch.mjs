/** Fetch the ATM surface-line route dataset (ds538): GeoJSON (7.9 MB) and CSV (62 KB); print schema + counts. */
import { request } from "./ext-http.mjs";
const g = await request("https://dati.comune.milano.it/dataset/8bfe2015-2669-4796-9940-36b3c155b258/resource/b5acc06f-65fb-4481-9428-347fd1c18096/download/tpl_percorsi.geojson", { cacheName: "atm-tpl_percorsi.geojson", accept: "application/json" });
console.log("geojson HTTP", g.status, g.bytes.length, "bytes", g.cached ? "(cached)" : "", g.headers["last-modified"] ?? "");
const j = g.json();
console.log("type", j.type, "| features", j.features.length, "| crs", JSON.stringify(j.crs));
const f0 = j.features[0];
console.log("properties keys:", Object.keys(f0.properties), "| geometry type:", f0.geometry.type, "| vertices first:", (f0.geometry.coordinates.flat ? f0.geometry.coordinates.flat(1).length : 0));
console.log("sample properties:", JSON.stringify(f0.properties));
const geoTypes = {}; const mezzi = {};
for (const f of j.features) { geoTypes[f.geometry.type] = (geoTypes[f.geometry.type] ?? 0) + 1; mezzi[f.properties.mezzo] = (mezzi[f.properties.mezzo] ?? 0) + 1; }
console.log("geometry types:", JSON.stringify(geoTypes), "| mezzo:", JSON.stringify(mezzi));
const c = await request("https://dati.comune.milano.it/dataset/8bfe2015-2669-4796-9940-36b3c155b258/resource/d4408a03-ef86-40df-a4a9-e738d05e03e4/download/tpl_percorsi.csv", { cacheName: "atm-tpl_percorsi.csv" });
console.log("csv HTTP", c.status, c.bytes.length, "bytes; head:\n" + c.text().split("\n").slice(0, 4).join("\n"));
