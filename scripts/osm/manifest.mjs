/**
 * Manifest generator for Road Intelligence datasets
 */
import { createHash } from "node:crypto";
import { MILAN_BOUNDS } from "./config.mjs";

export function generateManifest({
  datasetVersion,
  datasetBuffer,
  segments,
  waysCount,
  sourceDate = "2026-10-25T00:00:00Z",
}) {
  const sha256 = createHash("sha256").update(datasetBuffer).digest("hex");

  const surfaceBreakdownMeters = {
    confirmed_rough: 0,
    probable_rough: 0,
    confirmed_smooth: 0,
    unpaved_loose: 0,
    unknown: 0,
  };

  const smoothnessBreakdownMeters = {
    excellent: 0,
    good: 0,
    intermediate: 0,
    bad: 0,
    very_bad: 0,
    horrible: 0,
    very_horrible: 0,
    impassable: 0,
    unknown: 0,
  };

  let totalLengthMeters = 0;
  let cyclingCoverageMeters = 0;
  let embeddedRailsMeters = 0;

  for (const seg of segments) {
    const len = seg.lengthMeters;
    totalLengthMeters += len;

    const cat = seg.surfaceCategory || "unknown";
    surfaceBreakdownMeters[cat] = (surfaceBreakdownMeters[cat] || 0) + len;

    const sm = seg.smoothness?.value || "unknown";
    smoothnessBreakdownMeters[sm] = (smoothnessBreakdownMeters[sm] || 0) + len;

    if (seg.cycling?.value?.hasFacility) {
      cyclingCoverageMeters += len;
    }
    if (seg.embeddedRails) {
      embeddedRailsMeters += len;
    }
  }

  // Round breakdown meters
  for (const k of Object.keys(surfaceBreakdownMeters)) {
    surfaceBreakdownMeters[k] = Math.round(surfaceBreakdownMeters[k]);
  }
  for (const k of Object.keys(smoothnessBreakdownMeters)) {
    smoothnessBreakdownMeters[k] = Math.round(smoothnessBreakdownMeters[k]);
  }

  return {
    schemaVersion: "2.0.0",
    datasetVersion,
    generatedAt: new Date().toISOString(),
    area: {
      zoneId: "MIL_CENTRAL",
      description: "Milan Pilot Area (Central & Inner Ring)",
      bounds: MILAN_BOUNDS,
    },
    sources: [
      {
        type: "osm",
        name: "OpenStreetMap",
        license: "ODbL-1.0",
        licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
        attribution: "© OpenStreetMap contributors",
        snapshotDate: sourceDate,
      },
    ],
    statistics: {
      totalSegments: segments.length,
      totalWays: waysCount,
      totalLengthMeters: Math.round(totalLengthMeters),
      surfaceBreakdownMeters,
      smoothnessBreakdownMeters,
      cyclingCoverageMeters: Math.round(cyclingCoverageMeters),
      embeddedRailsMeters: Math.round(embeddedRailsMeters),
    },
    checksums: {
      datasetSha256: sha256,
    },
  };
}
