/**
 * Phase 4.33: route computation runs in a Durable Object.
 * - Why: on Workers Free an ordinary request may use 10 ms of CPU, and a Milan route or reroute
 *   often needs more: a first request in a fresh isolate takes 100–280 ms
 *   (outputs/phase433-milan-workers-free-reliability-report.md). A Durable Object request may use
 *   30 s of CPU and is available on the Free plan (SQLite-backed class).
 * - How: the object runs the same app router, so routes are identical.
 * - Shards: requests are spread over a few objects, because each object runs one computation at
 *   a time.
 * This module holds the routing decision and has no runtime dependencies, so it is tested in Node
 * (tests/phase433-route-engine.test.mjs).
 */
export const ROUTE_ENGINE_SHARDS = 8;

/** Header set on responses computed in the Durable Object, so a production check can confirm it. */
export const ROUTE_ENGINE_HEADER = "x-lastrico-route-engine";

/** True for the requests the Durable Object computes: route planning and navigation reroutes. */
export function isRouteComputation(request: Request): boolean {
  return request.method === "GET" && new URL(request.url).pathname === "/api/routes";
}

/**
 * Sends a route request to one of the route-engine objects. Returns null when the binding is
 * absent, the request is not a route computation, or the object is unavailable (for example once
 * the daily Free quota is used up). The caller then computes the route itself, as before Phase 4.33,
 * and the fallback is logged rather than hidden.
 */
export async function viaRouteEngine(
  request: Request,
  namespace: DurableObjectNamespace | undefined,
  random: () => number = Math.random,
): Promise<Response | null> {
  if (!namespace || !isRouteComputation(request)) return null;
  const shard = Math.min(ROUTE_ENGINE_SHARDS - 1, Math.floor(random() * ROUTE_ENGINE_SHARDS));
  try {
    return await namespace.get(namespace.idFromName(`routes-${shard}`)).fetch(request);
  } catch (error) {
    console.log(JSON.stringify({ event: "route_engine_unavailable", errorName: error instanceof Error ? error.name : "unknown" }));
    return null;
  }
}

/** Marks a response as computed in the route-engine object (no personal data). */
export function tagRouteEngineResponse(response: Response): Response {
  const tagged = new Response(response.body, response);
  tagged.headers.set(ROUTE_ENGINE_HEADER, "durable-object");
  return tagged;
}
