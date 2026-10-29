/** Coverage of the archived linear OSM pilot network, not an estimate of citywide coverage. */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultReportOutputPath = join(rootDir, "outputs/road-intelligence-quality-report.md");

export async function generateQualityReport({ outputPath = defaultReportOutputPath } = {}) {
  const segments = JSON.parse(await readFile(join(rootDir, "data/surfaces/milan-central.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(rootDir, "data/surfaces/milan-central.manifest.json"), "utf8"));
  const sum = (items) => items.reduce((total, segment) => total + segment.lengthMeters, 0);
  const total = sum(segments);
  const known = sum(segments.filter((s) => s.surfaceCategory !== "unknown"));
  const percent = (meters) => total ? (meters / total * 100).toFixed(2) : "0.00";
  const categories = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
  const categoryRows = categories.map((category) => {
    const meters = sum(segments.filter((s) => s.surfaceCategory === category));
    return `| ${category} | ${meters.toFixed(1)} | ${percent(meters)}% |`;
  });
  const tagged = sum(segments.filter((s) => (typeof s.rawTags?.surface === "string" && s.rawTags.surface.trim()) || (typeof s.rawTags?.surface_bike === "string" && s.rawTags.surface_bike.trim())));
  const smoothness = sum(segments.filter((s) => s.smoothness.state === "known"));
  const cycling = sum(segments.filter((s) => s.cycling.value?.hasFacility));
  const classRows = [...new Set(segments.map((s) => s.highwayClass))].sort().map((highway) => {
    const items = segments.filter((s) => s.highwayClass === highway);
    const meters = sum(items);
    const classified = sum(items.filter((s) => s.surfaceCategory !== "unknown"));
    return `| ${highway} | ${meters.toFixed(1)} | ${meters ? (classified / meters * 100).toFixed(2) : "0.00"}% |`;
  });
  const markdown = `# Lastrico — OSM pilot coverage

Dataset: ${manifest.datasetVersion}. Acquisition completed: ${manifest.sources[0].snapshotDate}.

## Denominator and limits

${manifest.area.description}. Bounds: ${JSON.stringify(manifest.area.bounds)}.

${manifest.area.denominator}

The four API map responses contain all highway ways returned for the requested tiles, without any surface filter. ${manifest.validation.excludedAreaWays} area polygons are excluded from the linear network. ${manifest.validation.invalidWays} invalid ways are excluded. Geometry is clipped to the pilot bounds. This does not establish completeness of OSM against streets on the ground. **Citywide Milan coverage is not measured.** Outside the pilot, this archive supplies no Road Intelligence evidence.

## Measured composition

| Metric | Value |
| --- | --- |
| Linear highway ways | ${manifest.statistics.totalWays} |
| Segments | ${segments.length} |
| Total processed length | ${(total / 1000).toFixed(3)} km |
| Known Surface Classification | ${percent(known)}% |
| Explicit surface tag present (including nonspecific values) | ${percent(tagged)}% |
| Known smoothness tag | ${percent(smoothness)}% |
| Cycling facility evidence | ${percent(cycling)}% |

| Classification | Metres | Share of pilot linear network |
| --- | --- | --- |
${categoryRows.join("\n")}

Generic surface=paved is not confirmed smooth. Unknown classification includes missing, nonspecific and unsupported surface values; absence of roughness evidence is not smoothness evidence. Surface material does not establish physical ride comfort. These lengths include mapped sidewalks, pedestrian ways, cycleways and steps as well as motor roads; access eligibility is evaluated per mode at runtime.

| Highway class | Metres | Classified surface within class |
| --- | --- | --- |
${classRows.join("\n")}

## Provenance and reproduction

Source: [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map). © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/).

Original API JSON responses are archived losslessly as gzip under data/sources/. Their exact request URLs, retrieval times, SHA-256 checksums and bbox are in data/sources/milan-pilot-osm.source.json. The responses were fetched sequentially, not as an atomic historical snapshot. Element version/edit timestamps are retained in the derived way file; they are not physical observation dates. No municipal dataset is merged into these metrics.

Reproduce offline: node scripts/osm/build-representative-network.mjs, then node scripts/osm/ingest.mjs, then node scripts/osm/quality-report.mjs. To explicitly refresh from the API, run the builder with --download first. Network or checksum errors abort; there is no fabricated fallback.

Normalized dataset SHA-256: ${manifest.checksums.datasetSha256}.
`;
  await writeFile(outputPath, markdown);
  return { totalLengthKm: (total / 1000).toFixed(2), reportOutputPath: outputPath, surfaceCertaintyPercent: percent(known), citywideCoveragePercent: null };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateQualityReport().then(console.log).catch((error) => { console.error(error); process.exitCode = 1; });
}
