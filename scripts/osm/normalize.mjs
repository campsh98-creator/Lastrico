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

  // Highway Classification
  const rawHighway = (tags.highway || "").trim().toLowerCase();
  const highwayClass = Object.hasOwn(HIGHWAY_MAP, rawHighway) ? HIGHWAY_MAP[rawHighway] : "unknown";

  const pilotArea = options.pilotArea || options.area || null;
  const isRoccella = pilotArea === "ROCCELLA_PILOT" || pilotArea === "roccella" || (Array.isArray(coordinates) && coordinates[0] && coordinates[0][0] > 15);

  // 1. Surface Material
  let rawSurface = (tags.surface || rawWay.surface || "").trim().toLowerCase();
  let sourceId = id ? `osm:way:${id}` : null;
  let authority = "osm_curated";
  let state = "known";
  let confidence = null;

  if (!rawSurface && tags.surface_bike) {
    rawSurface = tags.surface_bike.trim().toLowerCase();
  }
  if (!rawSurface && highwayClass === "cycleway") {
    rawSurface = (tags["cycleway:surface"] || tags["cycleway:both:surface"] || tags["cycleway:right:surface"] || tags["cycleway:left:surface"] || "").trim().toLowerCase();
  }
  if (!rawSurface && highwayClass === "footway") {
    rawSurface = (tags["footway:surface"] || tags["footway:both:surface"] || "").trim().toLowerCase();
  }

  if (!rawSurface && tags.tracktype) {
    const tt = String(tags.tracktype).trim().toLowerCase();
    if (tt === "grade1") {
      rawSurface = "asphalt";
      authority = "osm_default";
      state = "inferred";
      confidence = 0.85;
    } else if (["grade2", "grade3", "grade4", "grade5"].includes(tt)) {
      rawSurface = "unpaved";
      authority = "osm_default";
      state = "inferred";
      confidence = 0.85;
    }
  }

  const material = SURFACE_MATERIAL_MAP[rawSurface] || (rawSurface ? "other" : "unknown");
  const surfaceCategory = SURFACE_CATEGORY_MAP[material] || "unknown";
  const roughnessWeight = SURFACE_ROUGHNESS_WEIGHT[material] ?? 0.0;

  if (confidence === null) {
    if (surfaceCategory === "confirmed_rough" || surfaceCategory === "confirmed_smooth") {
      confidence = 1.0;
    } else if (surfaceCategory === "probable_rough") {
      confidence = 0.65;
    } else {
      confidence = 0.0;
    }
  }

  const surfaceProvenance = {
    state: material === "unknown" ? "unknown" : state,
    value: material,
    sourceId,
    authority,
    observedAt: null, // STRICTLY null: OSM does not record observation time on way tags. Never fabricated.
    ingestedAt,
    confidence,
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

  // 3. Directionality & Modal Access
  const onewayTag = (tags.oneway || (tags.junction === "roundabout" ? "yes" : "")).trim().toLowerCase();
  const isOneway = ["yes", "1", "true", "-1"].includes(onewayTag);
  const isReversed = onewayTag === "-1";

  // More specific modal tags override generic access. Unrecognised restrictions
  // remain unavailable for matching; this is not a replacement routing graph.
  const allowedValues = new Set(["yes", "designated", "official", "permissive", "destination", "customers", "delivery"]);
  function access(keys, defaultAllowed) {
    for (const key of keys) {
      if (tags[`${key}:conditional`]) return false;
      if (tags[key]) return allowedValues.has(tags[key].trim().toLowerCase());
    }
    return defaultAllowed;
  }
  const defaultMotor = !["unknown", "steps", "cycleway", "footway", "pedestrian", "path"].includes(highwayClass);
  const modeAccess = {
    car: access(["motorcar", "motor_vehicle", "vehicle", "access"], defaultMotor),
    motorcycle: access(["motorcycle", "motor_vehicle", "vehicle", "access"], defaultMotor),
    bicycle: access(["bicycle", "vehicle", "access"], !["unknown", "steps", "motorway", "footway", "pedestrian"].includes(highwayClass)),
  };
  if (isRoccella && highwayClass === "steps") {
    // Steps are a structural obstacle: strictly impassable for motor vehicles,
    // and impassable for bicycles unless explicitly ramped/permitted.
    modeAccess.car = false;
    modeAccess.motorcycle = false;
    if (tags.bicycle !== "yes" && tags["ramp:bicycle"] !== "yes") {
      modeAccess.bicycle = false;
    }
  }
  const isMotorAllowed = modeAccess.car || modeAccess.motorcycle;
  const isBicycleAllowed = modeAccess.bicycle;

  function direction(keys, fallback) {
    for (const key of keys) {
      if (tags[`${key}:conditional`]) return "unknown";
      if (tags[key] !== undefined) {
        const normalized = String(tags[key]).trim().toLowerCase();
        let result = ["no", "0", "false", ""].includes(normalized) ? "both"
          : normalized === "-1" ? "backward" : ["yes", "1", "true"].includes(normalized) ? "forward" : "unknown";
        if (result === "unknown") return result;
        if (isReversed && result !== "both") result = result === "forward" ? "backward" : "forward";
        return result;
      }
    }
    if (tags["oneway:conditional"]) return "unknown";
    const normalized = String(fallback).trim().toLowerCase();
    let result = ["no", "0", "false", ""].includes(normalized) ? "both"
      : normalized === "-1" ? "backward" : ["yes", "1", "true"].includes(normalized) ? "forward" : "unknown";
    if (result === "unknown") return result;
    if (isReversed && result !== "both") result = result === "forward" ? "backward" : "forward";
    return result;
  }
  const oppositeCycleway = ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"]
    .some((key) => ["opposite", "opposite_lane", "opposite_track"].includes(tags[key]));
  const modeDirections = {
    car: direction(["oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle"], onewayTag),
    motorcycle: direction(["oneway:motorcycle", "oneway:motor_vehicle", "oneway:vehicle"], onewayTag),
    bicycle: direction(["oneway:bicycle", "oneway:vehicle"], oppositeCycleway ? "no" : onewayTag),
  };

  // 5. Cycling Infrastructure
  const cyclewayValues = [tags.cycleway, tags["cycleway:right"], tags["cycleway:left"], tags["cycleway:both"]];
  // 'separate' refers to another mapped way, not a facility on this road.
  const cyclewayTag = cyclewayValues.find((value) => ["track", "lane", "opposite_track", "opposite_lane"].includes(value));
  const isCyclewayWay = highwayClass === "cycleway";
  const hasCycleway = isCyclewayWay || Boolean(cyclewayTag);

  let cyclingTypology = "none";
  if (isCyclewayWay || cyclewayTag === "track" || cyclewayTag === "opposite_track") {
    cyclingTypology = "sede_propria";
  } else if (cyclewayTag === "lane" || cyclewayTag === "opposite_lane") {
    cyclingTypology = "corsia_segnaletica";
  } else if (cyclewayTag === "share_busway" || tags.bicycle === "yes") {
    cyclingTypology = "promiscuo_veicoli";
  }

  const cyclingInfrastructure = {
    hasFacility: hasCycleway,
    typology: cyclingTypology,
    direction: modeDirections.bicycle === "both" ? "bidirezionale"
      : modeDirections.bicycle === "forward" ? "monodirezionale_concorde"
        : modeDirections.bicycle === "backward" ? "monodirezionale_discorde" : "unknown",
    surface: (tags["cycleway:surface"] || tags["cycleway:both:surface"] || tags["cycleway:right:surface"] || tags["cycleway:left:surface"])
      ? (SURFACE_MATERIAL_MAP[(tags["cycleway:surface"] || tags["cycleway:both:surface"] || tags["cycleway:right:surface"] || tags["cycleway:left:surface"]).toLowerCase()] || null)
      : null,
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
  const isPlatform = rawHighway === "platform"
    || tags.railway === "platform"
    || tags.public_transport === "platform"
    || tags.platform === "tram";
  const embeddedRails = !isPlatform && Boolean(
    tags.railway === "tram" ||
    tags.embedded_rails === "yes" ||
    tags["railway:tram"] === "yes" ||
    tags.tram === "yes" ||
    tags["tram:forward"] === "yes" ||
    tags["tram:backward"] === "yes" ||
    tags["oneway:tram"] !== undefined ||
    tags["lanes:tram"] !== undefined ||
    tags["lanes:tram:forward"] !== undefined ||
    tags["lanes:tram:backward"] !== undefined ||
    (typeof tags.surface_bike === "string" && tags.surface_bike.includes(":rails"))
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
      modeAccess,
      modeDirections,
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
