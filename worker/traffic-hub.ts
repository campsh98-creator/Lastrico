import { PROVIDER_USER_AGENT } from "../lib/provider-identity.ts";
import { tileForCoordinate } from "../lib/traffic/tiles.ts";
import { decodeMvt } from "../lib/traffic/mvt.ts";
import {
  breakerAfterFailure,
  breakerAfterSuccess,
  breakerOpen,
  CLOSED_BREAKER,
  DEFAULT_TRAFFIC_CAPS,
  denialReason,
  reserve,
  rolled,
  type BreakerState,
  type TrafficCaps,
  type TrafficPurpose,
  type TrafficUnavailableReason,
  type TrafficUsage,
} from "../lib/traffic/quota.ts";

/**
 * The only code that talks to the live-traffic provider (TomTom Traffic Flow and Incident vector tiles).
 * It lives in one `RouteEngine` Durable Object instance ("traffic-ledger"), so the quota counters are global, survive
 * restarts and need no new binding (the preview allows exactly one Durable Object class and no D1).
 * - The key is a Worker secret (`TOMTOM_API_KEY`); without it every call answers "no-key" and nothing leaves the Worker.
 * - A call spends the quota before it leaves, all or nothing; a cached tile costs nothing.
 * - 401/403 close the circuit for six hours, 429 for fifteen minutes, three failures in a row for five.
 * - The key is never logged, returned or put in an error.
 * Tested in Node with in-memory storage (tests/traffic-hub.test.mjs).
 */
export const TRAFFIC_HUB_HOST = "traffic-hub.internal";
export const FLOW_TTL_MS = 90_000;
export const INCIDENT_TTL_MS = 120_000;
const MAX_TILE_BYTES = 512 * 1024;
const PROVIDER_TIMEOUT_MS = 4_000;
const MIN_ZOOM = 10;
const MAX_ZOOM = 14;

/** Domain separation prevents reuse as a fingerprint for another service. Never return this digest over HTTP. */
export async function credentialFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lastrico:tomtom:v1\0${key}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type TrafficKind = "flow" | "incidents";

export interface LedgerStorage {
  readState(): { usage: TrafficUsage | null; breaker: BreakerState };
  writeUsage(usage: TrafficUsage): void;
  writeBreaker(breaker: BreakerState): void;
  readTile(key: string): { fetchedAt: number; bytes: Uint8Array } | null;
  writeTile(key: string, fetchedAt: number, bytes: Uint8Array): void;
  /** Removes cached tiles fetched before the given time. */
  pruneTiles(before: number): void;
}

export type TileResult =
  | { ok: true; bytes: Uint8Array; fetchedAt: number; cached: boolean }
  | { ok: false; reason: TrafficUnavailableReason | "bad-request" };

export type HubStatus = {
  provider: "TomTom";
  configured: boolean;
  available: boolean;
  reason: TrafficUnavailableReason | "ok";
  remainingToday: number;
  remainingThisMonth: number;
};

export function tileUrl(kind: TrafficKind, z: number, x: number, y: number, key: string) {
  const base = "https://api.tomtom.com/traffic/map/4/tile";
  return kind === "flow"
    ? `${base}/flow/relative/${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}`
    : `${base}/incidents/${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}&t=-1`;
}

export class TrafficHub {
  private readonly inflight = new Map<string, Promise<TileResult>>();
  // Serialize distinct tiles too: a late success must never erase a newer rejection.
  private queue: Promise<unknown> = Promise.resolve();
  private fingerprint?: Promise<string>;
  private readonly deps: {
    storage: LedgerStorage;
    key: string | undefined;
    fetch: typeof fetch;
    now?: () => number;
    caps?: TrafficCaps;
    probeOnly?: boolean;
  };

  constructor(deps: {
    storage: LedgerStorage;
    key: string | undefined;
    fetch: typeof fetch;
    now?: () => number;
    caps?: TrafficCaps;
    probeOnly?: boolean;
  }) {
    this.deps = deps;
  }

  private get now() {
    return (this.deps.now ?? Date.now)();
  }

  private get caps() {
    return this.deps.caps ?? DEFAULT_TRAFFIC_CAPS;
  }

  status(): HubStatus {
    const now = this.now;
    const { usage, breaker } = this.deps.storage.readState();
    const current = rolled(usage, now);
    const remainingToday = Math.max(0, this.caps.dailyTiles - current.dayUsed);
    const remainingThisMonth = Math.max(0, this.caps.monthlyTiles - current.monthUsed);
    const reason: HubStatus["reason"] = !this.deps.key ? "no-key"
      : breaker.recovery ? "auth-recovery-hold"
        : this.deps.probeOnly ? "auth-recovery-hold"
      : breakerOpen(breaker, now) ? (breaker.reason ?? "provider-failing")
        : remainingThisMonth === 0 ? "quota-monthly"
          : remainingToday === 0 ? "quota-daily" : "ok";
    return {
      provider: "TomTom",
      configured: Boolean(this.deps.key),
      available: reason === "ok",
      reason,
      remainingToday,
      remainingThisMonth,
    };
  }

