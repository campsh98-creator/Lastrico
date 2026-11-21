/**
 * Independent GPS recording, separate from navigation: a track that exists without a destination, can be paused, shows where
 * the data is missing, exports to GPX and GeoJSON, imports tracks recorded elsewhere, and survives a closed or suspended page.
 *
 * Pure data and functions: no browser API is touched here, the caller passes timestamps and a Storage. It records only what
 * a foreground page receives. A web page cannot record in the background on iOS: whatever happens while the page is hidden
 * or suspended is a gap, and the track says so instead of joining the two sides with a straight line.
 */
export const RECORDING_SCHEMA = "lastrico-recording";
export const RECORDING_VERSION = 1;
export const RECORDING_STORAGE_KEY = "lastrico-recording-active";
/** A silence longer than this between two points is a gap. */
export const GAP_SECONDS = 30;
export const MAX_POINTS = 50_000;
/** A fix worse than this says nothing useful about where the vehicle is. */
export const MAX_ACCURACY_METERS = 200;

/** [timestamp ms, lon, lat, accuracy m (null when unknown), heading degrees | null, speed m/s | null] */
export type RecordedPoint = [number, number, number, number | null, number | null, number | null];
export type GapReason = "paused" | "page-hidden" | "app-closed" | "signal" | "imported";
export type RecordingGap = { fromIndex: number; toIndex: number; seconds: number; reason: GapReason };
export type RecordingState = "recording" | "paused" | "stopped";
export type Recording = {
  schema: typeof RECORDING_SCHEMA;
  version: number;
  id: string;
  startedAt: number;
  source: "device" | "imported";
  state: RecordingState;
  points: RecordedPoint[];
  /** Timestamp the current pause or hidden period began, or null. Stored so a reload can still classify the gap. */
  silentSince: { at: number; reason: "paused" | "page-hidden" | "app-closed" } | null;
  /** Explicit reasons for the silence before the point at `index`; any other gap over GAP_SECONDS is "signal". */
  gapReasons: { index: number; reason: GapReason }[];
};

export function createRecording(id: string, now: number, source: "device" | "imported" = "device"): Recording {
  return { schema: RECORDING_SCHEMA, version: RECORDING_VERSION, id, startedAt: now, source, state: source === "imported" ? "stopped" : "recording", points: [], silentSince: null, gapReasons: [] };
}

export function validPoint(lon: number, lat: number) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 && !(lon === 0 && lat === 0);
}

export type AddResult = "added" | "ignored-state" | "invalid" | "inaccurate" | "out-of-order" | "full";

export function addPoint(rec: Recording, point: { at: number; lon: number; lat: number; accuracy?: number | null; heading?: number | null; speed?: number | null }): AddResult {
  if (rec.state !== "recording") return "ignored-state";
  if (!validPoint(point.lon, point.lat) || !Number.isFinite(point.at)) return "invalid";
  const accuracy = point.accuracy ?? null;
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS)) return "inaccurate";
  const last = rec.points[rec.points.length - 1];
  if (last && point.at <= last[0]) return "out-of-order";
  if (rec.points.length >= MAX_POINTS) return "full";
  const reason = rec.silentSince?.reason;
  if (reason) rec.gapReasons.push({ index: rec.points.length, reason });
  rec.silentSince = null;
  const heading = typeof point.heading === "number" && Number.isFinite(point.heading) ? point.heading : null;
  const speed = typeof point.speed === "number" && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : null;
  rec.points.push([point.at, point.lon, point.lat, accuracy, heading, speed]);
  return "added";
}

export function pauseRecording(rec: Recording, now: number) {
  if (rec.state !== "recording") return;
  rec.state = "paused";
  rec.silentSince = { at: now, reason: "paused" };
}
export function resumeRecording(rec: Recording) { if (rec.state === "paused") rec.state = "recording"; }
export function stopRecording(rec: Recording) { rec.state = "stopped"; rec.silentSince = null; }
/** The page went to the background: no fixes can arrive until it is visible again (iOS suspends it). */
export function markPageHidden(rec: Recording, now: number) {
  if (rec.state === "recording" && !rec.silentSince) rec.silentSince = { at: now, reason: "page-hidden" };
}

export function gapsOf(rec: Recording): RecordingGap[] {
  const gaps: RecordingGap[] = [];
  for (let i = 1; i < rec.points.length; i += 1) {
    const seconds = (rec.points[i][0] - rec.points[i - 1][0]) / 1000;
    if (seconds <= GAP_SECONDS) continue;
    const explicit = rec.gapReasons.find((entry) => entry.index === i);
    gaps.push({ fromIndex: i - 1, toIndex: i, seconds: Math.round(seconds), reason: explicit ? explicit.reason : rec.source === "imported" ? "imported" : "signal" });
  }
  return gaps;
}

/** Continuous pieces of the track: a gap ends one piece and starts the next, so nothing is drawn across missing data. */
export function segmentsOf(rec: Recording): RecordedPoint[][] {
  const gapAt = new Set(gapsOf(rec).map((gap) => gap.toIndex));
  const segments: RecordedPoint[][] = [];
  rec.points.forEach((point, index) => {
    if (index === 0 || gapAt.has(index)) segments.push([]);
    segments[segments.length - 1].push(point);
  });
  return segments;
}

const xml = (value: string) => value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string);
const deg = (value: number) => value.toFixed(6);

