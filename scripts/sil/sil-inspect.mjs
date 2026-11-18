/**
 * Development-time inspector of Lastrico's road intelligence: a single local HTML page (MapLibre inlined; the only
 * network use is the optional OpenStreetMap raster background) with one line per base segment of a bounding box.
 *
 *   node scripts/sil/sil-inspect.mjs --layers=<build>/layers [--bbox=minLon,minLat,maxLon,maxLat] [--out=work/sil-viewer.html]
 *
 * For every segment: street name, base surface material and smoothness tag (OSM, as compiled), and what each
 * separate source says about mapped rails: OSM, Milan DBT (shared carriageway / own right of way / other),
 * ATM scheduled line within 12 m, with the states "mapped", "asked, nothing mapped" and "unknown". Colours
 * follow the evidence, never a roughness prediction: a mapped tram track is not cobblestone and not "uncomfortable".
 * The output mixes ODbL, CC BY (DBT, version in conflict) and CC BY 4.0 data. It is for internal inspection only:
 * keep it out of Git and never publish it (licence table: outputs/phase440-sil-runtime-shadow-report.md section 4).
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SIL_LAYER_SOURCES, checkSilLayerTile, checkSilManifest, openSilLayerTile, tupleFingerprint } from "../../lib/sil-layers.ts";
import { silStateCode } from "../../lib/sil-shadow.ts";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const STATE = ["unknown", "asked-none", "mapped", "unavailable"];
const DBT_CLASS = ["-", "shared carriageway", "own right of way", "other"];
const lengthM = (c) => Math.hypot((c[2] - c[0]) * 111_320 * Math.cos((((c[1] + c[3]) / 2) * Math.PI) / 180), (c[3] - c[1]) * 110_540);
// Public Lodi landmark box by default (Piazzale Lodi, Corso Lodi, Via Friuli, Via Lazzaro Papi).
export const DEFAULT_BBOX = [9.198, 45.446, 9.214, 45.456];

export async function collectSegments({ layersDir, tilesDir = join(root, "data/surfaces/milan-tiles"), bbox = DEFAULT_BBOX }) {
  const meta = JSON.parse(await readFile(join(tilesDir, "metadata.json"), "utf8"));
  const manifestCheck = checkSilManifest(JSON.parse(await readFile(join(layersDir, "manifest.json"), "utf8")));
  if (!manifestCheck.ok) throw new Error(`manifest: ${manifestCheck.reason}`);
  const manifest = manifestCheck.value;
  const consulted = Object.fromEntries(SIL_LAYER_SOURCES.map((l) => [l, !!manifest.sources[l]]));
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const features = [];
  const seen = new Set();
  const counts = { segments: 0, metres: 0, byOsm: {}, byDbt: {}, atmServedMetres: 0, conflictSegments: 0 };
  for (const file of (await readdir(tilesDir)).filter((f) => /^\d+_\d+\.json$/.test(f)).sort()) {
    const key = file.slice(0, -5);
    const tuples = JSON.parse(await readFile(join(tilesDir, file), "utf8")).tuples;
    const inBox = tuples.map((t, i) => [t, i]).filter(([t]) => Math.max(t[2][0], t[2][2]) >= minLon && Math.min(t[2][0], t[2][2]) <= maxLon
      && Math.max(t[2][1], t[2][3]) >= minLat && Math.min(t[2][1], t[2][3]) <= maxLat);
    if (!inBox.length) continue;
    const fingerprint = tupleFingerprint(tuples);
    const opened = {};
    for (const layer of SIL_LAYER_SOURCES) {
      if (!consulted[layer]) continue;
      if (manifest.tiles[layer]?.[key] === undefined) { opened[layer] = "none"; continue; }
      const checked = checkSilLayerTile(JSON.parse(await readFile(join(layersDir, layer, `${key}.json`), "utf8")), layer, key, manifest, fingerprint, tuples.length);
      opened[layer] = checked.ok ? openSilLayerTile(checked.value) : "unavailable";
    }
    for (const [t, i] of inBox) {
      const id = `${t[0]}|${t[2].join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const code = silStateCode(opened, i);
      const osm = code & 3;
      const dbt = (code >> 2) & 3;
      const dbtClass = (code >> 4) & 3;
      const atm = (code >> 6) & 3;
      const len = lengthM(t[2]);
      const tag = meta.tagSets[t[10]] ?? {};
      // Conflict: one source maps rails here and the other asked and found none.
      const conflict = (osm === 2 && dbt === 1) || (dbt === 2 && osm === 1);
      counts.segments++;
      counts.metres += len;
      counts.byOsm[STATE[osm]] = (counts.byOsm[STATE[osm]] ?? 0) + len;
      counts.byDbt[STATE[dbt]] = (counts.byDbt[STATE[dbt]] ?? 0) + len;
      if (atm === 1) counts.atmServedMetres += len;
      if (conflict) counts.conflictSegments++;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[t[2][0], t[2][1]], [t[2][2], t[2][3]]] },
        properties: {
          way: t[0], name: meta.names[t[1]] ?? "", surface: meta.surfaceVals[t[5]] ?? "unknown", smoothness: tag.smoothness ?? null,
          len: Math.round(len * 10) / 10, osm: STATE[osm], dbt: STATE[dbt], dbtClass: DBT_CLASS[dbtClass],
          atm: atm === 1 ? "scheduled line within 12 m" : atm === 3 ? "unavailable" : "no scheduled line in the file", conflict,
        },
      });
    }
  }
  for (const group of [counts.byOsm, counts.byDbt]) for (const k of Object.keys(group)) group[k] = Math.round(group[k]);
  counts.metres = Math.round(counts.metres);
  counts.atmServedMetres = Math.round(counts.atmServedMetres);
  const sources = Object.fromEntries(Object.entries(manifest.sources).map(([k, v]) => [k, { license: v.licenceId ?? null, datasetDate: v.datasetDate ?? v.retrievedAt ?? null }]));
  return { datasetVersion: manifest.datasetVersion, sources, counts, centre: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], geojson: { type: "FeatureCollection", features } };
}

const PALETTES = {
  rails: { l: [["#d95f02", "rails mapped, shared carriageway (DBT)"], ["#7570b3", "rails mapped (own right of way, or OSM only)"], ["#1b9e77", "asked, nothing mapped (not proof of absence)"], ["#9e9e9e", "unknown"]] },
  surface: { l: [["#b30000", "sett / unhewn cobblestone (as tagged)"], ["#e6550d", "paving stones"], ["#2b8cbe", "asphalt"], ["#756bb1", "other"], ["#9e9e9e", "unknown"]] },
  coverage: { l: [["#e41a1c", "sources disagree"], ["#4daf4a", "mapped"], ["#377eb8", "asked, none mapped"], ["#9e9e9e", "unknown"]] },
  atm: { l: [["#ff7f00", "scheduled ATM line within 12 m"], ["#bdbdbd", "no scheduled line in the file"]] },
};

export function renderHtml(data, maplibreJs, maplibreCss) {
  const centre = data.centre;
  const sourcesText = Object.entries(data.sources).map(([k, v]) => `${k} ${v.license ?? "?"} ${v.datasetDate ?? ""}`).join("; ");
  const script = `
const data=${JSON.stringify(data.geojson)};
const LEGEND=${JSON.stringify(Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v.l])))};
const pick={
 rails:f=>f.dbt==="mapped"||f.osm==="mapped"?(f.dbtClass==="shared carriageway"?"#d95f02":"#7570b3"):f.dbt==="asked-none"||f.osm==="asked-none"?"#1b9e77":"#9e9e9e",
 surface:f=>({sett:"#b30000",unhewn_cobblestone:"#b30000",paving_stones:"#e6550d",asphalt:"#2b8cbe",unknown:"#9e9e9e"})[f.surface]||"#756bb1",
 coverage:f=>f.conflict?"#e41a1c":f.osm==="mapped"||f.dbt==="mapped"?"#4daf4a":f.osm==="asked-none"||f.dbt==="asked-none"?"#377eb8":"#9e9e9e",
 atm:f=>f.atm.startsWith("scheduled")?"#ff7f00":"#bdbdbd"};
const by=document.getElementById("by"),legend=document.getElementById("legend"),info=document.getElementById("info");
const map=new maplibregl.Map({container:"map",center:${JSON.stringify(centre)},zoom:15,style:{version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"OpenStreetMap contributors"}},layers:[{id:"bg",type:"raster",source:"osm",paint:{"raster-opacity":0.5}}]}});
function paint(){for(const f of data.features)f.properties.color=pick[by.value](f.properties);map.getSource("seg").setData(data);
 legend.innerHTML=LEGEND[by.value].map(([c,t])=>'<div><span class="sw" style="background:'+c+'"></span>'+t+'</div>').join("")}
map.on("style.load",()=>{map.resize();map.addSource("seg",{type:"geojson",data});map.addLayer({id:"seg",type:"line",source:"seg",paint:{"line-color":["get","color"],"line-width":5}});paint();
 map.on("click","seg",e=>{const p=e.features[0].properties;info.textContent=[p.name||"(no name)","way "+p.way+" - "+p.len+" m","surface: "+p.surface+(p.smoothness?" - smoothness: "+p.smoothness:""),"OSM rails: "+p.osm,"DBT rails: "+p.dbt+(p.dbtClass!=="-"?" ("+p.dbtClass+")":""),"ATM: "+p.atm,p.conflict===true||p.conflict==="true"?"SOURCES DISAGREE":""].filter(Boolean).join("\\n")});
 map.on("mouseenter","seg",()=>{map.getCanvas().style.cursor="pointer"});map.on("mouseleave","seg",()=>{map.getCanvas().style.cursor=""})});
by.onchange=paint;`;
  return `<!doctype html><meta charset="utf-8"><title>Lastrico road intelligence (internal)</title><style>${maplibreCss}
html,body{margin:0;height:100%}#map{position:absolute;inset:0}body{font:13px system-ui}#panel{position:absolute;top:8px;left:8px;max-width:330px;background:#fffffff0;padding:10px;border-radius:6px;z-index:2}
#info{margin-top:8px;white-space:pre-wrap;font-size:12px}.sw{display:inline-block;width:12px;height:4px;margin-right:4px}</style>
<div id="map"></div><div id="panel"><b>Road intelligence - ${data.datasetVersion}</b><br><i>Internal inspection only: mixed licences, never publish.</i><br>
<label>Colour by <select id="by"><option value="rails">Mapped rails (OSM / DBT)</option><option value="surface">Surface material</option><option value="coverage">Coverage state</option><option value="atm">ATM scheduled line</option></select></label>
<div id="legend"></div><div id="info">Click a segment.</div>
<div>${data.counts.segments} segments, ${data.counts.metres} m, ${data.counts.conflictSegments} source conflicts.</div><div style="font-size:11px">${sourcesText}</div></div>
<script>${maplibreJs}</script><script>${script}</script>`;
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const bbox = arg("bbox")?.split(",").map(Number) ?? DEFAULT_BBOX;
  const data = await collectSegments({ layersDir: resolve(arg("layers")), bbox });
  const js = await readFile(join(root, "node_modules/maplibre-gl/dist/maplibre-gl.js"), "utf8");
  const css = await readFile(join(root, "node_modules/maplibre-gl/dist/maplibre-gl.css"), "utf8");
  const out = resolve(arg("out") ?? join(root, "work/sil-viewer.html"));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderHtml(data, js, css));
  console.log(JSON.stringify({ out, datasetVersion: data.datasetVersion, bbox, ...data.counts }, null, 1));
}