  tile(kind: TrafficKind, z: number, x: number, y: number, purpose: TrafficPurpose): Promise<TileResult> {
    const n = 2 ** z;
    if (!Number.isInteger(z) || z < MIN_ZOOM || z > MAX_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
      return Promise.resolve({ ok: false, reason: "bad-request" });
    }
    const key = `${kind}/${z}/${x}/${y}`;
    // Two callers asking for the same tile at once share one provider call and one quota unit.
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const work = this.queue.then(() => this.load(kind, z, x, y, key, purpose)).finally(() => this.inflight.delete(key));
    this.queue = work.catch(() => undefined);
    this.inflight.set(key, work);
    return work;
  }

  /** Operator action only, never called by routing, overlay, or status. One fixed Milan flow tile. */
  probe(): Promise<TileResult> {
    const { z, x, y } = tileForCoordinate([9.1919, 45.4641], 14);
    const work = this.queue.then(() => this.load("flow", z, x, y, `flow/${z}/${x}/${y}`, "route", true));
    this.queue = work.catch(() => undefined);
    return work;
  }

  private async load(kind: TrafficKind, z: number, x: number, y: number, key: string, purpose: TrafficPurpose, recoveryRequest = false): Promise<TileResult> {
    const apiKey = this.deps.key;
    if (!apiKey) return { ok: false, reason: "no-key" };
    const fingerprint = await (this.fingerprint ??= credentialFingerprint(apiKey));
    const now = this.now;
    const ttl = kind === "flow" ? FLOW_TTL_MS : INCIDENT_TTL_MS;
    const cached = this.deps.storage.readTile(key);
    if (!recoveryRequest && cached && now - cached.fetchedAt < ttl && cached.fetchedAt <= now) return { ok: true, bytes: cached.bytes, fetchedAt: cached.fetchedAt, cached: true };

    const state = this.deps.storage.readState();
    const old = state.breaker;
    // Legacy rejected states have no proven identity. Never infer it from the current secret.
    const newCredential = old.fingerprint !== undefined && old.fingerprint !== fingerprint;
    const probe = recoveryRequest && !old.recovery && old.reason === "key-rejected" && newCredential
      && !(old.seenFingerprints ?? []).includes(fingerprint);
    if (old.recovery) return { ok: false, reason: "auth-recovery-hold" };
    if (recoveryRequest && !probe) return { ok: false, reason: "auth-recovery-hold" };
    if (this.deps.probeOnly && !probe) return { ok: false, reason: "auth-recovery-hold" };
    if (breakerOpen(old, now) && !probe) return { ok: false, reason: old.reason ?? "provider-failing" };
    // Synchronous read-modify-write: nothing else runs between the check and the spend.
    const spend = reserve(state.usage, now, 1, purpose, this.caps);
    if (!spend.ok) return { ok: false, reason: denialReason(spend.reason) };
    this.deps.storage.writeUsage(spend.usage);
    // Claim before I/O; a crash may burn authorization, but cannot duplicate the request.
    const identity = {
      seenFingerprints: [...new Set([...(old.seenFingerprints ?? []), ...(old.fingerprint ? [old.fingerprint] : []), fingerprint])],
      ...(probe ? { recovery: "pending" as const } : {}),
    };
    this.deps.storage.writeBreaker({ ...old, ...identity });

    let status: number | null = null;
    let unreadableProbe = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      try {
        const response = await this.deps.fetch(tileUrl(kind, z, x, y, apiKey), {
          headers: { "User-Agent": PROVIDER_USER_AGENT, Accept: "application/x-protobuf" },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        status = response.status;
        if (response.status === 200 || response.status === 204) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > MAX_TILE_BYTES) throw new Error("tile too large");
          if (probe) {
            try {
              const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
              if (status !== 200 || !contentType || !["image/pbf", "application/x-protobuf", "application/vnd.mapbox-vector-tile", "application/octet-stream"].includes(contentType)) {
                throw new Error("unexpected probe format");
              }
              const layer = decodeMvt(bytes).layers["Traffic flow"];
              const levels = layer?.features.map((feature) => feature.properties.traffic_level) ?? [];
              if (!levels.some((level) => typeof level === "number" && Number.isFinite(level) && level >= 0 && level <= 1)
                || levels.some((level) => typeof level === "number" && (!Number.isFinite(level) || level < 0 || level > 1))) {
                throw new Error("unverified flow tile");
              }
            } catch {
              unreadableProbe = true;
              throw new Error("unreadable probe tile");
            }
          }
          const fetchedAt = this.now;
          this.deps.storage.writeTile(key, fetchedAt, bytes);
          this.deps.storage.writeBreaker({ ...breakerAfterSuccess(), ...identity, fingerprint, ...(probe ? { recovery: "verified" } : {}) });
          if (Math.random() < 0.02) this.deps.storage.pruneTiles(fetchedAt - 10 * 60_000);
          return { ok: true, bytes, fetchedAt, cached: false };
        }
        await response.body?.cancel().catch(() => undefined);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      status = null;
    }
    // A 4xx other than key and limit errors is about this tile, not the provider: it does not count against the circuit.
    if (!probe && status !== null && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429) {
      return { ok: false, reason: "bad-request" };
    }
    const failed = breakerAfterFailure(this.deps.storage.readState().breaker, this.now, status);
    const next = { ...old, ...failed, ...identity, ...((status === 401 || status === 403) ? { fingerprint } : {}), ...(probe ? {
      recovery: "failed" as const,
      openUntil: Math.max(old.openUntil, failed.openUntil, this.now + 6 * 60 * 60_000),
    } : {}) };
    this.deps.storage.writeBreaker(next);
    return { ok: false, reason: unreadableProbe ? "tile-unreadable" : next.reason ?? "provider-failing" };
  }

