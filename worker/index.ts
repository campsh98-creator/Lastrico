/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { tagRouteEngineResponse, viaRouteEngine } from "./route-engine";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  /** Phase 4.33: optional; without the binding, routes are computed in this Worker as before. */
  ROUTE_ENGINE?: DurableObjectNamespace;
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

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
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

    // Phase 4.33: route planning and reroutes are computed in a Durable Object (see route-engine.ts).
    const routed = await viaRouteEngine(request, env.ROUTE_ENGINE);
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
