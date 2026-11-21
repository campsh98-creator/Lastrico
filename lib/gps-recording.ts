/**
 * Route-independent local GPS recording utilities: crash/reload checkpointing,
 * interruption detection (background gaps, fix gaps, foreground stalls), summary metrics,
 * RFC 7946 GeoJSON export, and offline GPX / GeoJSON trace import.
 *
 * Strictly device-local: zero network operations.
 */
import {
  createNavigationFixState,
  distanceMeters,
  processGpsFix,
  REROUTE_COOLDOWN_MS,
  type NavigationTransportMode,
} from "./navigation-fix-processor.ts";
import {
  areaForCoordinate,
  isPilotAreaId,
  PILOT_AREAS,
  type PilotAreaId,
} from "./pilot-areas.ts";
import {
  compactDecision,
  GPS_TRACE_APP_VERSION,
  GPS_TRACE_SCHEMA,
  GPS_TRACE_VERSION,
  MAX_TRACE_FIXES,
  parseGpsTrace,
  saveGpsTrace,
  type GpsTrace,
  type TraceDecision,
  type TraceEvent,
  type TraceFix,
  type TraceStorage,
} from "./gps-trace.ts";

export const GPS_ACTIVE_CHECKPOINT_KEY = "lastrico-gps-active-checkpoint";
export const BACKGROUND_GAP_MS = 10_000;
export const FIX_GAP_MS = 15_000;
export const GPS_STALL_MS = 20_000;

export type ActiveRecordingCheckpoint = {
  version: 1;
  savedAt: string;
  paused: boolean;
  trace: GpsTrace;
};

export type InterruptionGapResult = {
  interrupted: boolean;
  gapSeconds: number;
};

export type GpsStallResult = {
  stalled: boolean;
  stallSeconds: number;
};

export type TraceMetricsSummary = {
  fixCount: number;
  distanceKm: number;
  durationSeconds: number;
  activeSeconds: number;
  pausedOrGapSeconds: number;
  interruptionCount: number;
  segmentCount: number;
};

const SEGMENT_BREAK_EVENTS = new Set([
  "recording-resume",
  "background-gap",
  "fix-gap",
  "recording-recovered",
]);

const INTERRUPTION_EVENTS = new Set([
  "background-gap",
  "fix-gap",
  "gps-stall",
  "signal-loss",
  "recording-recovered",
]);

