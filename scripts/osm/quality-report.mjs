/**
 * Data Quality and Coverage Report Generator for Lastrico Road Intelligence
 * Implements reproducible, length-weighted coverage and quality metrics.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");
const datasetPath = join(rootDir, "data/surfaces/milan-central.json");
const manifestPath = join(rootDir, "data/surfaces/milan-central.manifest.json");
const reportOutputPath = join(rootDir, "outputs/road-intelligence-quality-report.md");

export async function generateQualityReport() {
  const [datasetRaw, manifestRaw] = await Promise.all([
    readFile(datasetPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);

  const segments = JSON.parse(datasetRaw);
  const manifest = JSON.parse(manifestRaw);

  const metricsByClass = {};
  let totalLength = 0;
  let knownSurfaceLength = 0;
  let unknownSurfaceLength = 0;
  let knownSmoothnessLength = 0;
  let cyclingLength = 0;
  let embeddedRailsLength = 0;
  let conflictingLength = 0;

  for (const seg of segments) {
    const len = seg.lengthMeters;
    const hClass = seg.highwayClass || "unclassified";
    totalLength += len;

    if (!metricsByClass[hClass]) {
      metricsByClass[hClass] = {
        totalMeters: 0,
        knownSurfaceMeters: 0,
        unknownSurfaceMeters: 0,
        knownSmoothnessMeters: 0,
        cyclingMeters: 0,
        roughMeters: 0,
      };
    }
    const stat = metricsByClass[hClass];
    stat.totalMeters += len;

    const hasKnownSurface = seg.surfaceCategory !== "unknown";
    if (hasKnownSurface) {
      knownSurfaceLength += len;
      stat.knownSurfaceMeters += len;
      if (seg.surfaceCategory === "confirmed_rough" || seg.surfaceCategory === "probable_rough") {
        stat.roughMeters += len;
      }
    } else {
      unknownSurfaceLength += len;
      stat.unknownSurfaceMeters += len;
    }

    if (seg.smoothness?.state === "known" && seg.smoothness.value !== "unknown") {
      knownSmoothnessLength += len;
      stat.knownSmoothnessMeters += len;
    }

    if (seg.cycling?.value?.hasFacility) {
      cyclingLength += len;
      stat.cyclingMeters += len;
    }

    if (seg.embeddedRails) {
      embeddedRailsLength += len;
    }

    if (seg.surface?.state === "conflicting") {
      conflictingLength += len;
    }
  }

  const surfaceCertaintyPercent = totalLength > 0 ? ((knownSurfaceLength / totalLength) * 100).toFixed(2) : "0.00";
  const smoothnessCoveragePercent = totalLength > 0 ? ((knownSmoothnessLength / totalLength) * 100).toFixed(2) : "0.00";
  const cyclingCoveragePercent = totalLength > 0 ? ((cyclingLength / totalLength) * 100).toFixed(2) : "0.00";

  let markdown = `# Lastrico Road Intelligence — Data Quality & Coverage Report

**Generated:** ${new Date().toISOString()}  
**Dataset Version:** ${manifest.datasetVersion}  
**Zone:** ${manifest.area.description} (${manifest.area.zoneId})  
**SHA-256 Checksum:** \`${manifest.checksums.datasetSha256}\`  

---

## 1. Executive Summary & Quality Scorecard

| Metric | Measured Value | Unit / Scale |
| :--- | :--- | :--- |
| **Total Processed Road Length** | **${(totalLength / 1000).toFixed(2)}** | km |
| **Total Segment Records** | **${segments.length.toLocaleString()}** | directed segments |
| **Unique Source OSM Ways** | **${manifest.statistics.totalWays.toLocaleString()}** | ways |
| **Known Surface Classification** | **${(knownSurfaceLength / 1000).toFixed(2)} km** (${surfaceCertaintyPercent}%) | length-weighted |
| **Unknown Surface Classification** | **${(unknownSurfaceLength / 1000).toFixed(2)} km** (${(100 - parseFloat(surfaceCertaintyPercent)).toFixed(2)}%) | length-weighted |
| **Known Smoothness Availability** | **${(knownSmoothnessLength / 1000).toFixed(2)} km** (${smoothnessCoveragePercent}%) | length-weighted |
| **Cycling Infrastructure Exposure** | **${(cyclingLength / 1000).toFixed(2)} km** (${cyclingCoveragePercent}%) | length-weighted |
| **Embedded Tram Rails Hazard Length**| **${(embeddedRailsLength / 1000).toFixed(2)} km** | length-weighted |
| **Invalid Geometries Excluded** | **${manifest.validation.invalidWays}** | ways |
| **Flagged Jumps (> 250m)** | **${manifest.validation.flaggedJumpsOver250m}** | ways (e.g. Way 4011978) |
| **Attribute Conflicts Detected** | **${conflictingLength}** | meters |

---

## 2. Length-Weighted Coverage by Functional Road Class

| Road Class (\`highway\`) | Total (km) | Known Surface (km) | Rough Surface (km) | Surface Coverage (%) | Smoothness Known (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

  const sortedClasses = Object.entries(metricsByClass).sort((a, b) => b[1].totalMeters - a[1].totalMeters);

  for (const [cls, s] of sortedClasses) {
    const covPct = s.totalMeters > 0 ? ((s.knownSurfaceMeters / s.totalMeters) * 100).toFixed(1) : "0.0";
    const smPct = s.totalMeters > 0 ? ((s.knownSmoothnessMeters / s.totalMeters) * 100).toFixed(1) : "0.0";
    markdown += `| \`${cls}\` | ${(s.totalMeters / 1000).toFixed(2)} | ${(s.knownSurfaceMeters / 1000).toFixed(2)} | ${(s.roughMeters / 1000).toFixed(2)} | ${covPct}% | ${smPct}% |\n`;
  }

  markdown += `
---

## 3. Surface Material Distribution

| Category | Length (km) | Share (%) |
| :--- | :--- | :--- |
| **Confirmed Rough** (\`sett\`, \`cobblestone\`, \`unhewn_cobblestone\`) | **${(manifest.statistics.surfaceBreakdownMeters.confirmed_rough / 1000).toFixed(2)}** | ${((manifest.statistics.surfaceBreakdownMeters.confirmed_rough / totalLength) * 100).toFixed(1)}% |
| **Probable Rough** (\`paving_stones\`) | **${(manifest.statistics.surfaceBreakdownMeters.probable_rough / 1000).toFixed(2)}** | ${((manifest.statistics.surfaceBreakdownMeters.probable_rough / totalLength) * 100).toFixed(1)}% |
| **Confirmed Smooth** (\`asphalt\`, \`concrete\`) | **${(manifest.statistics.surfaceBreakdownMeters.confirmed_smooth / 1000).toFixed(2)}** | ${((manifest.statistics.surfaceBreakdownMeters.confirmed_smooth / totalLength) * 100).toFixed(1)}% |
| **Unpaved Loose** (\`compacted\`, \`gravel\`) | **${(manifest.statistics.surfaceBreakdownMeters.unpaved_loose / 1000).toFixed(2)}** | ${((manifest.statistics.surfaceBreakdownMeters.unpaved_loose / totalLength) * 100).toFixed(1)}% |
| **Unknown Surface** | **${(manifest.statistics.surfaceBreakdownMeters.unknown / 1000).toFixed(2)}** | ${((manifest.statistics.surfaceBreakdownMeters.unknown / totalLength) * 100).toFixed(1)}% |

---

## 4. Source Attribution & Compliance

- **OpenStreetMap Data:** Licensed under [Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1.0/). Attribution: © OpenStreetMap contributors.
- **Municipal Cycling Data Adapter:** Licensed under [Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Attribution: Comune di Milano.
- **Integrity Rule:** No observation timestamps are fabricated. Smoothness is strictly separated from surface material.
`;

  await writeFile(reportOutputPath, markdown, "utf8");
  return {
    totalLengthKm: (totalLength / 1000).toFixed(2),
    reportOutputPath,
    surfaceCertaintyPercent,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateQualityReport()
    .then((res) => {
      console.log(`Quality report generated successfully: ${res.reportOutputPath}`);
      console.log(`- Total length: ${res.totalLengthKm} km`);
      console.log(`- Surface certainty: ${res.surfaceCertaintyPercent}%`);
    })
    .catch((err) => {
      console.error("Quality report generation failed:", err);
      process.exit(1);
    });
}
