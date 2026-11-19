import type { TrafficUnavailableReason } from "./quota.ts";

/**
 * How application code reaches the traffic ledger (worker/traffic-hub.ts). The Worker entry registers its environment once;
 * without a registered environment (local Node tools, the unit tests unless they install a transport) traffic is simply
 * "no-binding" and every caller falls back to the routing provider's own times.
 */
export type TrafficKindName = "flow" | "incidents";

export type TrafficTileAnswer =
  | { ok: true; bytes: Uint8Array; fetchedAt: number; cached: boolean }
  | { ok: false; reason: TrafficUnavailableReason | "bad-request" };

export type TrafficStatusAnswer = {
  provider: "TomTom";
  configured: boolean;
  available: boolean;
  reason: TrafficUnavailableReason | "ok";
  remainingToday: number;
  remainingThisMonth: number;
};

export interface TrafficTransport {
  tile(kind: TrafficKindName, z: number, x: number, y: number, purpose: "route" | "overlay", signal?: AbortSignal): Promise<TrafficTileAnswer>;
  status(signal?: AbortSignal): Promise<TrafficStatusAnswer>;
}

type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

let installed: TrafficTransport | null = null;
let namespace: DurableObjectNamespaceLike | null = null;

/** Tests and local tools install a transport directly. */
export function setTrafficTransport(transport: TrafficTransport | null) {
  installed = transport;
}

/** The Worker entry and the Durable Object give their `ROUTE_ENGINE` binding here; the ledger is one named instance of it. */
export function registerTrafficNamespace(value: DurableObjectNamespaceLike | undefined) {
  namespace = value ?? null;
}

const LEDGER_NAME = "traffic-ledger";
const HUB = "https://traffic-hub.internal";

function ledger() {
  return namespace ? namespace.get(namespace.idFromName(LEDGER_NAME)) : null;
}

const durableTransport: TrafficTransport = {
  async tile(kind, z, x, y, purpose, signal) {
    const stub = ledger();
    if (!stub) return { ok: false, reason: "no-binding" };
    try {
      const response = await stub.fetch(new Request(`${HUB}/tile?kind=${kind}&z=${z}&x=${x}&y=${y}&purpose=${purpose}`, { signal }));
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { reason?: TrafficUnavailableReason | "bad-request" };
        return { ok: false, reason: body.reason ?? "provider-failing" };
      }
      return {
        ok: true,
        bytes: new Uint8Array(await response.arrayBuffer()),
        fetchedAt: Number(response.headers.get("x-traffic-fetched-at")) || Date.now(),
        cached: response.headers.get("x-traffic-cached") === "1",
      };
    } catch (error) {
      return { ok: false, reason: (error as Error)?.name === "AbortError" || (error as Error)?.name === "TimeoutError" ? "timeout" : "provider-failing" };
    }
  },
  async status(signal) {
    const stub = ledger();
    if (!stub) return { provider: "TomTom", configured: false, available: false, reason: "no-binding", remainingToday: 0, remainingThisMonth: 0 };
    try {
      const response = await stub.fetch(new Request(`${HUB}/status`, { signal }));
      return await response.json() as TrafficStatusAnswer;
    } catch {
      return { provider: "TomTom", configured: false, available: false, reason: "provider-failing", remainingToday: 0, remainingThisMonth: 0 };
    }
  },
};

/** The transport in use, or null when neither a test transport nor the Durable Object binding exists. */
export function trafficTransport(): TrafficTransport | null {
  return installed ?? (namespace ? durableTransport : null);
}