export function saveRecordingCheckpoint(
  trace: GpsTrace,
  storage: TraceStorage | null,
  paused: boolean,
  savedAtMs = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    const payload: ActiveRecordingCheckpoint = {
      version: 1,
      savedAt: new Date(savedAtMs).toISOString(),
      paused,
      trace,
    };
    storage.setItem(GPS_ACTIVE_CHECKPOINT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearRecordingCheckpoint(storage: TraceStorage | null) {
  if (!storage) return;
  try {
    storage.removeItem(GPS_ACTIVE_CHECKPOINT_KEY);
  } catch {
    // Ignore restricted storage removal failures.
  }
}

/**
 * Recovers an active recording interrupted by page reload/termination, marks a recovery
 * boundary event, saves it into device trace history, and removes the temporary checkpoint.
 */
export function recoverInterruptedRecording(
  storage: TraceStorage | null,
  now = Date.now(),
): GpsTrace | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(GPS_ACTIVE_CHECKPOINT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  clearRecordingCheckpoint(storage);
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveRecordingCheckpoint>;
    if (!parsed || parsed.version !== 1 || !parsed.trace) return null;
    const valid = parseGpsTrace(parsed.trace);
    if (valid.fixes.length === 0 && valid.routes.length === 0) return null;
    const lastEvent = valid.events[valid.events.length - 1];
    const events: TraceEvent[] = lastEvent?.type === "recording-recovered" && lastEvent.atFix === valid.fixes.length
      ? valid.events
      : [
          ...valid.events,
          {
            atFix: valid.fixes.length,
            type: "recording-recovered",
            detail: parsed.savedAt ? `saved:${parsed.savedAt}` : new Date(now).toISOString(),
          },
        ];
    const recovered: GpsTrace = { ...valid, events };
    saveGpsTrace(recovered, storage);
    return recovered;
  } catch {
    return null;
  }
}

export function detectBackgroundGap(hiddenAtMs: number | null, visibleAtMs: number): InterruptionGapResult {
  if (hiddenAtMs === null || !Number.isFinite(hiddenAtMs) || !Number.isFinite(visibleAtMs) || visibleAtMs <= hiddenAtMs) {
    return { interrupted: false, gapSeconds: 0 };
  }
  const gapMs = visibleAtMs - hiddenAtMs;
  const gapSeconds = Math.round(gapMs / 1000);
  return { interrupted: gapMs >= BACKGROUND_GAP_MS, gapSeconds };
}

export function detectFixGap(prevFixAtMs: number | null, nextFixAtMs: number): InterruptionGapResult {
  if (prevFixAtMs === null || !Number.isFinite(prevFixAtMs) || !Number.isFinite(nextFixAtMs) || nextFixAtMs <= prevFixAtMs) {
    return { interrupted: false, gapSeconds: 0 };
  }
  const gapMs = nextFixAtMs - prevFixAtMs;
  const gapSeconds = Math.round(gapMs / 1000);
  return { interrupted: gapMs >= FIX_GAP_MS, gapSeconds };
}

export function detectGpsStall(lastFixAtMs: number | null, nowMs: number): GpsStallResult {
  if (lastFixAtMs === null || !Number.isFinite(lastFixAtMs) || !Number.isFinite(nowMs) || nowMs <= lastFixAtMs) {
    return { stalled: false, stallSeconds: 0 };
  }
  const stallMs = nowMs - lastFixAtMs;
  const stallSeconds = Math.round(stallMs / 1000);
  return { stalled: stallMs >= GPS_STALL_MS, stallSeconds };
}

export function splitFixesIntoSegments(trace: GpsTrace): TraceFix[][] {
  if (trace.fixes.length === 0) return [];
  const breaks = new Set(
    trace.events
      .filter((event) => SEGMENT_BREAK_EVENTS.has(event.type) && event.atFix > 0 && event.atFix < trace.fixes.length)
      .map((event) => event.atFix),
  );
  const segments: TraceFix[][] = [];
  let current: TraceFix[] = [];
  trace.fixes.forEach((fix, index) => {
    if (breaks.has(index) && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push(fix);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

export function summarizeTraceMetrics(trace: GpsTrace): TraceMetricsSummary {
  const segments = splitFixesIntoSegments(trace);
  let totalMeters = 0;
  let activeMs = 0;
  for (const segment of segments) {
    if (segment.length >= 2) {
      activeMs += Math.max(0, segment[segment.length - 1][0] - segment[0][0]);
      for (let i = 1; i < segment.length; i += 1) {
        totalMeters += distanceMeters([segment[i - 1][1], segment[i - 1][2]], [segment[i][1], segment[i][2]]);
      }
    }
  }
  const totalSpanMs = trace.fixes.length >= 2
    ? Math.max(0, trace.fixes[trace.fixes.length - 1][0] - trace.fixes[0][0])
    : 0;
  const pausedOrGapSeconds = Math.max(0, Math.round((totalSpanMs - activeMs) / 1000));
  const interruptionCount = trace.events.filter((event) => INTERRUPTION_EVENTS.has(event.type)).length;
  return {
    fixCount: trace.fixes.length,
    distanceKm: Math.round((totalMeters / 1000) * 100) / 100,
    durationSeconds: Math.round(totalSpanMs / 1000),
    activeSeconds: Math.round(activeMs / 1000),
    pausedOrGapSeconds,
    interruptionCount,
    segmentCount: segments.length,
  };
}

export function gpsTraceToGeoJson(trace: GpsTrace) {
  const segments = splitFixesIntoSegments(trace);
  const summary = summarizeTraceMetrics(trace);
  const features: Array<Record<string, unknown>> = [];

  if (segments.length > 1) {
    features.push({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: segments.map((seg) => seg.map(([, lon, lat]) => [lon, lat])),
      },
      properties: {
        kind: "track",
        id: trace.id,
        startedAt: trace.startedAt,
        area: trace.area,
        mode: trace.mode,
        fixes: trace.fixes.length,
        distanceKm: summary.distanceKm,
        durationSeconds: summary.durationSeconds,
        interruptionCount: summary.interruptionCount,
        segmentCount: segments.length,
        timestamps: trace.fixes.map(([t]) => new Date(t).toISOString()),
        accuracies: trace.fixes.map((f) => f[3]),
      },
    });
  } else {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: (segments[0] ?? []).map(([, lon, lat]) => [lon, lat]),
      },
      properties: {
        kind: "track",
        id: trace.id,
        startedAt: trace.startedAt,
        area: trace.area,
        mode: trace.mode,
        fixes: trace.fixes.length,
        distanceKm: summary.distanceKm,
        durationSeconds: summary.durationSeconds,
        interruptionCount: summary.interruptionCount,
        segmentCount: segments.length,
        timestamps: trace.fixes.map(([t]) => new Date(t).toISOString()),
        accuracies: trace.fixes.map((f) => f[3]),
      },
    });
  }

  trace.routes.forEach((route, index) => {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: route.coordinates.map(([lon, lat]) => [lon, lat]),
      },
      properties: {
        kind: "planned-route",
        index,
        objective: route.objective ?? null,
        atFix: route.atFix,
        minutes: route.minutes,
        distanceKm: route.distanceKm,
      },
    });
  });

  trace.events.forEach((event) => {
    if (trace.fixes.length === 0) return;
    const idx = Math.max(0, Math.min(trace.fixes.length - 1, event.atFix));
    const [, lon, lat] = trace.fixes[idx];
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        kind: "event",
        type: event.type,
        atFix: event.atFix,
        detail: event.detail ?? null,
      },
    });
  });

  return {
    type: "FeatureCollection" as const,
    features,
  };
}

