/**
 * Optional local recording of raw GPS fixes and the decisions made from them, so a field test
 * can be replayed later. Traces reveal where someone was: they stay in this browser's storage
 * until the person exports them, and nothing here touches the network.
 */
import {
  createNavigationFixState,
  distanceMeters,
  NAVIGATION_POLICY,
  processGpsFix,
  REROUTE_COOLDOWN_MS,
  withClearedReadings,
  withReplacementRoute,
  type GpsFix,
  type NavigationFixContext,
  type NavigationFixDecision,
  type NavigationTransportMode,
} from "./navigation-fix-processor.ts";
import { PILOT_AREAS, type PilotAreaId } from "./pilot-areas.ts";
import { buildRouteProgressModel, type ProgressInstruction } from "./route-progress.ts";

export const GPS_TRACE_SCHEMA = "lastrico-gps-trace";
/** Phase 4.34: v2 adds each route's objective, pavé exposure and rough sections, and new events. */
export const GPS_TRACE_VERSION = 2;
export const SUPPORTED_TRACE_VERSIONS: readonly number[] = [1, 2];
export const GPS_TRACE_APP_VERSION = "0.5.0";
/** Four hours at one fix per second. */
export const MAX_TRACE_FIXES = 14_400;
export const MAX_STORED_TRACES = 3;
/** Phase 4.34: a trace is deleted from the device a week after it was recorded. */
export const MAX_TRACE_AGE_DAYS = 7;
/**
 * Phase 4.34: all traces together may use at most this much browser storage (UTF-16 bytes, as
 * browsers count it). Safari allows about 5 MB per site, shared with the app's plans, settings and
 * field notes, so traces keep to half. At about 310 bytes per fix that is roughly two hours at one
 * fix per second: the oldest other traces are dropped first, then recording stops as "full".
 */
export const MAX_TRACE_STORAGE_BYTES = 2_500_000;

const FLUSH_EVERY_FIXES = 15;
const INDEX_KEY = "lastrico-gps-trace-index";
const metaKey = (id: string) => `lastrico-gps-trace:${id}:meta`;
const routeKey = (id: string, index: number) => `lastrico-gps-trace:${id}:route:${index}`;
const chunkKey = (id: string, index: number) => `lastrico-gps-trace:${id}:chunk:${index}`;

export type TraceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Phase 4.34: what the route promised about pavé, so a field test can be compared with it. */
export type TraceRoughSection = {
  startMeters: number;
  endMeters: number;
  confirmedMeters: number;
  probableMeters: number;
  name?: string;
  surface?: string;
};

export type TracePaveExposure = {
  confirmedMeters: number;
  probableMeters: number;
  unknownMeters: number;
};

export type TraceRoute<T extends ProgressInstruction = ProgressInstruction> = {
  /** Number of fixes recorded before this route became active. */
  atFix: number;
  /** Progress the app assigned on the new route, so replay does not have to guess it. */
  progressMeters: number;
  minutes: number;
  distanceKm: number;
  coordinates: [number, number][];
  instructions: T[];
  /** v2: the objective the route was selected for ("fast" or "safe", the anti-pavé route). */
  objective?: "fast" | "safe";
  /** v2: the pavé the route was expected to have. */
  pave?: TracePaveExposure;
  /** v2: the rough sections the app could warn about on this route. */
  roughSections?: TraceRoughSection[];
};

/** [timestamp, lon, lat, accuracy, heading, speed, receivedAt, lastCalculationAt, calculating, cooldownMs] */
export type TraceFix = [
  number, number, number, number, number | null, number | null, number, number, 0 | 1, number,
];

export type TraceDecision =
  | { outcome: "outside" }
  | { outcome: "rejected"; reason: string }
  | {
      outcome: "accepted";
      elapsedSeconds: number;
      progressMeters: number | null;
      offRouteMeters: number | null;
      instructionId: string | null;
      pendingJump: { progressMeters: number; confirmations: number; elapsedSeconds: number } | null;
      offRouteReadings: number;
      arrived: boolean;
      shouldRecalculate: boolean;
    };

export type TraceEvent = { atFix: number; type: string; detail?: string };

export type GpsTrace = {
  schema: typeof GPS_TRACE_SCHEMA;
  version: number;
  appVersion: string;
  id: string;
  startedAt: string;
  area: PilotAreaId;
  mode: NavigationTransportMode;
  /** Present only on generated fixtures, which must never be mistaken for a field recording. */
  synthetic?: boolean;
  routes: TraceRoute[];
  fixes: TraceFix[];
  decisions: TraceDecision[];
  events: TraceEvent[];
};

