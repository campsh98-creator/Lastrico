/**
 * Hard quota and breaker rules for the live-traffic provider (TomTom Traffic Flow and Incident vector tiles, free plan).
 * Pure functions over a small state record, so the rules are tested without Cloudflare. The Durable Object ledger
 * (worker/traffic-hub.ts) persists the state and applies these functions; nothing else calls the provider.
 *
 * Caps sit far below the free allowance TomTom's pricing page lists for these tiles (200,000 a month, checked 19 Nov 2026;
 * an older FAQ states 50,000 tile requests a day): a spent cap stops the provider calls, it never leaves the free plan.
 */
export type TrafficCaps = {
  dailyTiles: number;
  monthlyTiles: number;
  /** Part of the daily total the map overlay may use, so a map left open cannot starve route calculations. */
  dailyOverlayTiles: number;
  /** Tile requests (cache hits included) one route calculation may ask for. */
  perCalculationTiles: number;
};

export const DEFAULT_TRAFFIC_CAPS: TrafficCaps = {
  dailyTiles: 4_000,
  monthlyTiles: 60_000,
  dailyOverlayTiles: 1_500,
  perCalculationTiles: 24,
};

export type TrafficPurpose = "route" | "overlay";

export type TrafficUsage = {
  day: string;
  dayUsed: number;
  dayOverlayUsed: number;
  month: string;
  monthUsed: number;
};

export type QuotaDenial = "daily" | "monthly" | "overlay";

export function emptyUsage(now: number): TrafficUsage {
  const date = new Date(now).toISOString();
  return { day: date.slice(0, 10), dayUsed: 0, dayOverlayUsed: 0, month: date.slice(0, 7), monthUsed: 0 };
}

/** The usage rolled over to the current UTC day and month. */
export function rolled(usage: TrafficUsage | null, now: number): TrafficUsage {
  const fresh = emptyUsage(now);
  if (!usage) return fresh;
  return {
    day: fresh.day,
    dayUsed: usage.day === fresh.day ? usage.dayUsed : 0,
    dayOverlayUsed: usage.day === fresh.day ? usage.dayOverlayUsed : 0,
    month: fresh.month,
    monthUsed: usage.month === fresh.month ? usage.monthUsed : 0,
  };
}

/** Takes `count` tile requests from the caps, all or nothing. */
export function reserve(
  usage: TrafficUsage | null,
  now: number,
  count: number,
  purpose: TrafficPurpose,
  caps: TrafficCaps = DEFAULT_TRAFFIC_CAPS,
): { ok: true; usage: TrafficUsage } | { ok: false; reason: QuotaDenial; usage: TrafficUsage } {
  const current = rolled(usage, now);
  if (current.monthUsed + count > caps.monthlyTiles) return { ok: false, reason: "monthly", usage: current };
  if (current.dayUsed + count > caps.dailyTiles) return { ok: false, reason: "daily", usage: current };
  if (purpose === "overlay" && current.dayOverlayUsed + count > caps.dailyOverlayTiles) return { ok: false, reason: "overlay", usage: current };
  return {
    ok: true,
    usage: {
      ...current,
      dayUsed: current.dayUsed + count,
      monthUsed: current.monthUsed + count,
      dayOverlayUsed: current.dayOverlayUsed + (purpose === "overlay" ? count : 0),
    },
  };
}

export type BreakerReason = "key-rejected" | "provider-limit" | "provider-failing";
export type BreakerState = {
  failures: number;
  /** Provider calls are refused until this time (ms since epoch); 0 when closed. */
  openUntil: number;
  reason: BreakerReason | null;
};

export const CLOSED_BREAKER: BreakerState = { failures: 0, openUntil: 0, reason: null };
const KEY_REJECTED_MS = 6 * 60 * 60 * 1000;
const PROVIDER_LIMIT_MS = 15 * 60 * 1000;
const FAILING_MS = 5 * 60 * 1000;
const FAILURES_TO_OPEN = 3;

export function breakerOpen(state: BreakerState, now: number) {
  return state.openUntil > now;
}

/** A provider answer: 401/403 means the key is not accepted, 429 that the provider's own limit is reached. */
export function breakerAfterFailure(state: BreakerState, now: number, status: number | null): BreakerState {
  if (status === 401 || status === 403) return { failures: state.failures + 1, openUntil: now + KEY_REJECTED_MS, reason: "key-rejected" };
  if (status === 429) return { failures: state.failures + 1, openUntil: now + PROVIDER_LIMIT_MS, reason: "provider-limit" };
  const failures = state.failures + 1;
  return failures >= FAILURES_TO_OPEN
    ? { failures, openUntil: now + FAILING_MS, reason: "provider-failing" }
    : { failures, openUntil: state.openUntil, reason: state.reason };
}

export function breakerAfterSuccess(): BreakerState {
  return CLOSED_BREAKER;
}

export type TrafficUnavailableReason =
  | "no-key" | "key-rejected" | "provider-limit" | "provider-failing" | "quota-daily" | "quota-monthly" | "quota-overlay"
  | "timeout" | "no-binding" | "tile-unreadable" | "calculation-cap" | "outside-service-area";

export function denialReason(denial: QuotaDenial): TrafficUnavailableReason {
  return denial === "monthly" ? "quota-monthly" : denial === "overlay" ? "quota-overlay" : "quota-daily";
}
