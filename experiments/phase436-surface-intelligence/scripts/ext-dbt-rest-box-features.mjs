/**
 * Fetch DBT 2020 features (with geometry, WGS84 as served) inside the public landmark box, for matching tests.
 * Layers: 19 tramway elements, 45 rail/tram sede, 1 street elements, 39 vehicular circulation areas, 41 road areas, 37 cycle areas.
 * Box = 9.2025,45.4430,9.2175,45.4550 (WGS84). Also records native EPSG:7791 coordinates for the CRS-transform check (outSR default).
 */
import { request } from "./ext-http.mjs";
const base = "https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer";
const BOX = "9.2025,45.4430,9.2175,45.4550";
const layers = (process.argv[2] || "19,45,1,39,41,37").split(",").map(Number);
for (const id of layers) {
  for (const [tag, sr] of [["wgs", "&outSR=4326"], ["native", ""]]) {
    if (tag === "native" && ![19, 1].includes(id)) continue;
    const url = `${base}/${id}/query?where=1%3D1&geometry=${BOX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true${sr}&f=json`;
    const r = await request(url, { cacheName: `dbt-box-${id}-${tag}.json`, accept: "application/json" });
    const j = r.json();
    console.log(`layer ${id} ${tag}: HTTP ${r.status}, ${r.bytes.length} B, features=${(j.features || []).length}, exceeded=${j.exceededTransferLimit}, sr=${JSON.stringify(j.spatialReference)}${j.error ? " ERROR " + JSON.stringify(j.error) : ""}`);
  }
}