export type TraceSummary = {
  id: string;
  startedAt: string;
  area: PilotAreaId;
  mode: NavigationTransportMode;
  fixes: number;
  routes: number;
  chunks: number;
};

export type TraceRecorderStatus = "idle" | "recording" | "suspended" | "full";

export const READINGS_CLEARED_EVENT = "readings-cleared";

/**
 * Events a trace may contain. Details never hold free text typed by the person: field notes record
 * only their kind.
 * - Phase 4.29–4.31: reroute-start (detail: deviation reason), reroute-success (objective and
 *   whether an alternative was found), reroute-failure (timeout, http-NNN or network), voice-spoken
 *   (instruction id), pave-warning-spoken (spoken text), gps-rearm (stall or recenter), and the
 *   diagnostics events signal-loss, foreground-resume, off-route, reroute-start, wake-lock.
 * - Phase 4.34: pave-warning-shown ("<section start m>:<distance m>"), page-hidden, page-visible,
 *   route-switch (the person chose the other route), field-note (the note's kind).
 */
export const TRACE_EVENT_TYPES = [
  "reroute-start", "reroute-success", "reroute-failure", "voice-spoken", "pave-warning-spoken",
  "pave-warning-shown", "gps-rearm", "signal-loss", "foreground-resume", "off-route", "wake-lock",
  "permission-denied", "page-hidden", "page-visible", "route-switch", "field-note", READINGS_CLEARED_EVENT,
] as const;

const rounded = (value: number) => Math.round(value * 10) / 10;

export function compactDecision<T extends ProgressInstruction & { id?: string }>(
  decision: NavigationFixDecision<T>,
): TraceDecision {
  if (decision.outcome === "outside") return { outcome: "outside" };
  if (decision.outcome === "rejected") return { outcome: "rejected", reason: decision.reason };
  const { progress } = decision;
  return {
    outcome: "accepted",
    elapsedSeconds: rounded(decision.elapsedSeconds),
    progressMeters: progress ? rounded(progress.routeProgressMeters) : null,
    offRouteMeters: progress ? rounded(progress.offRouteMeters) : null,
    instructionId: progress?.instruction?.id ?? null,
    pendingJump: progress?.pendingJump
      ? {
          progressMeters: rounded(progress.pendingJump.progressMeters),
          confirmations: progress.pendingJump.confirmations,
          elapsedSeconds: rounded(progress.pendingJump.elapsedSeconds),
        }
      : null,
    offRouteReadings: decision.state.offRouteReadings,
    arrived: decision.arrived,
    shouldRecalculate: decision.shouldRecalculate,
  };
}

