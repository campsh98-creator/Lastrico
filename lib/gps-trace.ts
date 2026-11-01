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
  withReplacementRoute,
  type GpsFix,
  type NavigationFixContext,
  type NavigationFixDecision,
  type NavigationTransportMode,
} from "./navigation-fix-processor.ts";
import { PILOT_AREAS, type PilotAreaId } from "./pilot-areas.ts";
import { buildRouteProgressModel, type ProgressInstruction } from "./route-progress.ts";

export const GPS_TRACE_SCHEMA = "lastrico-gps-trace";
export const GPS_TRACE_VERSION = 1;
export const GPS_TRACE_APP_VERSION = "0.5.0";
export const MAX_TRACE_FIXES = 14_400;
export const MAX_STORED_TRACES = 3;

const FLUSH_EVERY_FIXES = 15;
const INDEX_KEY = "lastrico-gps-trace-index";
const metaKey = (id: string) => `lastrico-gps-trace:${id}:meta`;
const routeKey = (id: string, index: number) => `lastrico-gps-trace:${id}:route:${index}`;
const chunkKey = (id: string, index: number) => `lastrico-gps-trace:${id}:chunk:${index}`;

export type TraceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TraceRoute<T extends ProgressInstruction = ProgressInstruction> = {
  /** Number of fixes recorded before this route became active. */
  atFix: number;
  /** Progress the app assigned on the new route, so replay does not have to guess it. */
  progressMeters: number;
  minutes: number;
  distanceKm: number;
  coordinates: [number, number][];
  instructions: T[];
};

/** [timestamp, lon, lat, accuracy, heading, speed, receivedAt, lastCalculationAt, calculating] */
export type TraceFix = [
  number, number, number, number, number | null, number | null, number, number, 0 | 1,
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
  version: typeof GPS_TRACE_VERSION;
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

/**
 * Writes small chunks rather than rewriting one growing value, so a long drive never blocks the
 * main thread on a large synchronous storage write.
 */
export function createGpsTraceRecorder(storage: TraceStorage | null) {
  let status: TraceRecorderStatus = "idle";
  let summary: TraceSummary | null = null;
  let pendingFixes: TraceFix[] = [];
  let pendingDecisions: TraceDecision[] = [];
  let pendingEvents: TraceEvent[] = [];

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
      const saved = write(metaKey(meta.id), JSON.stringify({
        schema: GPS_TRACE_SCHEMA,
        version: GPS_TRACE_VERSION,
        appVersion: GPS_TRACE_APP_VERSION,
        ...meta,
      }));
      status = saved && writeIndex() ? "recording" : "suspended";
    },

    addRoute(route: Omit<TraceRoute, "atFix">) {
      if (status !== "recording" || !summary) return;
      // Everything recorded so far belongs to the previous route.
      recorder.flush();
      if ((status as TraceRecorderStatus) !== "recording") return;
      const saved = write(routeKey(summary.id, summary.routes), JSON.stringify({ ...route, atFix: summary.fixes }));
      if (!saved) {
        suspend();
        return;
      }
      summary.routes += 1;
      if (!writeIndex()) suspend();
    },

    recordFix<T extends ProgressInstruction & { id?: string }>(
      fix: GpsFix,
      context: Pick<NavigationFixContext<T>, "now" | "lastCalculationAt" | "calculationInProgress">,
      decision: NavigationFixDecision<T>,
    ) {
      if (status !== "recording" || !summary) return;
      pendingFixes.push([
        fix.timestamp, fix.coordinate[0], fix.coordinate[1], fix.accuracy, fix.heading, fix.speed,
        context.now, context.lastCalculationAt, context.calculationInProgress ? 1 : 0,
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
      const saved = write(chunkKey(summary.id, summary.chunks), JSON.stringify({
        fixes: pendingFixes,
        decisions: pendingDecisions,
        events: pendingEvents,
      }));
      if (!saved) {
        suspend();
        return;
      }
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
  if (trace.schema !== GPS_TRACE_SCHEMA || trace.version !== GPS_TRACE_VERSION) {
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

  trace.fixes.forEach((fix, index) => {
    while (nextRoute < trace.routes.length && trace.routes[nextRoute].atFix <= index) {
      const route = trace.routes[nextRoute];
      active = { route, model: buildRouteProgressModel(route.coordinates, route.instructions, distanceMeters) };
      state = withReplacementRoute(state, route.progressMeters);
      nextRoute += 1;
    }
    const [timestamp, lon, lat, accuracy, heading, speed, now, lastCalculationAt, calculating] = fix;
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
