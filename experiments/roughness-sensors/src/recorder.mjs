/**
 * In-memory recorder used by the developer prototype (no DOM, no storage, no network).
 * Data lives only in this object until the page is closed, the user presses "Elimina", or the
 * user explicitly exports a JSON file.
 */
import { emptyTrace } from "./schema.mjs";

export const RECORDER_DEFAULTS = {
  maxMinutes: 30,
  /** Rows beyond this are refused (protects memory on long sessions; ~60 Hz x 30 min + margin). */
  maxMotionRows: 30 * 60 * 75,
  handlingRotationDegS: 45,
};

const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const round = (value, digits) => (value === null ? null : Number(value.toFixed(digits)));

/**
 * @param {{ mode: string, gpsMode: "off"|"speed-only"|"speed-and-position", dataKind?: string }} config
 */
export function createRecorder(config, limits = {}) {
  const options = { ...RECORDER_DEFAULTS, ...limits };
  let state = "idle";
  let origin = 0;
  let trace = null;
  let lastMotionT = null;
  const recentTimes = [];
  const recentRotation = [];
  let reportedInterval = null;
  let lastGravity = null;
  let lastFix = null;
  let hasGyro = false;
  let hasLinear = false;

  function reset() {
    state = "idle";
    trace = null;
    lastMotionT = null;
    recentTimes.length = 0;
    recentRotation.length = 0;
    reportedInterval = null;
    lastGravity = null;
    lastFix = null;
    hasGyro = false;
    hasLinear = false;
  }

  const recorder = {
    get state() { return state; },
    get rowCount() { return trace ? trace.motion.rows.length : 0; },
    get gpsCount() { return trace ? trace.gps.rows.length : 0; },

    /** @param {number} t0 time base of the events (e.g. performance.now() at start) */
    start(t0, meta = {}) {
      reset();
      origin = t0;
      trace = emptyTrace({
        dataKind: config.dataKind ?? "field-recording",
        mode: config.mode,
        meta: { createdBy: "roughness-prototype", gpsMode: config.gpsMode, ...meta },
      });
      trace.events.push({ t: 0, type: "start" });
      state = "recording";
    },

    /** Accepts a DeviceMotionEvent or any object with the same shape; `t` in the time base of start(). */
    addMotion(event, t) {
      if (state !== "recording") return false;
      const relative = t - origin;
      if (relative / 60000 > options.maxMinutes || trace.motion.rows.length >= options.maxMotionRows) {
        state = "full";
        trace.events.push({ t: round(relative, 1), type: "limit-reached" });
        return false;
      }
      const aig = event.accelerationIncludingGravity ?? {};
      const lin = event.acceleration ?? {};
      const rot = event.rotationRate ?? {};
      const row = [
        round(relative, 1),
        finiteOrNull(aig.x), finiteOrNull(aig.y), finiteOrNull(aig.z),
        finiteOrNull(lin.x), finiteOrNull(lin.y), finiteOrNull(lin.z),
        finiteOrNull(rot.alpha), finiteOrNull(rot.beta), finiteOrNull(rot.gamma),
      ];
      if (row[1] === null || row[2] === null || row[3] === null) return false;
      for (let index = 1; index < row.length; index += 1) row[index] = round(row[index], 4);
      trace.motion.rows.push(row);
      if (row[7] !== null) hasGyro = true;
      if (row[4] !== null) hasLinear = true;
      if (reportedInterval === null && finiteOrNull(event.interval) !== null) reportedInterval = event.interval;
      lastMotionT = relative;
      recentTimes.push(relative);
      while (recentTimes.length && relative - recentTimes[0] > 2000) recentTimes.shift();
      const rotation = row[7] === null ? null : Math.hypot(row[7], row[8], row[9]);
      recentRotation.push([relative, rotation]);
      while (recentRotation.length && relative - recentRotation[0][0] > 1000) recentRotation.shift();
      lastGravity = Math.hypot(row[1], row[2], row[3]);
      return true;
    },

    /** Accepts a GeolocationPosition-like object. Coordinates are dropped unless the user opted in. */
    addPosition(position, t) {
      if (state !== "recording" || config.gpsMode === "off") return false;
      const coords = position.coords ?? {};
      const keepPosition = config.gpsMode === "speed-and-position";
      const row = [
        round(t - origin, 1),
        keepPosition ? finiteOrNull(coords.latitude) : null,
        keepPosition ? finiteOrNull(coords.longitude) : null,
        round(finiteOrNull(coords.accuracy), 1),
        round(finiteOrNull(coords.speed), 2),
        round(finiteOrNull(coords.heading), 1),
      ];
      trace.gps.rows.push(row);
      lastFix = { t: row[0], speed: row[4], accuracy: row[3] };
      return true;
    },

    addEvent(type, t) {
      if (!trace || state === "idle") return;
      trace.events.push({ t: round(t - origin, 1), type });
    },

    stop(t) {
      if (state !== "recording" && state !== "full") return;
      trace.events.push({ t: round(t - origin, 1), type: "stop" });
      state = "stopped";
    },

    /** Removes every recorded value from memory. */
    discard() {
      reset();
    },

    liveStats(t) {
      const now = t - origin;
      const span = recentTimes.length > 1 ? recentTimes[recentTimes.length - 1] - recentTimes[0] : 0;
      const rateHz = span > 0 ? ((recentTimes.length - 1) * 1000) / span : 0;
      const rotationValues = recentRotation.map(([, value]) => value).filter((value) => value !== null);
      const rotationPeak = rotationValues.length ? Math.max(...rotationValues) : null;
      // W3C says milliseconds; WebKit on iOS passes 1/60 (seconds). Report both readings honestly.
      const intervalUnit = reportedInterval === null ? null : reportedInterval < 1 ? "seconds (non-standard)" : "milliseconds";
      const issues = [];
      if (state === "recording" && (lastMotionT === null || now - lastMotionT > 1500)) issues.push("no-motion-events");
      if (state === "recording" && rateHz > 0 && rateHz < 25) issues.push("low-sample-rate");
      if (rotationPeak !== null && rotationPeak > options.handlingRotationDegS) issues.push("phone-handled");
      if (config.gpsMode !== "off" && state === "recording" && (!lastFix || now - lastFix.t > 5000)) issues.push("gps-missing");
      if (lastFix && lastFix.speed !== null && lastFix.speed < 2.5 && config.mode !== "bicycle") issues.push("too-slow");
      return {
        state,
        samples: trace ? trace.motion.rows.length : 0,
        durationS: trace && lastMotionT !== null ? lastMotionT / 1000 : 0,
        rateHz,
        reportedInterval,
        intervalUnit,
        gyroscope: hasGyro,
        linearAcceleration: hasLinear,
        gravityMagnitude: lastGravity,
        rotationPeakDegS: rotationPeak,
        gpsFixes: trace ? trace.gps.rows.length : 0,
        lastSpeedMs: lastFix?.speed ?? null,
        lastAccuracyM: lastFix?.accuracy ?? null,
        estimatedBytes: trace ? trace.motion.rows.length * 90 + trace.gps.rows.length * 60 : 0,
        issues,
      };
    },

    /** A copy of the recording as a lastrico-roughness-trace v1 object. */
    toTrace(extraMeta = {}) {
      if (!trace) return null;
      const copy = structuredClone(trace);
      copy.meta = {
        ...copy.meta,
        ...extraMeta,
        reportedInterval,
        reportedIntervalUnitGuess: reportedInterval === null ? null : reportedInterval < 1 ? "s" : "ms",
        sampleCount: copy.motion.rows.length,
        gpsFixCount: copy.gps.rows.length,
      };
      return copy;
    },
  };
  return recorder;
}