function readIndex(storage: TraceStorage): TraceSummary[] {
  try {
    const parsed = JSON.parse(storage.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listGpsTraces(storage: TraceStorage | null): TraceSummary[] {
  return storage ? readIndex(storage) : [];
}

export function deleteGpsTrace(storage: TraceStorage, id: string) {
  const summaries = readIndex(storage);
  const summary = summaries.find((item) => item.id === id);
  try {
    storage.removeItem(metaKey(id));
    for (let index = 0; index < (summary?.routes ?? 0); index += 1) storage.removeItem(routeKey(id, index));
    for (let index = 0; index < (summary?.chunks ?? 0); index += 1) storage.removeItem(chunkKey(id, index));
    storage.setItem(INDEX_KEY, JSON.stringify(summaries.filter((item) => item.id !== id)));
  } catch {
    // Unavailable storage holds nothing further that this call could remove.
  }
}

export function readGpsTrace(storage: TraceStorage, id: string): GpsTrace | null {
  const summary = readIndex(storage).find((item) => item.id === id);
  if (!summary) return null;
  try {
    const meta = JSON.parse(storage.getItem(metaKey(id)) ?? "null");
    if (!meta) return null;
    const trace: GpsTrace = { ...meta, routes: [], fixes: [], decisions: [], events: [] };
    for (let index = 0; index < summary.routes; index += 1) {
      const route = storage.getItem(routeKey(id, index));
      if (route) trace.routes.push(JSON.parse(route));
    }
    for (let index = 0; index < summary.chunks; index += 1) {
      const chunk = storage.getItem(chunkKey(id, index));
      if (!chunk) continue;
      const parsed = JSON.parse(chunk);
      trace.fixes.push(...parsed.fixes);
      trace.decisions.push(...parsed.decisions);
      trace.events.push(...parsed.events);
    }
    return trace;
  } catch {
    return null;
  }
}

/** Phase 4.34: deletes traces recorded more than MAX_TRACE_AGE_DAYS ago; returns how many. */
export function pruneExpiredGpsTraces(storage: TraceStorage | null, now = Date.now()) {
  if (!storage) return 0;
  const cutoff = now - MAX_TRACE_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const summary of readIndex(storage)) {
    const startedAt = Date.parse(summary.startedAt);
    if (!Number.isFinite(startedAt) || startedAt < cutoff) {
      deleteGpsTrace(storage, summary.id);
      removed += 1;
    }
  }
  return removed;
}

/** Phase 4.34: approximate bytes a stored trace occupies (UTF-16 storage counts two per character). */
export function storedTraceBytes(storage: TraceStorage | null, id: string) {
  if (!storage) return 0;
  const summary = readIndex(storage).find((item) => item.id === id);
  if (!summary) return 0;
  const keys = [metaKey(id)];
  for (let index = 0; index < summary.routes; index += 1) keys.push(routeKey(id, index));
  for (let index = 0; index < summary.chunks; index += 1) keys.push(chunkKey(id, index));
  let characters = 0;
  try {
    for (const key of keys) characters += key.length + (storage.getItem(key)?.length ?? 0);
  } catch {
    return 0;
  }
  return characters * 2;
}

const xml = (value: string | number) => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const coordinateText = (value: number) => value.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");

/**
 * Phase 4.34: GPX 1.1 for map tools. The recorded fixes are the track, with the reported accuracy,
 * heading and speed in an extension; each route the app followed is a `<rte>` named after its
 * objective. Decisions and events stay in the JSON export, which is what replay reads.
 */
export function gpsTraceToGpx(trace: GpsTrace): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Lastrico" xmlns="http://www.topografix.com/GPX/1/1" xmlns:lastrico="https://github.com/campsh98-creator/Lastrico/gpx/1">',
    `  <metadata><name>${xml(`Lastrico ${trace.area} ${trace.mode} ${trace.startedAt}`)}</name><time>${xml(trace.startedAt)}</time></metadata>`,
  ];
  trace.routes.forEach((route, index) => {
    const objective = route.objective === "safe" ? "anti-pavé" : route.objective === "fast" ? "più rapido" : "percorso";
    lines.push(`  <rte><name>${xml(`${index + 1} · ${objective} · dalla rilevazione ${route.atFix}`)}</name>`);
    for (const [lon, lat] of route.coordinates) lines.push(`    <rtept lat="${coordinateText(lat)}" lon="${coordinateText(lon)}"/>`);
    lines.push("  </rte>");
  });
  lines.push(`  <trk><name>${xml("Rilevazioni GPS")}</name><trkseg>`);
  for (const [timestamp, lon, lat, accuracy, heading, speed] of trace.fixes) {
    const extensions = [`<lastrico:accuracy>${xml(rounded(accuracy))}</lastrico:accuracy>`];
    if (heading !== null) extensions.push(`<lastrico:heading>${xml(rounded(heading))}</lastrico:heading>`);
    if (speed !== null) extensions.push(`<lastrico:speed>${xml(rounded(speed))}</lastrico:speed>`);
    lines.push(`    <trkpt lat="${coordinateText(lat)}" lon="${coordinateText(lon)}"><time>${new Date(timestamp).toISOString()}</time><extensions>${extensions.join("")}</extensions></trkpt>`);
  }
  lines.push("  </trkseg></trk>", "</gpx>");
  return lines.join("\n") + "\n";
}

const TRACE_FIELDS = new Set(["schema", "version", "appVersion", "id", "startedAt", "area", "mode", "synthetic", "routes", "fixes", "decisions", "events"]);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const finiteOrNull = (value: unknown) => value === null || finite(value);

/**
 * Phase 4.34: validates an exported trace before replay. It accepts only the fields Lastrico writes,
 * so an edited file cannot carry names, e-mails or device identifiers into a shared report.
 */
