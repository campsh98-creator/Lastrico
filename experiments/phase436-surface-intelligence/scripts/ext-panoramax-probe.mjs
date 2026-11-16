/**
 * Panoramax (open street-level imagery, STAC API, no key) coverage around PUBLIC landmark boxes: photo count, capture dates, sequences, picture type, licence.
 * usage: node ext-panoramax-probe.mjs <name> <minLon,minLat,maxLon,maxLat> [limit=200]
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
const [name, bbox, limit = "200"] = process.argv.slice(2);
const url = `https://api.panoramax.xyz/api/search?bbox=${bbox}&limit=${limit}`;
const r = await request(url, { cacheName: `panoramax-${name}.json`, accept: "application/geo+json" });
const j = r.json();
const f = j.features ?? [];
const years = {}, seqs = new Set(), lic = new Set(), types = {}, res = {};
for (const x of f) { const y = (x.properties.datetime || "").slice(0, 7); years[y] = (years[y] ?? 0) + 1; for (const c of x.collections ?? []) seqs.add(c); (x.links || []).filter((l) => l.rel === "license").forEach((l) => lic.add(l.href)); const t = x.properties["pers:interior_orientation"]?.type ?? x.properties["geovisio:type"] ?? x.properties["geovisio:pictureType"] ?? "?"; types[t] = (types[t] ?? 0) + 1; const rs = x.properties["pers:interior_orientation"]?.sensor_array_dimensions?.join("x") ?? "?"; res[rs] = (res[rs] ?? 0) + 1; }
console.log(`${name}: HTTP ${r.status}, ${f.length} photos (limit ${limit}); sequences ${seqs.size}; by month ${JSON.stringify(years)}; licences ${[...lic].join(",")}; types ${JSON.stringify(types)}; sensor dims ${JSON.stringify(res)}`);
console.log("first feature property keys:", f[0] ? Object.keys(f[0].properties).join(",") : "-", "| assets:", f[0] ? Object.keys(f[0].assets).join(",") : "-");
const slim = f.map((x) => ({ id: x.id, collection: x.collection, lon: +x.geometry.coordinates[0].toFixed(5), lat: +x.geometry.coordinates[1].toFixed(5), datetime: x.properties.datetime, azimuth: x.properties["view:azimuth"], type: x.properties["geovisio:type"], thumb: x.assets?.thumb?.href, sd: x.assets?.sd?.href, hd: x.assets?.hd?.href, producer: x.providers?.map((p) => p.name).join("/") }));
await writeFile(`${EVID}/panoramax-${name}.json`, JSON.stringify({ query: { bbox, limit }, count: f.length, byMonth: years, sequences: seqs.size, licences: [...lic], photos: slim.slice(0, 40) }, null, 1));
