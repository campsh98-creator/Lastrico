/**
 * Trace format shared by the recording prototype, the synthetic generator and the analysis.
 * Times are milliseconds relative to the start of the recording (no wall-clock time is stored).
 */

export const TRACE_SCHEMA = "lastrico-roughness-trace";
export const TRACE_VERSION = 1;
export const ANALYSIS_SCHEMA = "lastrico-roughness-analysis";
export const ANALYSIS_VERSION = 1;

/**
 * Motion row: t (ms), accelerationIncludingGravity x/y/z (m/s^2), acceleration (linear) x/y/z
 * (m/s^2 or null), rotationRate alpha/beta/gamma (deg/s or null).
 */
export const MOTION_COLUMNS = ["t", "ax", "ay", "az", "lx", "ly", "lz", "ra", "rb", "rg"];
/** GPS row: t (ms), lat, lon (null in speed-only mode), accuracy (m), speed (m/s), heading (deg). */
export const GPS_COLUMNS = ["t", "lat", "lon", "acc", "speed", "heading"];

export const DATA_KINDS = ["synthetic", "field-recording"];
export const MODES = ["car", "motorcycle", "bicycle"];
export const LABELS = ["smooth", "rough-periodic", "uncertain"];

export function validateTrace(trace) {
  const problems = [];
  if (!trace || typeof trace !== "object") return ["trace is not an object"];
  if (trace.schema !== TRACE_SCHEMA) problems.push(`schema must be ${TRACE_SCHEMA}`);
  if (trace.version !== TRACE_VERSION) problems.push(`version must be ${TRACE_VERSION}`);
  if (!DATA_KINDS.includes(trace.dataKind)) problems.push(`dataKind must be one of ${DATA_KINDS.join(", ")}`);
  if (!trace.meta || !MODES.includes(trace.meta.mode)) problems.push(`meta.mode must be one of ${MODES.join(", ")}`);
  if (!trace.motion || !Array.isArray(trace.motion.rows)) problems.push("motion.rows must be an array");
  else if (JSON.stringify(trace.motion.columns) !== JSON.stringify(MOTION_COLUMNS)) problems.push("motion.columns mismatch");
  if (!trace.gps || !Array.isArray(trace.gps.rows)) problems.push("gps.rows must be an array");
  else if (JSON.stringify(trace.gps.columns) !== JSON.stringify(GPS_COLUMNS)) problems.push("gps.columns mismatch");
  return problems;
}

export function emptyTrace({ dataKind, mode, meta = {} }) {
  return {
    schema: TRACE_SCHEMA,
    version: TRACE_VERSION,
    dataKind,
    meta: { mode, ...meta },
    motion: { columns: [...MOTION_COLUMNS], rows: [] },
    gps: { columns: [...GPS_COLUMNS], rows: [] },
    events: [],
  };
}