export function parseGpsTrace(input: string | unknown): GpsTrace {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Not a trace object");
  const trace = value as Record<string, unknown>;
  const unknown = Object.keys(trace).filter((key) => !TRACE_FIELDS.has(key));
  if (unknown.length) throw new Error(`Unexpected trace fields: ${unknown.join(", ")}`);
  if (trace.schema !== GPS_TRACE_SCHEMA || !SUPPORTED_TRACE_VERSIONS.includes(trace.version as number)) {
    throw new Error(`Unsupported trace format: ${String(trace.schema)} v${String(trace.version)}`);
  }
  if (typeof trace.area !== "string" || !Object.hasOwn(PILOT_AREAS, trace.area)) throw new Error("Unsupported area");
  if (typeof trace.mode !== "string" || !Object.hasOwn(NAVIGATION_POLICY, trace.mode)) throw new Error("Unsupported mode");
  if (typeof trace.id !== "string" || typeof trace.startedAt !== "string" || !Number.isFinite(Date.parse(trace.startedAt))) {
    throw new Error("Missing id or start time");
  }
  for (const field of ["routes", "fixes", "decisions", "events"]) {
    if (!Array.isArray(trace[field])) throw new Error(`${field} must be a list`);
  }
  const fixes = trace.fixes as unknown[];
  if (fixes.length > MAX_TRACE_FIXES) throw new Error("Too many fixes");
  if ((trace.decisions as unknown[]).length !== fixes.length) throw new Error("Each fix needs its decision");
  fixes.forEach((fix, index) => {
    if (!Array.isArray(fix) || fix.length !== 10
      || ![0, 1, 2, 3, 6, 7, 9].every((at) => finite(fix[at])) || !finiteOrNull(fix[4]) || !finiteOrNull(fix[5])
      || (fix[8] !== 0 && fix[8] !== 1)) {
      throw new Error(`Malformed fix ${index}`);
    }
  });
  (trace.routes as unknown[]).forEach((route, index) => {
    const candidate = route as Partial<TraceRoute> | null;
    if (!candidate || !finite(candidate.atFix) || !finite(candidate.progressMeters) || !Array.isArray(candidate.coordinates)
      || !Array.isArray(candidate.instructions) || candidate.coordinates.some((point) => !Array.isArray(point) || !finite(point[0]) || !finite(point[1]))) {
      throw new Error(`Malformed route ${index}`);
    }
  });
  (trace.events as unknown[]).forEach((event, index) => {
    const candidate = event as Partial<TraceEvent> | null;
    if (!candidate || !finite(candidate.atFix) || typeof candidate.type !== "string"
      || (candidate.detail !== undefined && typeof candidate.detail !== "string")) {
      throw new Error(`Malformed event ${index}`);
    }
  });
  return value as GpsTrace;
}

/**
 * Writes small chunks rather than rewriting one growing value, so a long drive never blocks the
 * main thread on a large synchronous storage write.
 */
