/**
 * Probe the public KartaView API v2.0 (no key, host api.kartaview.org) around PUBLIC landmarks only; summarise photo dates/orientation/resolution.
 * usage: node ext-kartaview-probe.mjs <name> <lng> <lat> <radiusM> [pages=1]
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const [name, lng, lat, radius, pages = "1"] = process.argv.slice(2);
const all = [];
for (let page = 1; page <= +pages; page += 1) {
  const url = `https://api.kartaview.org/2.0/photo/?lat=${lat}&lng=${lng}&radius=${radius}&join=sequence&itemsPerPage=100&page=${page}`;
  const r = await request(url, { cacheName: `kartaview-${name}-p${page}.json`, accept: "application/json" });
  const j = r.json();
  all.push(...j.result.data);
  console.log(`page ${page}: HTTP ${r.status}, ${j.result.data.length} photos, hasMoreData=${j.result.hasMoreData}`);
  if (!j.result.hasMoreData) break;
}
const years = {}, seqs = new Set(), res = {};
for (const p of all) { const y = (p.shotDate || p.dateAdded || "").slice(0, 4); years[y] = (years[y] ?? 0) + 1; seqs.add(p.sequenceId); const k = `${p.width}x${p.height}`; res[k] = (res[k] ?? 0) + 1; }
console.log(`${name}: ${all.length} photos in ${seqs.size} sequences; by shot year ${JSON.stringify(years)}; resolutions ${JSON.stringify(res)}; projection ${JSON.stringify([...new Set(all.map((p) => p.projection))])}; gpsAccuracy median ${all.map((p) => +p.gpsAccuracy).sort((a, b) => a - b)[Math.floor(all.length / 2)]}`);
const slim = all.map((p) => ({ id: p.id, shotDate: p.shotDate, dateAdded: p.dateAdded, distance: +p.distance, heading: +p.heading, lat: +(+p.lat).toFixed(5), lng: +(+p.lng).toFixed(5), width: p.width, height: p.height, projection: p.projection, gpsAccuracy: p.gpsAccuracy, wayId: p.wayId, sequenceId: p.sequenceId, blur: p.autoImgProcessingResult, thumb: p.fileurlTh, proc: p.fileurlProc, lth: p.fileurlLTh, deviceName: p.sequence?.deviceName, platform: p.sequence?.platformName }));
await writeFile(join(EVID, `kartaview-${name}.json`), JSON.stringify({ query: { lat, lng, radius }, count: all.length, years, resolutions: res, photos: slim }, null, 1));
for (const p of slim.sort((a, b) => a.distance - b.distance).slice(0, 12)) console.log(` ${p.id} ${p.shotDate} d=${p.distance}m hdg=${p.heading} ${p.width}x${p.height} way=${p.wayId} seq=${p.sequenceId}`);
