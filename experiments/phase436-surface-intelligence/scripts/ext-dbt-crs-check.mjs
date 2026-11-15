/** Validate the Node-only UTM32N inverse against the server's own EPSG:7791 -> EPSG:4326 conversion (same features fetched in both CRS). */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE } from "./ext-http.mjs";
import { fromUtm32, toUtm32 } from "./lib/utm.mjs";
let worst = 0, n = 0, sum = 0;
const mDeg = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540);
for (const id of [19, 1]) {
  const nat = JSON.parse(await readFile(join(CACHE, `dbt-box-${id}-native.json`), "utf8"));
  const wgs = JSON.parse(await readFile(join(CACHE, `dbt-box-${id}-wgs.json`), "utf8"));
  const key = (f) => JSON.stringify(f.attributes);
  const wmap = new Map(wgs.features.map((f) => [f.attributes.OBJECTID, f]));
  for (const f of nat.features) {
    const w = wmap.get(f.attributes.OBJECTID); if (!w) continue;
    f.geometry.paths.forEach((path, pi) => path.forEach((p, i) => {
      const mine = fromUtm32(p[0], p[1]); const srv = w.geometry.paths[pi][i];
      const d = mDeg(mine, srv); worst = Math.max(worst, d); sum += d; n += 1;
    }));
  }
}
console.log(`vertices compared: ${n}; mean diff ${(sum / n).toFixed(3)} m; worst ${worst.toFixed(3)} m`);
const rt = toUtm32(9.21, 45.447); const back = fromUtm32(rt[0], rt[1]);
console.log("round trip (9.210,45.447) ->", rt.map((v) => v.toFixed(2)).join(","), "->", back.map((v) => v.toFixed(7)).join(","));
