/** List layers of the Comune di Milano DBGT 2020 ArcGIS service (metadata only). */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const base = "https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer";
const r = await request(`${base}?f=pjson`, { cacheName: "dbt-rest-mapserver.json", accept: "application/json" });
const j = r.json();
console.log("HTTP", r.status, "| name:", j.mapName, "| desc:", (j.serviceDescription || "").slice(0, 400), "| copyright:", j.copyrightText, "| spatialRef:", JSON.stringify(j.spatialReference), "| capabilities:", j.capabilities, "| maxRecordCount:", j.maxRecordCount);
console.log("layers:", (j.layers || []).length);
for (const l of j.layers || []) console.log(`${l.id}\t${l.name}\tparent=${l.parentLayerId}\tsub=${(l.subLayerIds || []).join(",")}\tminScale=${l.minScale}`);
await writeFile(join(EVID, "dbt-rest-layers.json"), JSON.stringify({ retrievedUtc: new Date().toISOString(), service: base, mapName: j.mapName, serviceDescription: j.serviceDescription, copyrightText: j.copyrightText, spatialReference: j.spatialReference, capabilities: j.capabilities, maxRecordCount: j.maxRecordCount, layers: j.layers }, null, 1));
