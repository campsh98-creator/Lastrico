/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { journeyRandom, tagRouteEngineResponse, viaRouteEngine } from "./route-engine";
import { SqlLedgerStorage, TRAFFIC_HUB_HOST, TrafficHub } from "./traffic-hub";
import { registerTrafficNamespace } from "../lib/traffic/client";
import { authorizeTrafficProbe } from "./traffic-auth.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /**
   * Phase 4.33: always present in the build (vite.config.ts). Only local tools that run without
   * Durable Objects lack it; then routes are computed in this Worker.
   */
  ROUTE_ENGINE?: DurableObjectNamespace;
  /** Optional secret: the live-traffic provider key (TomTom, free plan). Absent: live traffic is off and says so. */
  TOMTOM_API_KEY?: string;
  /** Preview recovery: refuse ordinary provider traffic; only a proven rotation may probe once. */
  TOMTOM_AUTH_PROBE_ONLY?: string;
  TOMTOM_AUTH_PROBE_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

/**
 * Phase 4.33: the Durable Object that computes routes (why and how in ./route-engine.ts). It runs
 * the same app router as this Worker, so a route computed here is the route computed there.
 */
export class RouteEngine {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private hub?: TrafficHub;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    registerTrafficNamespace(this.env.ROUTE_ENGINE);
    // The "traffic-ledger" instance is the only one that talks to the traffic provider (see traffic-hub.ts).
    if (new URL(request.url).hostname === TRAFFIC_HUB_HOST) {
      this.hub ??= new TrafficHub({
        storage: new SqlLedgerStorage(this.state.storage.sql),
        key: this.env.TOMTOM_API_KEY,
        probeOnly: this.env.TOMTOM_AUTH_PROBE_ONLY === "1",
        fetch: (input, init) => fetch(input, init),
      });
      return this.hub.handle(request);
    }
    const response = await handler.fetch(request, this.env, {
      waitUntil: (promise: Promise<unknown>) => this.state.waitUntil(promise),
      passThroughOnException() {},
    });
    return tagRouteEngineResponse(response);
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    registerTrafficNamespace(env.ROUTE_ENGINE);
    if (url.pathname === "/api/traffic/auth-probe") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (env.TOMTOM_AUTH_PROBE_ONLY !== "1" || !env.ROUTE_ENGINE
        || !await authorizeTrafficProbe(request, env.TOMTOM_AUTH_PROBE_TOKEN)) {
        return new Response(null, { status: 403, headers: { "cache-control": "no-store" } });
      }
      const ledger = env.ROUTE_ENGINE.get(env.ROUTE_ENGINE.idFromName("traffic-ledger"));
      return ledger.fetch(new Request(`https://${TRAFFIC_HUB_HOST}/auth-probe`, { method: "POST" }));
    }

    // Phase 4.33: route planning and reroutes are computed in a Durable Object, never here when the
    // binding exists; a failure is an explicit 503 (see route-engine.ts).
    const routed = await viaRouteEngine(request, env.ROUTE_ENGINE, journeyRandom(request));
    if (routed) return routed;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