function resolveAreaForPoints(coords: [number, number][], hint?: unknown): PilotAreaId {
  if (typeof hint === "string" && isPilotAreaId(hint)) return hint;
  for (const coord of coords) {
    const found = areaForCoordinate(coord);
    if (found) return found.id;
  }
  return "milan";
}

function buildStandaloneDecisions(
  fixes: TraceFix[],
  area: PilotAreaId,
  mode: NavigationTransportMode,
): TraceDecision[] {
  let navState = createNavigationFixState();
  const bounds = PILOT_AREAS[area].bounds;
  return fixes.map(([timestamp, lon, lat, accuracy, heading, speed, now]) => {
    const decision = processGpsFix(navState, {
      coordinate: [lon, lat],
      accuracy,
      timestamp,
      heading,
      speed,
    }, {
      now,
      mode,
      bounds,
      route: null,
      lastCalculationAt: 0,
      calculationInProgress: false,
      rerouteCooldownMs: REROUTE_COOLDOWN_MS,
    });
    navState = decision.state;
    return compactDecision(decision);
  });
}

function attrValue(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function childTagText(body: string, tagPattern: string): string | null {
  const m = body.match(new RegExp(`<(?:[a-z0-9_-]+:)?${tagPattern}[^>]*>([^<]+)</(?:[a-z0-9_-]+:)?${tagPattern}>`, "i"));
  return m ? m[1].trim() : null;
}

export function parseGpxToTrace(xmlInput: string, filename?: string): GpsTrace {
  if (typeof xmlInput !== "string" || !xmlInput.trim()) {
    throw new Error("File GPX vuoto o illeggibile.");
  }
  const normalized = xmlInput.trim();
  if (!/<gpx[\s>]/i.test(normalized)) {
    throw new Error("Il file non contiene un documento GPX valido.");
  }

  const segmentMatches = [...normalized.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi)];
  const segmentBodies = segmentMatches.length > 0
    ? segmentMatches.map((m) => m[1])
    : [normalized];

  const fixes: TraceFix[] = [];
  const events: TraceEvent[] = [];
  const baseFallbackMs = Date.now();
  let lastTs = baseFallbackMs;

  for (const segBody of segmentBodies) {
    const segStartIdx = fixes.length;
    const points = [...segBody.matchAll(/<trkpt\b([^>]*)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi)];
    if (points.length > 0 && segStartIdx > 0) {
      events.push({ atFix: segStartIdx, type: "fix-gap", detail: "gpx-segment" });
    }
    for (const match of points) {
      if (fixes.length >= MAX_TRACE_FIXES) {
        throw new Error(`La traccia supera il limite di ${MAX_TRACE_FIXES} rilevazioni.`);
      }
      const attrs = match[1] ?? "";
      const body = match[2] ?? "";
      const lat = Number(attrValue(attrs, "lat"));
      const lon = Number(attrValue(attrs, "lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw new Error("Coordinate non valide nel file GPX.");
      }
      const timeText = childTagText(body, "time");
      const parsedTime = timeText ? Date.parse(timeText) : Number.NaN;
      const timestamp = Number.isFinite(parsedTime) ? parsedTime : (fixes.length === 0 ? baseFallbackMs : lastTs + 1000);
      lastTs = timestamp;
      const accNum = Number(childTagText(body, "accuracy"));
      const hdgNum = Number(childTagText(body, "heading"));
      const spdNum = Number(childTagText(body, "speed"));
      fixes.push([
        timestamp,
        lon,
        lat,
        Number.isFinite(accNum) && accNum >= 0 ? accNum : 10,
        Number.isFinite(hdgNum) ? hdgNum : null,
        Number.isFinite(spdNum) && spdNum >= 0 ? spdNum : null,
        timestamp,
        0,
        0,
        REROUTE_COOLDOWN_MS,
      ]);
    }
  }

  if (fixes.length === 0) {
    throw new Error("Nessun punto <trkpt> trovato nel file GPX.");
  }

  const area = resolveAreaForPoints(fixes.map(([, lon, lat]) => [lon, lat]));
  const mode: NavigationTransportMode = "car";
  const metaTime = childTagText(normalized, "time");
  const startedAtMs = metaTime && Number.isFinite(Date.parse(metaTime)) ? Date.parse(metaTime) : fixes[0][0];
  const stem = filename ? filename.replace(/[^a-z0-9_-]/gi, "-").slice(0, 24) : "gpx";
  const trace: GpsTrace = {
    schema: GPS_TRACE_SCHEMA,
    version: GPS_TRACE_VERSION,
    appVersion: GPS_TRACE_APP_VERSION,
    id: `imp-${stem}-${startedAtMs}`,
    startedAt: new Date(startedAtMs).toISOString(),
    area,
    mode,
    routes: [],
    fixes,
    decisions: buildStandaloneDecisions(fixes, area, mode),
    events,
  };
  return parseGpsTrace(trace);
}

export function parseGeoJsonToTrace(input: string | unknown, filename?: string): GpsTrace {
  let obj: unknown;
  try {
    obj = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("JSON/GeoJSON malformato.");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Il file GeoJSON deve contenere un oggetto valido.");
  }
  const record = obj as Record<string, unknown>;
  if (record.schema === GPS_TRACE_SCHEMA) {
    return parseGpsTrace(record);
  }

  const features: Array<Record<string, unknown>> = record.type === "FeatureCollection" && Array.isArray(record.features)
    ? (record.features.filter((f) => f && typeof f === "object") as Array<Record<string, unknown>>)
    : record.type === "Feature"
      ? [record]
      : [];

  const trackFeature = features.find((f) => {
    const geom = f.geometry as { type?: string } | undefined;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    return (props.kind === "track" || !props.kind)
      && (geom?.type === "LineString" || geom?.type === "MultiLineString");
  });
  if (!trackFeature) {
    throw new Error("Nessuna traccia LineString o MultiLineString trovata nel GeoJSON.");
  }

  const geometry = trackFeature.geometry as { type: string; coordinates: unknown };
  const props = (trackFeature.properties ?? {}) as Record<string, unknown>;
  const rawSegments: unknown[] = geometry.type === "MultiLineString"
    ? (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
    : [geometry.coordinates];

  const baseStarted = typeof props.startedAt === "string" && Number.isFinite(Date.parse(props.startedAt))
    ? Date.parse(props.startedAt)
    : Date.now();
  const timestamps = Array.isArray(props.timestamps) ? props.timestamps : [];
  const accuracies = Array.isArray(props.accuracies) ? props.accuracies : [];

  const fixes: TraceFix[] = [];
  const events: TraceEvent[] = [];

  for (const seg of rawSegments) {
    if (!Array.isArray(seg)) continue;
    if (seg.length > 0 && fixes.length > 0) {
      events.push({ atFix: fixes.length, type: "fix-gap", detail: "geojson-segment" });
    }
    for (const pt of seg) {
      if (fixes.length >= MAX_TRACE_FIXES) {
        throw new Error(`La traccia supera il limite di ${MAX_TRACE_FIXES} rilevazioni.`);
      }
      if (!Array.isArray(pt) || pt.length < 2) {
        throw new Error("Coordinata GeoJSON non valida.");
      }
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        throw new Error("Coordinate fuori intervallo nel file GeoJSON.");
      }
      const rawTs = timestamps[fixes.length];
      const parsedTs = typeof rawTs === "string" ? Date.parse(rawTs) : typeof rawTs === "number" ? rawTs : Number.NaN;
      const timestamp = Number.isFinite(parsedTs) ? parsedTs : baseStarted + fixes.length * 1000;
      const accVal = Number(accuracies[fixes.length]);
      fixes.push([
        timestamp,
        lon,
        lat,
        Number.isFinite(accVal) && accVal >= 0 ? accVal : 10,
        null,
        null,
        timestamp,
        0,
        0,
        REROUTE_COOLDOWN_MS,
      ]);
    }
  }

  if (fixes.length === 0) {
    throw new Error("Nessuna coordinata valida trovata nella traccia GeoJSON.");
  }

  const area = resolveAreaForPoints(fixes.map(([, lon, lat]) => [lon, lat]), props.area);
  const mode: NavigationTransportMode = props.mode === "motorcycle" || props.mode === "bicycle" ? props.mode : "car";
  const stem = filename ? filename.replace(/[^a-z0-9_-]/gi, "-").slice(0, 24) : "geojson";
  const trace: GpsTrace = {
    schema: GPS_TRACE_SCHEMA,
    version: GPS_TRACE_VERSION,
    appVersion: GPS_TRACE_APP_VERSION,
    id: typeof props.id === "string" && props.id.trim() ? props.id.trim() : `imp-${stem}-${baseStarted}`,
    startedAt: new Date(fixes[0][0]).toISOString(),
    area,
    mode,
    routes: [],
    fixes,
    decisions: buildStandaloneDecisions(fixes, area, mode),
    events,
  };
  return parseGpsTrace(trace);
}

export function importTraceFileContent(content: string, filename = ""): GpsTrace {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (!trimmed) {
    throw new Error("File vuoto o illeggibile.");
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx") || trimmed.startsWith("<")) {
    return parseGpxToTrace(trimmed, filename);
  }
  if (lower.endsWith(".geojson") || lower.endsWith(".json") || trimmed.startsWith("{")) {
    return parseGeoJsonToTrace(trimmed, filename);
  }
  throw new Error("Formato non supportato: carica un file GPX o GeoJSON/JSON valido.");
}