  /** The Durable Object entry point: `/status` and `/tile?kind=&z=&x=&y=&purpose=`. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status") return Response.json(this.status(), { headers: { "cache-control": "no-store" } });
    if (url.pathname === "/auth-probe") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const result = await this.probe();
      // Return no provider bytes: cached flow may be inspected separately after a successful probe.
      return Response.json(result.ok ? { ok: true, cached: result.cached } : result, {
        status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" },
      });
    }
    if (url.pathname !== "/tile") return new Response("not found", { status: 404 });
    const kind = url.searchParams.get("kind");
    const purpose = url.searchParams.get("purpose");
    if ((kind !== "flow" && kind !== "incidents") || (purpose !== "route" && purpose !== "overlay")) return Response.json({ reason: "bad-request" }, { status: 400 });
    const result = await this.tile(kind, Number(url.searchParams.get("z")), Number(url.searchParams.get("x")), Number(url.searchParams.get("y")), purpose);
    if (!result.ok) {
      return Response.json({ reason: result.reason }, { status: result.reason === "bad-request" ? 400 : 503, headers: { "cache-control": "no-store" } });
    }
    return new Response(result.bytes as BodyInit, {
      headers: {
        "content-type": "application/x-protobuf",
        "cache-control": "no-store",
        "x-traffic-fetched-at": String(result.fetchedAt),
        "x-traffic-cached": result.cached ? "1" : "0",
      },
    });
  }
}

/** Keeps the whole ledger in memory: used by the tests, and as the fallback when SQL storage is unavailable. */
export class MemoryLedgerStorage implements LedgerStorage {
  usage: TrafficUsage | null = null;
  breaker: BreakerState = CLOSED_BREAKER;
  tiles = new Map<string, { fetchedAt: number; bytes: Uint8Array }>();
  readState() { return { usage: this.usage, breaker: this.breaker }; }
  writeUsage(usage: TrafficUsage) { this.usage = usage; }
  writeBreaker(breaker: BreakerState) { this.breaker = breaker; }
  readTile(key: string) { return this.tiles.get(key) ?? null; }
  writeTile(key: string, fetchedAt: number, bytes: Uint8Array) { this.tiles.set(key, { fetchedAt, bytes }); }
  pruneTiles(before: number) { for (const [key, tile] of this.tiles) if (tile.fetchedAt < before) this.tiles.delete(key); }
}

/** The subset of Durable Object SQLite storage the ledger uses (`ctx.storage.sql`). */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export class SqlLedgerStorage implements LedgerStorage {
  private readonly sql: SqlLike;

  constructor(sql: SqlLike) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS traffic_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS traffic_tiles (key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, bytes BLOB NOT NULL)");
  }

  private read<T>(k: string): T | null {
    const row = this.sql.exec("SELECT v FROM traffic_state WHERE k = ?", k).toArray()[0];
    if (!row) return null;
    try { return JSON.parse(String(row.v)) as T; } catch { return null; }
  }

  private write(k: string, value: unknown) {
    this.sql.exec("INSERT INTO traffic_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(value));
  }

  readState() { return { usage: this.read<TrafficUsage>("usage"), breaker: this.read<BreakerState>("breaker") ?? CLOSED_BREAKER }; }
  writeUsage(usage: TrafficUsage) { this.write("usage", usage); }
  writeBreaker(breaker: BreakerState) { this.write("breaker", breaker); }

  readTile(key: string) {
    const row = this.sql.exec("SELECT fetched_at, bytes FROM traffic_tiles WHERE key = ?", key).toArray()[0];
    if (!row) return null;
    const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : new Uint8Array(row.bytes as ArrayBufferLike);
    return { fetchedAt: Number(row.fetched_at), bytes };
  }

  writeTile(key: string, fetchedAt: number, bytes: Uint8Array) {
    this.sql.exec("INSERT INTO traffic_tiles (key, fetched_at, bytes) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, bytes = excluded.bytes", key, fetchedAt, bytes);
  }

  pruneTiles(before: number) { this.sql.exec("DELETE FROM traffic_tiles WHERE fetched_at < ?", before); }
}