export function createGpsTraceRecorder(
  storage: TraceStorage | null,
  { budgetBytes = MAX_TRACE_STORAGE_BYTES }: { budgetBytes?: number } = {},
) {
  let status: TraceRecorderStatus = "idle";
  let summary: TraceSummary | null = null;
  let pendingFixes: TraceFix[] = [];
  let pendingDecisions: TraceDecision[] = [];
  let pendingEvents: TraceEvent[] = [];
  /** Bytes the current trace has written, and those the other stored traces occupy. */
  let currentBytes = 0;
  let otherBytes = 0;

  /**
   * Phase 4.34: makes room for `bytes` more within the budget by dropping the oldest other traces;
   * false when even the current trace alone would exceed it.
   */
  function fitsBudget(bytes: number) {
    if (!storage) return false;
    while (otherBytes + currentBytes + bytes > budgetBytes) {
      const oldest = readIndex(storage).find((item) => item.id !== summary?.id);
      if (!oldest) return false;
      otherBytes = Math.max(0, otherBytes - storedTraceBytes(storage, oldest.id));
      deleteGpsTrace(storage, oldest.id);
    }
    return true;
  }

  /** Storing a new trace may free space by dropping the oldest other one, never the current one. */
  function write(key: string, value: string) {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      const oldest = readIndex(storage).find((item) => item.id !== summary?.id);
      if (!oldest) return false;
      deleteGpsTrace(storage, oldest.id);
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  }

  function writeIndex() {
    if (!storage || !summary) return false;
    const current = summary;
    const others = readIndex(storage).filter((item) => item.id !== current.id);
    return write(INDEX_KEY, JSON.stringify([...others, current]));
  }

  function suspend() {
    status = "suspended";
    pendingFixes = [];
    pendingDecisions = [];
    pendingEvents = [];
  }

  const recorder = {
    get status() { return status; },
    get id() { return summary?.id ?? null; },

    start(meta: { area: PilotAreaId; mode: NavigationTransportMode; startedAt: string; id: string }) {
      pendingFixes = [];
      pendingDecisions = [];
      pendingEvents = [];
      summary = { ...meta, fixes: 0, routes: 0, chunks: 0 };
      if (!storage) {
        status = "suspended";
        return;
      }
      const existing = readIndex(storage);
      for (const old of existing.slice(0, Math.max(0, existing.length - (MAX_STORED_TRACES - 1)))) {
        deleteGpsTrace(storage, old.id);
      }
      currentBytes = 0;
      otherBytes = readIndex(storage).reduce((total, item) => total + storedTraceBytes(storage, item.id), 0);
      const metaValue = JSON.stringify({
        schema: GPS_TRACE_SCHEMA,
        version: GPS_TRACE_VERSION,
        appVersion: GPS_TRACE_APP_VERSION,
        ...meta,
      });
      const metaBytes = (metaKey(meta.id).length + metaValue.length) * 2;
      const saved = fitsBudget(metaBytes) && write(metaKey(meta.id), metaValue);
      if (saved) currentBytes += metaBytes;
      status = saved && writeIndex() ? "recording" : "suspended";
    },

    addRoute(route: Omit<TraceRoute, "atFix">) {
      if (status !== "recording" || !summary) return;
      // Everything recorded so far belongs to the previous route.
      recorder.flush();
      if ((status as TraceRecorderStatus) !== "recording") return;
      const key = routeKey(summary.id, summary.routes);
      const value = JSON.stringify({ ...route, atFix: summary.fixes });
      const bytes = (key.length + value.length) * 2;
      if (!fitsBudget(bytes)) {
        status = "full";
        return;
      }
      const saved = write(key, value);
      if (!saved) {
        suspend();
        return;
      }
      currentBytes += bytes;
      summary.routes += 1;
      if (!writeIndex()) suspend();
    },

    recordFix<T extends ProgressInstruction & { id?: string }>(
      fix: GpsFix,
      context: Pick<NavigationFixContext<T>, "now" | "lastCalculationAt" | "calculationInProgress" | "rerouteCooldownMs">,
      decision: NavigationFixDecision<T>,
    ) {
      if (status !== "recording" || !summary) return;
      pendingFixes.push([
        fix.timestamp, fix.coordinate[0], fix.coordinate[1], fix.accuracy, fix.heading, fix.speed,
        context.now, context.lastCalculationAt, context.calculationInProgress ? 1 : 0,
        context.rerouteCooldownMs ?? REROUTE_COOLDOWN_MS,
      ]);
      pendingDecisions.push(compactDecision(decision));
      summary.fixes += 1;
      if (summary.fixes >= MAX_TRACE_FIXES) {
        recorder.flush();
        if ((status as TraceRecorderStatus) === "recording") status = "full";
      } else if (pendingFixes.length >= FLUSH_EVERY_FIXES) {
        recorder.flush();
      }
    },

    recordEvent(type: string, detail?: string) {
      if (status !== "recording" || !summary) return;
      pendingEvents.push({ atFix: summary.fixes, type, ...(detail ? { detail } : {}) });
    },

    flush() {
      if (status !== "recording" || !summary) return;
      if (!pendingFixes.length && !pendingEvents.length) return;
      const key = chunkKey(summary.id, summary.chunks);
      const value = JSON.stringify({
        fixes: pendingFixes,
        decisions: pendingDecisions,
        events: pendingEvents,
      });
      const bytes = (key.length + value.length) * 2;
      if (!fitsBudget(bytes)) {
        // What is already stored stays a valid trace; the last few seconds are not kept.
        status = "full";
        pendingFixes = [];
        pendingDecisions = [];
        pendingEvents = [];
        return;
      }
      const saved = write(key, value);
      if (!saved) {
        suspend();
        return;
      }
      currentBytes += bytes;
      summary.chunks += 1;
      pendingFixes = [];
      pendingDecisions = [];
      pendingEvents = [];
      if (!writeIndex()) suspend();
    },

    stop() {
      recorder.flush();
      status = "idle";
      summary = null;
    },
  };
  return recorder;
}