export function recordingToGpx(rec: Recording): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Lastrico" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xml(`Lastrico ${new Date(rec.startedAt).toISOString()}`)}</name><time>${new Date(rec.startedAt).toISOString()}</time></metadata>`,
    "  <trk><name>Registrazione GPS</name>",
  ];
  for (const segment of segmentsOf(rec)) {
    lines.push("    <trkseg>");
    for (const [at, lon, lat] of segment) lines.push(`      <trkpt lat="${deg(lat)}" lon="${deg(lon)}"><time>${new Date(at).toISOString()}</time></trkpt>`);
    lines.push("    </trkseg>");
  }
  lines.push("  </trk>", "</gpx>");
  return lines.join("\n") + "\n";
}

export function recordingToGeoJson(rec: Recording) {
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {
        name: "Registrazione GPS", startedAt: new Date(rec.startedAt).toISOString(), source: rec.source, points: rec.points.length,
        gaps: gapsOf(rec), times: segmentsOf(rec).map((segment) => segment.map((p) => new Date(p[0]).toISOString())),
      },
      geometry: { type: "MultiLineString" as const, coordinates: segmentsOf(rec).map((segment) => segment.map((p) => [Number(deg(p[1])), Number(deg(p[2]))])) },
    }],
  };
}

export class ImportError extends Error {}

/**
 * Reads a GPX track or a GeoJSON line. Text only, no XML parser and no entity expansion: a track is a list of points. GPX points
 * need a time (an untimed track cannot show gaps and is refused); GeoJSON may omit times, then points are one second apart.
 */
export function importTrack(text: string, id: string, now: number): Recording {
  if (text.length > 20_000_000) throw new ImportError("file too large");
  const rec = createRecording(id, now, "imported");
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    let json: { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown };
    try { json = JSON.parse(text); } catch { throw new ImportError("not valid JSON"); }
    const lines: number[][][] = [];
    const take = (geometry: unknown) => {
      const g = geometry as { type?: string; coordinates?: unknown } | null;
      if (g?.type === "LineString") lines.push(g.coordinates as number[][]);
      else if (g?.type === "MultiLineString") lines.push(...(g.coordinates as number[][][]));
    };
    if (json.type === "FeatureCollection") (json.features ?? []).forEach((feature) => take((feature as { geometry?: unknown }).geometry));
    else if (json.type === "Feature") take(json.geometry);
    else take(json);
    let t = now;
    for (const line of lines) {
      let first = true;
      for (const c of line ?? []) {
        if (!Array.isArray(c) || !validPoint(Number(c[0]), Number(c[1]))) throw new ImportError("invalid coordinate");
        if (rec.points.length >= MAX_POINTS) throw new ImportError("too many points");
        if (first && rec.points.length > 0) t += (GAP_SECONDS + 1) * 1000;
        first = false;
        t += 1000;
        rec.points.push([t, Number(c[0]), Number(c[1]), null, null, null]);
      }
    }
  } else {
    if (!/<gpx[\s>]/.test(text)) throw new ImportError("not a GPX or GeoJSON track");
    const pattern = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const lat = /\blat="([^"]+)"/.exec(match[1]);
      const lon = /\blon="([^"]+)"/.exec(match[1]);
      const time = /<time>([^<]+)<\/time>/.exec(match[2]);
      if (!lat || !lon || !time) throw new ImportError("a track point has no position or time");
      const at = Date.parse(time[1]);
      if (!validPoint(Number(lon[1]), Number(lat[1])) || !Number.isFinite(at)) throw new ImportError("invalid track point");
      if (rec.points.length >= MAX_POINTS) throw new ImportError("too many points");
      const last = rec.points[rec.points.length - 1];
      if (last && at <= last[0]) throw new ImportError("track points are not in time order");
      rec.points.push([at, Number(lon[1]), Number(lat[1]), null, null, null]);
    }
  }
  if (rec.points.length < 2) throw new ImportError("a track needs at least two points");
  rec.startedAt = rec.points[0][0];
  return rec;
}

type RecordingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Saves the active recording; false when storage refuses (quota, private mode), so the caller can say so. */
export function saveActiveRecording(storage: RecordingStorage, rec: Recording): boolean {
  try { storage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}
export function clearActiveRecording(storage: RecordingStorage) { try { storage.removeItem(RECORDING_STORAGE_KEY); } catch { /* nothing to clear */ } }

/**
 * A recording the page left behind (closed, reloaded, suspended and killed). It comes back paused, never silently recording:
 * the time since its last point is marked "app-closed", so the person decides to resume or stop.
 */
export function recoverActiveRecording(storage: RecordingStorage, now: number): Recording | null {
  let raw: string | null = null;
  try { raw = storage.getItem(RECORDING_STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  let rec: Recording;
  try { rec = JSON.parse(raw) as Recording; } catch { return null; }
  if (rec.schema !== RECORDING_SCHEMA || rec.version !== RECORDING_VERSION || !Array.isArray(rec.points) || rec.points.length === 0) return null;
  if (!rec.points.every((p) => Array.isArray(p) && p.length === 6 && validPoint(p[1], p[2]) && Number.isFinite(p[0]))) return null;
  if (rec.state === "stopped") return rec;
  rec.state = "paused";
  rec.gapReasons = rec.gapReasons.filter((entry) => entry.index < rec.points.length);
  // The next point after resuming follows a closed app, not a plain pause; the silence starts at the last point that was saved.
  rec.silentSince = { at: Math.min(now, rec.points[rec.points.length - 1][0]), reason: "app-closed" };
  return rec;
}
