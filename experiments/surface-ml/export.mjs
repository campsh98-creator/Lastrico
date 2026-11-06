/** Read-only adapter: authentic archives + actual current normalizer, never runtime writes. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { extractHighways } from '../../scripts/osm/build-representative-network.mjs';
import { normalizeOsmFeature } from '../../scripts/osm/normalize.mjs';

export const TAG_FEATURES = ['highway', 'service', 'junction', 'bridge', 'tunnel', 'oneway', 'lanes', 'maxspeed', 'lit', 'sidewalk', 'cycleway', 'bicycle', 'access'];
const POSITIVE = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'cobblestone:flattened:large_stone', 'milanese_paving', 'milanese_paving:rails', 'milanese_paving:lanes', 'pebblestone']);
const NEGATIVE = new Set(['asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'unpaved', 'compacted', 'gravel', 'fine_gravel', 'ground', 'dirt', 'earth']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const surfaceKey = key => /surface|smoothness|tracktype|material|pavement/i.test(key);
export function target(tags) {
  const material = String(tags.surface || '').trim().toLowerCase();
  return POSITIVE.has(material) ? 1 : NEGATIVE.has(material) ? 0 : null;
}
export function genuinelyUnknown(tags) {
  // Includes neither broad/ambiguous evidence nor normalizer-derived tracktype evidence.
  return !Object.keys(tags).some(key => surfaceKey(key) && String(tags[key]).trim());
}
export function allowedFeatures(tags) {
  return Object.fromEntries(TAG_FEATURES.map(key => [key, String(tags[key] || 'missing').toLowerCase()]));
}
export function exportDataset(root) {
  const inputs = {}, areas = {}, rows = [];
  for (const area of ['milan', 'roccella']) {
    const names = area === 'milan' ? ['milan-pilot-osm.source.json', 'milan-citywide-expansion.source.json'] : ['roccella-pilot-osm.source.json'];
    const responses = [];
    let sourceWays = 0;
    for (const name of names) {
      const path = `data/sources/${name}`;
      const manifestBytes = readFileSync(resolve(root, path));
      inputs[path] = sha(manifestBytes);
      const manifest = JSON.parse(manifestBytes);
      for (const source of manifest.sources) {
        const path = `data/sources/${source.file}`;
        const bytes = readFileSync(resolve(root, path));
        const raw = gunzipSync(bytes);
        if (sha(raw) !== source.sha256) throw new Error(`Archive checksum mismatch: ${path}`);
        if (source.gzipSha256 && sha(bytes) !== source.gzipSha256) throw new Error(`Gzip checksum mismatch: ${path}`);
        inputs[path] = sha(bytes);
        const data = JSON.parse(raw);
        sourceWays += data.elements.filter(e => e.type === 'way' && e.tags?.highway).length;
        responses.push(data);
      }
    }
    const ways = extractHighways(responses);
    let excludedPolygons = 0, excludedEmpty = 0;
    for (const way of ways) {
      if (way.tags.area === 'yes') { excludedPolygons++; continue; }
      const normalized = normalizeOsmFeature(way, { ingestedAt: 'offline-experiment', pilotArea: area });
      if (!normalized.segments.length) { excludedEmpty++; continue; }
      const maskedTags = Object.fromEntries(Object.entries(way.tags).filter(([key]) => !/surface|material|pavement/i.test(key)));
      const masked = normalizeOsmFeature({ ...way, tags: maskedTags }, { ingestedAt: 'offline-experiment', pilotArea: area });
      rows.push({
        id: `${area}:${way.id}`, area, coordinates: way.coordinates,
        label: target(way.tags), material: String(way.tags.surface || '').trim().toLowerCase(),
        unknown: genuinelyUnknown(way.tags), features: allowedFeatures(way.tags),
        length_m: normalized.segments.reduce((sum, edge) => sum + edge.lengthMeters, 0),
        rule_pave_masked: masked.surfaceCategory === 'confirmed_rough' || masked.surfaceCategory === 'probable_rough',
        rule_abstains_masked: masked.surfaceCategory === 'unknown',
        edges: normalized.segments.map(({ coordinates, modeAccess, modeDirections }) => ({ coordinates, modeAccess, modeDirections })),
      });
    }
    areas[area] = { sourceHighwayRecords: sourceWays, deduplicatedWays: ways.length, duplicateRecordsRemoved: sourceWays - ways.length, excludedPolygons, excludedEmpty };
  }
  for (const path of ['scripts/osm/normalize.mjs', 'scripts/osm/config.mjs', 'scripts/osm/build-representative-network.mjs']) inputs[path] = sha(readFileSync(resolve(root, path)));
  return { attribution: '© OpenStreetMap contributors; ODbL-1.0. Archived OSM tags are not a physical survey.', inputs, areas, rows };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(exportDataset(resolve(fileURLToPath(new URL('../..', import.meta.url))))));
}