export type TraceReplayReport = {
  fixes: number;
  accepted: number;
  rejected: Record<string, number>;
  outside: number;
  largestForwardAdvanceMeters: number;
  heldFixes: number;
  reroutes: number;
  skippedInstructions: string[];
  arrived: boolean;
  differences: { atFix: number; recorded: TraceDecision; replayed: TraceDecision }[];
};

/** An advance this large between two fixes skips instructions rather than passing them normally. */
const SKIPPED_INSTRUCTION_ADVANCE_METERS = 150;

/** Re-runs the app's per-fix logic over a trace; differences reveal changed behaviour. */
export function replayGpsTrace(trace: GpsTrace): TraceReplayReport {
  if (trace.schema !== GPS_TRACE_SCHEMA || !SUPPORTED_TRACE_VERSIONS.includes(trace.version)) {
    throw new Error(`Unsupported trace format: ${trace.schema} v${trace.version}`);
  }
  if (!Object.hasOwn(NAVIGATION_POLICY, trace.mode) || !Object.hasOwn(PILOT_AREAS, trace.area)) {
    throw new Error("Unsupported trace mode or area");
  }
  const report: TraceReplayReport = {
    fixes: trace.fixes.length,
    accepted: 0,
    rejected: {},
    outside: 0,
    largestForwardAdvanceMeters: 0,
    heldFixes: 0,
    reroutes: 0,
    skippedInstructions: [],
    arrived: false,
    differences: [],
  };
  let state = createNavigationFixState();
  let active: { route: TraceRoute; model: ReturnType<typeof buildRouteProgressModel<ProgressInstruction & { id?: string }>> } | null = null;
  let nextRoute = 0;
  const clearedAt = new Set(trace.events.filter((event) => event.type === READINGS_CLEARED_EVENT).map((event) => event.atFix));

  trace.fixes.forEach((fix, index) => {
    if (clearedAt.has(index)) state = withClearedReadings(state);
    while (nextRoute < trace.routes.length && trace.routes[nextRoute].atFix <= index) {
      const route = trace.routes[nextRoute];
      active = { route, model: buildRouteProgressModel(route.coordinates, route.instructions, distanceMeters) };
      state = withReplacementRoute(state, route.progressMeters);
      nextRoute += 1;
    }
    const [timestamp, lon, lat, accuracy, heading, speed, now, lastCalculationAt, calculating, cooldownMs] = fix;
    const previousProgress = state.progressMeters;
    const current = active as { route: TraceRoute; model: ReturnType<typeof buildRouteProgressModel<ProgressInstruction & { id?: string }>> } | null;
    const decision = processGpsFix(state, { coordinate: [lon, lat], accuracy, timestamp, heading, speed }, {
      now,
      mode: trace.mode,
      bounds: PILOT_AREAS[trace.area].bounds,
      route: current
        ? { model: current.model, minutes: current.route.minutes, distanceKm: current.route.distanceKm }
        : null,
      lastCalculationAt,
      calculationInProgress: calculating === 1,
      rerouteCooldownMs: cooldownMs,
    });
    state = decision.state;

    if (decision.outcome === "outside") report.outside += 1;
    else if (decision.outcome === "rejected") {
      report.rejected[decision.reason] = (report.rejected[decision.reason] ?? 0) + 1;
    } else {
      report.accepted += 1;
      const advance = state.progressMeters - previousProgress;
      report.largestForwardAdvanceMeters = Math.max(report.largestForwardAdvanceMeters, rounded(advance));
      if (decision.progress?.pendingJump) report.heldFixes += 1;
      if (decision.shouldRecalculate) report.reroutes += 1;
      if (decision.arrived) report.arrived = true;
      if (current && advance >= SKIPPED_INSTRUCTION_ADVANCE_METERS) {
        for (const { instruction, progressMeters } of current.model.instructions) {
          if (progressMeters > previousProgress && progressMeters <= state.progressMeters && instruction.id) {
            report.skippedInstructions.push(instruction.id);
          }
        }
      }
    }

    const replayed = compactDecision(decision);
    const recorded = trace.decisions[index];
    if (JSON.stringify(replayed) !== JSON.stringify(recorded)) {
      report.differences.push({ atFix: index, recorded, replayed });
    }
  });
  return report;
}
