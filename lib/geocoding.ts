import { PROVIDER_USER_AGENT } from "./provider-identity.ts";

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** An upstream answered with an HTTP error; `retryAfterMs` comes from its Retry-After header. */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null) {
    super(`Servizio di ricerca non disponibile (HTTP ${status})`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The next free start is later than the caller's deadline, so the call is refused at once. */
export class ProviderBusyError extends Error {
  constructor() {
    super("Servizio di ricerca occupato");
    this.name = "ProviderBusyError";
  }
}

export function retryAfterMilliseconds(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/**
 * Phase 4.35: per-isolate spacing of upstream starts (Nominatim allows at most one request per
 * second), kept in plain numbers.
 *
 * Phase 4.21–4.34 chained every call on one module-level promise. On Workers a request whose
 * client disconnects is cancelled, and its link in that chain never settles: every later call in
 * the isolate then waited on it until its own deadline ("Geocoding timed out"), for minutes. The
 * page aborts its previous request at each keystroke, so one burst of typing was enough
 * (reproduced on the pilot on 12 November 2026). Now each call reserves its own start time and
 * waits in its own request; no call ever awaits a promise created by another request.
 *
 * Starts stay at least `minimumIntervalMs` apart. A call whose reserved start would fall after its
 * deadline is refused at once (ProviderBusyError) instead of waiting to time out. A call cancelled
 * before it started gives its slot back when nobody reserved after it. A shared, cross-isolate
 * limit would need shared state (a Durable Object), which this does not claim to be.
 */
export function createGeocodeFetcher({ minimumIntervalMs = 1_050, timeoutMs = 12_000 } = {}) {
  let nextStartAt = 0;
  return async (url: URL, callerSignal: AbortSignal): Promise<unknown> => {
    callerSignal.throwIfAborted();
    const now = Date.now();
    const startAt = Math.max(now, nextStartAt);
    // Keep a margin for the request itself: a start at the deadline could never answer in time.
    if (startAt - now >= Math.max(0, timeoutMs - 250)) throw new ProviderBusyError();
    nextStartAt = startAt + minimumIntervalMs;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Geocoding timed out", "TimeoutError")), timeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout.signal]);
    let started = false;
    try {
      if (startAt > now) await delay(startAt - now, signal);
      signal.throwIfAborted();
      started = true;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "it",
          "User-Agent": PROVIDER_USER_AGENT,
        },
        signal,
      });
      if (!response.ok) throw new ProviderHttpError(response.status, retryAfterMilliseconds(response.headers.get("Retry-After")));
      return await response.json();
    } finally {
      clearTimeout(timer);
      // Never sent: free the slot, unless a later caller already reserved the one after it.
      if (!started && nextStartAt === startAt + minimumIntervalMs) nextStartAt = startAt;
    }
  };
}

type BreakerFailure = "timeout" | "http" | "network" | "busy";

/**
 * Phase 4.35: skips a provider that is failing, per isolate, so an outage answers in milliseconds
 * instead of after every deadline. Plain numbers only, for the same reason as the fetcher.
 * A 429 or 503 opens it for the provider's Retry-After (bounded); timeouts and 5xx open it after
 * two consecutive failures, with a cool-down doubling from `baseCooldownMs` up to `maxCooldownMs`.
 * A success closes it. A caller's own cancellation is not a provider failure.
 */
export function createProviderBreaker({ baseCooldownMs = 20_000, maxCooldownMs = 300_000, failuresToOpen = 2 } = {}) {
  let consecutiveFailures = 0;
  let openUntil = 0;
  let cooldownMs = baseCooldownMs;
  return {
    isOpen(now = Date.now()) {
      return now < openUntil;
    },
    retryAfterMs(now = Date.now()) {
      return Math.max(0, openUntil - now);
    },
    success() {
      consecutiveFailures = 0;
      cooldownMs = baseCooldownMs;
      openUntil = 0;
    },
    failure(kind: BreakerFailure, { retryAfterMs = null as number | null, status = 0, now = Date.now() } = {}) {
      if (kind === "busy") return;
      consecutiveFailures += 1;
      const rateLimited = kind === "http" && (status === 429 || status === 503);
      if (rateLimited) {
        const wait = Math.min(maxCooldownMs, Math.max(baseCooldownMs, retryAfterMs ?? cooldownMs));
        openUntil = Math.max(openUntil, now + wait);
        cooldownMs = Math.min(maxCooldownMs, cooldownMs * 2);
      } else if (consecutiveFailures >= failuresToOpen) {
        openUntil = Math.max(openUntil, now + cooldownMs);
        cooldownMs = Math.min(maxCooldownMs, cooldownMs * 2);
      }
    },
  };
}

export type ProviderBreaker = ReturnType<typeof createProviderBreaker>;

/** How a provider call failed, for the breaker; null when the caller itself cancelled. */
export function classifyProviderFailure(error: unknown, callerSignal: AbortSignal): { kind: BreakerFailure; status?: number; retryAfterMs?: number | null } | null {
  if (error instanceof ProviderBusyError) return { kind: "busy" };
  if (error instanceof ProviderHttpError) return { kind: "http", status: error.status, retryAfterMs: error.retryAfterMs };
  if (error instanceof DOMException && error.name === "TimeoutError") return { kind: "timeout" };
  if (callerSignal.aborted) return null;
  return { kind: "network" };
}

export type NominatimResult = {
  display_name: string;
  lat: string | number;
  lon: string | number;
  place_id: number;
  name?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

export function validMilanGeocodeResult(value: unknown): value is NominatimResult {
  return validAreaGeocodeResult(value, { west: 9.04, south: 45.38, east: 9.31, north: 45.55 });
}

export function validAreaGeocodeResult(value: unknown, bounds: { west: number; south: number; east: number; north: number }): value is NominatimResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.display_name !== "string" || typeof item.place_id !== "number" || !Number.isFinite(item.place_id)) return false;
  if (![item.lat, item.lon].every((axis) => typeof axis === "string" || typeof axis === "number")) return false;
  const longitude = Number(item.lon);
  const latitude = Number(item.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north) return false;
  for (const field of ["name", "type", "addresstype"]) {
    if (item[field] !== undefined && typeof item[field] !== "string") return false;
  }
  if (item.address !== undefined && (!item.address || typeof item.address !== "object"
    || Array.isArray(item.address) || !Object.values(item.address).every((part) => typeof part === "string"))) return false;
  return true;
}
