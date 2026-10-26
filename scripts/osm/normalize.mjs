/**
 * OSM tag normalizer and attribute provenance generator
 */
import {
  SURFACE_MATERIAL_MAP,
  SURFACE_CATEGORY_MAP,
  SURFACE_ROUGHNESS_WEIGHT,
  SMOOTHNESS_MAP,
  HIGHWAY_MAP,
} from "./config.mjs";
import { geographicDistance } from "./validate.mjs";

function calculateBearing(a, b) {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function computeSegmentHash(a, b, bearing, lengthCm) {
  const qLonA = Math.round(a[0] * 1000000) / 1000000;
  const qLatA = Math.round(a[1] * 1000000) / 1000000;
  const qLonB = Math.round(b[0] * 1000000) / 1000000;
  const qLatB = Math.round(b[1] * 1000000) / 1000000;
  const qBearing = Math.round(bearing * 10) / 10;
  const qLength = Math.round(lengthCm);

  const sig = `${qLonA},${qLatA}->${qLonB},${qLatB};b=${qBearing};l=${qLength}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeOsmFeature(rawWay, options = {}) {
  const ingestedAt = options.ingestedAt || new Date().toISOString();

  const id = rawWay.id;
  const tags = rawWay.tags || {};
  const name = typeof rawWay.name === "string" ? rawWay.name : (tags.name || null);
  const coordinates = rawWay.coordinates || (rawWay.geometry ? rawWay.geometry.map((p) => [p.lon, p.lat]) : []);

  // 1. Surface Material
  const rawSurface = (tags.surface || rawWay.surface || "").trim().toLowerCase();
  const material = SURFACE_MATERIAL_MAP[rawSurface] || (rawSurface ? "other" : "unknown");
  const surfaceCategory = SURFACE_CATEGORY_MAP[material] || "unknown";
  const roughnessWeight = SURFACE_ROUGHNESS_WEIGHT[material] ?? 0.0;

  const surfaceProvenance = {
    state: material === "unknown" ? "unknown" : "known",
    value: material,
    sourceId: id ? `osm:way:${id}` : null,
    authority: "osm_curated",
    observedAt: null, // STRICTLY null: OSM does not record observation time on way tags. Never fabricated.
    ingestedAt,
    confidence: surfaceCategory === "confirmed_rough" || surfaceCategory === "confirmed_smooth" ? 1.0 : (surfaceCategory === "probable_rough" ? 0.65 : 0.0),
  };

  // 2. Smoothness (NEVER inferred from surface)
  const rawSmoothness = (tags.smoothness || "").trim().toLowerCase();
  const smoothness = SMOOTHNESS_MAP[rawSmoothness] || "unknown";
  const smoothnessProvenance = {
    state: smoothness === "unknown" ? "unknown" : "known",
    value: smoothness,
    sourceId: id ? `osm:way:${id}` : null,
    authority: "osm_curated",
    observedAt: null,
    ingestedAt,
    confidence: smoothness !== "unknown" ? 0.9 : 0.0,
  };

  // 3. Highway Classification
  const rawHighway = (tags.highway || "residential").trim().toLowerCase();
  const highwayClass = HIGHWAY_MAP[rawHighway] || "residential";

  // 4. Directionality & Modal Access
  const onewayTag = (tags.oneway || "").trim().toLowerCase();
  const isOneway = onewayTag === "yes" || onewayTag === "1" || onewayTag === "true" || onewayTag === "-1";
  const isReversed = onewayTag === "-1";

  const isMotorAllowed = !["cycleway", "footway", "pedestrian", "path"].includes(highwayClass) &&
    tags.motor_vehicle !== "no" &&
    tags.vehicle !== "no" &&
    tags.access !== "no";

  const isBicycleAllowed = tags.bicycle !== "no" &&
    tags.access !== "no" &&
    highwayClass !== "motorway";

  // 5. Cycling Infrastructure
  const cyclewayTag = tags.cycleway || tags["cycleway:right"] || tags["cycleway:left"] || tags["cycleway:both"];
  const isCyclewayWay = highwayClass === "cycleway";
  const hasCycleway = isCyclewayWay || Boolean(cyclewayTag && cyclewayTag !== "no");

  let cyclingTypology = "none";
  if (isCyclewayWay || cyclewayTag === "track") {
    cyclingTypology = "sede_propria";
  } else if (cyclewayTag === "lane" || cyclewayTag === "opposite_lane") {
    cyclingTypology = "corsia_segnaletica";
  } else if (cyclewayTag === "share_busway" || tags.bicycle === "yes") {
    cyclingTypology = "promiscuo_veicoli";
  }

  const cyclingInfrastructure = {
    hasFacility: hasCycleway,
    typology: cyclingTypology,
    direction: isOneway ? "monodirezionale_concorde" : "bidirezionale",
    surface: tags["cycleway:surface"] ? (SURFACE_MATERIAL_MAP[tags["cycleway:surface"].toLowerCase()] || null) : null,
    source: hasCycleway ? "osm" : "none",
  };

  const cyclingProvenance = {
    state: hasCycleway ? "known" : "unknown",
    value: cyclingInfrastructure,
    sourceId: id ? `osm:way:${id}` : null,
    authority: "osm_curated",
    observedAt: null,
    ingestedAt,
    confidence: hasCycleway ? 0.9 : 0.0,
  };

  // 6. Tram rails hazard detection
  const embeddedRails = Boolean(
    tags.railway === "tram" ||
    tags.embedded_rails === "yes" ||
    tags["railway:tram"] === "yes"
  );

  // 7. Deconstruct LineString into directed RoadSegmentRecords
  const segments = [];
  const coords = isReversed ? [...coordinates].reverse() : coordinates;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const dist = geographicDistance(a, b);
    if (dist === 0) continue;

    const bearing = calculateBearing(a, b);
    const hash = computeSegmentHash(a, b, bearing, dist * 100);

    segments.push({
      segmentHash: hash,
      osmWayId: id ?? null,
      name,
      coordinates: [a, b],
      lengthMeters: dist,
      bearing,
      highwayClass,
      isOneway,
      isMotorAllowed,
      isBicycleAllowed,
      embeddedRails,
      surface: surfaceProvenance,
      smoothness: smoothnessProvenance,
      cycling: cyclingProvenance,
      surfaceCategory,
      roughnessWeight,
      rawTags: tags,
    });
  }

  return {
    osmWayId: id ?? null,
    name,
    surfaceCategory,
    roughnessWeight,
    material,
    smoothness,
    segments,
  };
}
