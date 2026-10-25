export class ReportInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Count actual bytes, including streamed bodies without Content-Length.
export async function readReportJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ReportInputError("La segnalazione è troppo grande.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ReportInputError("Invia una segnalazione JSON valida.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ReportInputError("La segnalazione è troppo grande.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReportInputError("Invia una segnalazione JSON valida.");
  }
}

export function validateReportShape(value: unknown): asserts value is {
  start: [number, number];
  end: [number, number];
  kind?: unknown;
  severity?: unknown;
  note?: string;
  website?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportInputError("Segnalazione non valida.");
  }
  const payload = value as Record<string, unknown>;
  for (const field of ["start", "end"]) {
    const coordinate = payload[field];
    if (!Array.isArray(coordinate) || coordinate.length !== 2
      || !coordinate.every((axis) => typeof axis === "number" && Number.isFinite(axis))) {
      throw new ReportInputError("Seleziona un tratto valido nell’area di Milano.");
    }
  }
  if ((payload.note !== undefined && typeof payload.note !== "string")
    || (payload.website !== undefined && typeof payload.website !== "string")) {
    throw new ReportInputError("Segnalazione non valida.");
  }
}

// Best-effort per-isolate protection; a shared limiter is a separate hosting concern.
export function createReportQuota(windowMs: number, maximumReports: number, maximumClients = 5_000) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextCleanupAt = 0;
  return (key: string | null, now: number) => {
    if (!key) return { allowed: true, retryAfterSeconds: 0 };
    if (now >= nextCleanupAt || windows.size >= maximumClients) {
      for (const [candidateKey, window] of windows) {
        if (window.resetAt <= now) windows.delete(candidateKey);
      }
      nextCleanupAt = now + windowMs;
    }
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && windows.size >= maximumClients) {
        const earliestReset = Math.min(...Array.from(windows.values(), (window) => window.resetAt));
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((earliestReset - now) / 1000)) };
      }
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= maximumReports) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
