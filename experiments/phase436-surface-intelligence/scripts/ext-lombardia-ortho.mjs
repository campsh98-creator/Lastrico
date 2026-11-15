/**
 * Regione Lombardia AGEA orthophotos (public ArcGIS ImageServer, no token): identify catalogue attributes (acquisition date, tile) at the PUBLIC Piazzale Lodi landmark
 * and export one small native-resolution window to judge whether sett vs asphalt is visible. Single window per service, cached, viewed only (AGEA terms: no redistribution).
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
const merc = (lon, lat) => [(lon * 20037508.34) / 180, (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137)];
const [cx, cy] = merc(9.2102, 45.4474); // Piazzale Lodi centroid (public landmark)
const base = "https://www.cartografia.servizirl.it/arcgis2/rest/services/BaseMap";
const out = {};
for (const svc of ["Ortofoto2021", "Ortofoto2018_2019"]) {
  const wk = svc === "Ortofoto2021" ? 3857 : 32632;
  let x = cx, y = cy;
  if (wk === 32632) { const { toUtm32 } = await import("./lib/utm.mjs"); [x, y] = toUtm32(9.2102, 45.4474); }
  const idUrl = `${base}/${svc}/ImageServer/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&sr=${wk}&returnCatalogItems=true&returnGeometry=false&f=json`;
  const r = await request(idUrl, { cacheName: `lomb-identify-${svc}.json`, accept: "application/json" });
  const j = r.json();
  out[svc] = { identify: j.catalogItems?.features?.map((f) => f.attributes) ?? j, value: j.value };
  console.log(svc, "identify:", JSON.stringify(out[svc]).slice(0, 900));
  const half = 40; // 80 m window
  const bbox = `${x - half},${y - half},${x + half},${y + half}`;
  const img = await request(`${base}/${svc}/ImageServer/exportImage?bbox=${bbox}&bboxSR=${wk}&imageSR=${wk}&size=400,400&format=jpg&f=image`, { cacheName: `lomb-export-${svc}-ring80m.jpg` });
  console.log(svc, "export 80 m window:", img.status, img.bytes.length, "B (0.2 m/px native)");
}
await writeFile(EVID + "/lombardia-ortofoto-identify.json", JSON.stringify({ retrievedUtc: new Date().toISOString(), note: "point = Piazzale Lodi centroid (public landmark)", out }, null, 1));
