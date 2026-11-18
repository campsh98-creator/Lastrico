/**
 * Phase 4.40: what the runtime would say about named public Milan corridors. Counts only, no coordinates.
 *
 *   node scripts/sil/sil-corridor-diagnostics.mjs --layers=<build>/layers [--fused=<build>/overlay] [--names="Corso Lodi,..."] [--out=file]
 *
 * Two views per street, both through the same composition code as a route request (lib/sil-shadow.ts):
 *   unique segments  every compiled segment of the street once, composed from the four layers
 *   as routes        every segment walked as its own two-point route through the full adapter (matching included),
 *                    to prove a street does not pick up rails from a crossing or neighbouring geometry
 * With --fused, the 4.39 fused overlay's rails-mapped count is shown next to the union of the separated layers.
 * Unknown is unknown: a street no source asked about is never reported as "no rails".
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SIL_LAYER_SOURCES, checkSilLayerTile, checkSilManifest, openSilLayerTile, tupleFingerprint } from "../../lib/sil-layers.ts";
import { configureSilShadow, resetSilShadowCache, silShadowDiagnostics, silStateCode, summariseSilRoute } from "../../lib/sil-shadow.ts";
import { createFsLayerProvider } from "../../tests/helpers/sil-fs-provider.mjs";

const NAMES = ["Corso Lodi", "Piazzale Lodi", "Via Lazzaro Papi", "Via Friuli", "Viale Umbria"];
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const lengthM = (c) => Math.hypot((c[2] - c[0]) * 111_320 * Math.cos((((c[1] + c[3]) / 2) * Math.PI) / 180), (c[3] - c[1]) * 110_540);

export async function corridorDiagnostics({ layersDir, tilesDir = join(root, "data/surfaces/milan-tiles"), names = NAMES, fusedDir = null }) {
  const meta = JSON.parse(await readFile(join(tilesDir, "metadata.json"), "utf8"));
  const manifestCheck = checkSilManifest(JSON.parse(await readFile(join(layersDir, "manifest.json"), "utf8")));
  if (!manifestCheck.ok) throw new Error(`manifest: ${manifestCheck.reason}`);
  const manifest = manifestCheck.value;
  const consulted = { osm: !!manifest.sources.osm, dbt: !!manifest.sources.dbt, atm: !!manifest.sources.atm, assoc: !!manifest.sources.assoc };
  const wanted = new Map(names.map((n) => [meta.names.indexOf(n), n]));
  const rows = Object.fromEntries(names.map((n) => [n, []]));
  const seen = new Set();
  for (const file of (await readdir(tilesDir)).filter((f) => /^\d+_\d+\.json$/.test(f)).sort()) {
    const key = file.slice(0, -5);
    const tuples = JSON.parse(await readFile(join(tilesDir, file), "utf8")).tuples;
    const hits = tuples.flatMap((t, i) => (wanted.has(t[1]) ? [[t, i]] : []));
    if (!hits.length) continue;
    const fingerprint = tupleFingerprint(tuples);
    const opened = {};
    for (const layer of SIL_LAYER_SOURCES) {
      if (!consulted[layer]) continue;
      if (manifest.tiles[layer]?.[key] === undefined) { opened[layer] = "none"; continue; }
      const checked = checkSilLayerTile(JSON.parse(await readFile(join(layersDir, layer, `${key}.json`), "utf8")), layer, key, manifest, fingerprint, tuples.length);
      opened[layer] = checked.ok ? openSilLayerTile(checked.value) : "unavailable";
    }
    let fused = new Map();
    if (fusedDir) { try { fused = new Map(JSON.parse(await readFile(join(fusedDir, `${key}.sil.json`), "utf8")).entries.map((e) => [e[0], e[1]])); } catch { /* no fused tile */ } }
    for (const [t, i] of hits) {
      const id = `${t[0]}|${t[2].join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows[wanted.get(t[1])].push({ c: t[2], len: lengthM(t[2]), code: silStateCode(opened, i), fusedMapped: (fused.get(i) ?? 0) & 1 });
    }
  }
  // as routes, through the whole adapter
  const { getSpatialRoadStore } = await import("../../lib/spatial-road-store.ts");
  const store = await getSpatialRoadStore("milan");
  const out = {};
  for (const name of names) {
    const list = rows[name];
    const acc = { byCode: new Float64Array(1 << 13), unmatched: 0, ambiguousRouteMatch: 0, total: 0 };
    let mappedSegments = 0, dbtSegments = 0, osmSegments = 0, askedSegments = 0, unknownSegments = 0, fusedMappedSegments = 0, noServiceSegments = 0;
    for (const row of list) {
      acc.byCode[row.code] += row.len;
      acc.total += row.len;
      const osm = row.code & 3, dbt = (row.code >> 2) & 3, atm = (row.code >> 6) & 3;
      const mapped = osm === 2 || dbt === 2;
      if (mapped) mappedSegments++;
      if (dbt === 2) dbtSegments++;
      if (osm === 2) osmSegments++;
      if (!mapped && (osm === 1 || dbt === 1)) askedSegments++;
      if (!mapped && osm !== 1 && dbt !== 1) unknownSegments++;
      if (mapped && atm === 0) noServiceSegments++;
      fusedMappedSegments += row.fusedMapped;
    }
    const unique = summariseSilRoute(acc, consulted);
    const keys = store.getTileKeysForCoordinates(list.flatMap((r) => [[r.c[0], r.c[1]], [r.c[2], r.c[3]]]), 12);
    await store.preloadTiles(keys);
    configureSilShadow({ mode: "shadow", provider: createFsLayerProvider(layersDir) });
    resetSilShadowCache();
    const routes = Object.fromEntries(list.map((r, i) => [`s${i}`, [[r.c[0], r.c[1]], [r.c[2], r.c[3]]]]));
    const asRoutes = await silShadowDiagnostics({ area: "milan", store, loadedTileKeys: keys, routes });
    const sum = (pick) => Object.values(asRoutes.routes).reduce((n, r) => n + (r.sameAs ? 0 : pick(r)), 0);
    out[name] = {
      segments: list.length, metres: Math.round(acc.total),
      uniqueSegments: { ...unique, segmentsRailsMapped: mappedSegments, segmentsDbtMapped: dbtSegments, segmentsOsmMapped: osmSegments, segmentsAskedNotMapped: askedSegments, segmentsUnknownCoverage: unknownSegments,
        segmentsMappedWithoutScheduledLine: noServiceSegments, ...(fusedDir ? { fusedOverlaySegmentsMapped: fusedMappedSegments } : {}) },
      asRoutes: { status: asRoutes.status, railsMappedMetres: Math.round(sum((r) => r.metres.railsMapped)), queriedNotMappedMetres: Math.round(sum((r) => r.metres.queriedNotMapped)),
        unknownCoverageMetres: Math.round(sum((r) => r.metres.unknownCoverage)), unmatchedMetres: Math.round(sum((r) => r.metres.unmatched)),
        ambiguousRouteMatchMetres: Math.round(sum((r) => r.ambiguity.routeMatchMetres)) },
    };
  }
  return { datasetVersion: manifest.datasetVersion, evidenceDates: Object.fromEntries(Object.entries(manifest.sources).map(([k, v]) => [k, v.datasetDate ?? null])), streets: out };
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await corridorDiagnostics({ layersDir: resolve(arg("layers")), names: arg("names")?.split(",") ?? NAMES, fusedDir: arg("fused") ? resolve(arg("fused")) : null });
  const text = JSON.stringify(result, null, 1);
  if (arg("out")) await writeFile(resolve(arg("out")), text + "\n");
  console.log(text);
}
