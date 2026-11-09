/** Rome: verified raw OSM archives -> clipped compact tiles. Offline by default. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractHighways } from './build-representative-network.mjs';
import { normalizeOsmFeature } from './normalize.mjs';
import { clipEdge } from './ingest.mjs';
import { compileCompactSegments } from './compile-compact-tiles.mjs';
import { generateChunks } from './generate-tile-chunks.mjs';
import { packRomeTiles } from './pack-rome-tiles.mjs';
export const ROME_BOUNDS = { west: 12.40, south: 41.80, east: 12.60, north: 41.97 };
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = join(root, 'data/sources');
const manifestPath = join(sourceDir, 'rome-osm.source.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const ROME_SECTORS = [
  { name: 'sw', bbox: [12.40, 41.80, 12.50, 41.885] },
  { name: 'se', bbox: [12.50, 41.80, 12.60, 41.885] },
  { name: 'nw', bbox: [12.40, 41.885, 12.50, 41.97] },
  { name: 'ne', bbox: [12.50, 41.885, 12.60, 41.97] },
];
function adapt(response) {
  if (!Array.isArray(response.elements) || response.remark) throw new Error('Incomplete OSM response');
  return { ...response, generator: 'openstreetmap-overpass-adapter' };
}
export async function buildRome({ download = false } = {}) {
  await mkdir(sourceDir, { recursive: true });
  if (download) {
    const sources = [];
    for (const sector of ROME_SECTORS) {
      const [w,s,e,n] = sector.bbox;
      const query = `[out:json][timeout:90];way["highway"](${s},${w},${n},${e});out meta;>;out skel qt;`;
      const file = `rome-${sector.name}.osm.json.gz`;
      let downloaded = false;
      for (const endpoint of ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
        try {
          console.log(`Acquiring ${sector.name}: ${endpoint}`);
          const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'Lastrico-Rome-Pilot/0.5 (https://github.com/campsh98-creator/Lastrico)', Accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw = Buffer.from(await response.arrayBuffer());
          const json = JSON.parse(raw);
          const ways = extractHighways([adapt(json)]);
          if (!ways.length) throw new Error('Empty highway response');
          const gz = gzipSync(raw, { level:9 });
          await writeFile(join(sourceDir,file),gz);
          sources.push({file,url:endpoint,query,bbox:sector.bbox,retrievedAt:new Date().toISOString(),serverDate:response.headers.get('date'),osmBaseTimestamp:json.osm3s?.timestamp_osm_base ?? null,sha256:hash(raw),gzipSha256:hash(gz),ways:ways.length});
          downloaded = true; break;
        } catch (error) { console.warn(`${sector.name}: ${error.message}`); }
      }
      if (!downloaded) throw new Error(`No genuine data acquired for ${sector.name}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await writeFile(manifestPath, JSON.stringify({provider:'OpenStreetMap via public Overpass',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',licenseUrl:'https://opendatacommons.org/licenses/odbl/1.0/',bounds:ROME_BOUNDS,temporalScope:'Sequential live responses, not an atomic snapshot or field survey.',selection:'All highway ways, including unknown surfaces and restricted roads; area=yes excluded; edges clipped to rectangular operational bounds. Not the entire municipality.',sources},null,2)+'\n');
  }
  const provenance = JSON.parse(await readFile(manifestPath,'utf8'));
  const responses = [];
  for (const source of provenance.sources) {
    const gz = await readFile(join(sourceDir,source.file));
    const raw = gunzipSync(gz);
    if(hash(raw)!==source.sha256 || hash(gz)!==source.gzipSha256) throw new Error(`Checksum mismatch ${source.file}`);
    responses.push(adapt(JSON.parse(raw)));
  }
  const ways = extractHighways(responses);
  const generatedAt = provenance.sources.map(s=>s.retrievedAt).sort().at(-1);
  const segments = []; let excludedAreaWays = 0;
  for (const way of ways) {
    if(way.tags.area==='yes') {excludedAreaWays++;continue;}
    for(let i=1;i<way.coordinates.length;i++) {
      const edge = clipEdge(way.coordinates[i-1],way.coordinates[i],ROME_BOUNDS);
      if(!edge) continue;
      for(const segment of normalizeOsmFeature({...way,coordinates:edge},{ingestedAt:generatedAt,pilotArea:'ROME_PILOT'}).segments) {
        // Inferred tracktype is not confirmed material evidence. Keep it unknown.
        if(segment.surface.state !== 'known') {segment.surfaceCategory='unknown';segment.roughnessWeight=0;segment.surface.value='unknown';}
        segments.push(segment);
      }
    }
  }
  segments.sort((a,b)=>a.osmWayId-b.osmWayId || a.segmentHash.localeCompare(b.segmentHash));
  // Hash the canonical JSON array incrementally; Rome exceeds V8's single-string limit.
  const digest = createHash('sha256'); digest.update('[');
  segments.forEach((segment, index) => { if(index) digest.update(','); digest.update(JSON.stringify(segment)); });
  digest.update(']');
  const datasetSha256 = digest.digest('hex');
  const meters = {confirmed_rough:0,probable_rough:0,confirmed_smooth:0,unpaved_loose:0,unknown:0};
  const restrictions = {conditionalSegments:0,restrictedAllModes:0,motorcycleCarDifferences:0,smoothnessTagged:0};
  for(const s of segments) {
    meters[s.surfaceCategory]+=s.lengthMeters;
    if(Object.keys(s.rawTags).some(k=>k.includes(':conditional')))restrictions.conditionalSegments++;
    if(!Object.values(s.modeAccess).some(Boolean))restrictions.restrictedAllModes++;
    if(s.modeAccess.car!==s.modeAccess.motorcycle)restrictions.motorcycleCarDifferences++;
    if(s.rawTags.smoothness)restrictions.smoothnessTagged++;
  }
  const manifest = {schemaVersion:'2.0.0',datasetVersion:`osm-rome-${generatedAt.slice(0,10)}`,generatedAt,area:{zoneId:'ROME_PILOT',bounds:ROME_BOUNDS,description:'Connected rectangular urban Rome pilot: EUR to northern urban corridors. Not complete municipal coverage.',denominator:'All linear OSM highway way edges clipped to bounds, each way once; includes restricted and unknown roads. Centreline km, not lane-km.'},sources:[provenance],statistics:{ways:ways.length,excludedAreaWays,totalSegments:segments.length,totalLengthMeters:Object.values(meters).reduce((a,b)=>a+b,0),surfaceBreakdownMeters:meters,restrictions},checksums:{datasetSha256,sourceManifestSha256:hash(await readFile(manifestPath))}};
  const compact = compileCompactSegments(segments,{manifest,slim:true,preserveRawTags:true});
  const path = join(root,'data/surfaces/rome-compact-tiles.json');
  const json = JSON.stringify(compact); await writeFile(path,json);
  await generateChunks('rome',path,join(root,'data/surfaces/rome-tiles'),join(root,'lib/rome-tile-index.ts'));
  // The Worker loads gzip-packed copies (lossless) so the upload stays below Cloudflare's 64 MiB limit.
  await packRomeTiles();
  manifest.statistics.tileCount=Object.keys(compact.tiles).length;
  manifest.statistics.compactBytes=Buffer.byteLength(json);
  manifest.statistics.compactGzipBytes=gzipSync(json).length;
  manifest.checksums.compactSha256=hash(json);
  await writeFile(join(root,'data/surfaces/rome-pilot.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest.statistics,null,2));
  return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) buildRome({download:process.argv.includes('--download')}).catch(e=>{console.error(e);process.exitCode=1;});
