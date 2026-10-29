function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      // Keep rejected operations observed even when cancellation wins immediately.
      void operation.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

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

// Per-isolate serialization only. A shared service limit requires shared infrastructure.
export function createGeocodeFetcher({ minimumIntervalMs = 1_050, timeoutMs = 8_000 } = {}) {
  let queue: Promise<void> = Promise.resolve();
  let lastStartedAt: number | null = null;
  return async (url: URL, callerSignal: AbortSignal): Promise<unknown> => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Geocoding timed out", "TimeoutError")), timeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout.signal]);
    const operation = queue.then(async () => {
      signal.throwIfAborted();
      const waitMs = lastStartedAt === null ? 0 : Math.max(0, minimumIntervalMs - (Date.now() - lastStartedAt));
      if (waitMs) await delay(waitMs, signal);
      signal.throwIfAborted();
      lastStartedAt = Date.now();
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "it",
          "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
        },
        signal,
      });
      if (!response.ok) throw new Error("Servizio di ricerca non disponibile");
      return response.json();
    });
    // A cancelled caller returns promptly, but its place stays behind its predecessor.
    queue = operation.then(() => undefined, () => undefined);
    try {
      return await abortable(operation, signal);
    } finally {
      clearTimeout(timer);
    }
  };
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
