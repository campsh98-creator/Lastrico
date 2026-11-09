/**
 * Phase 4.33: route computation runs in a Durable Object.
 * - Why: on Workers Free an ordinary request may use 10 ms of CPU, and a Milan route or reroute
 *   often needs more: a first request in a fresh isolate takes 100–280 ms
 *   (outputs/phase433-milan-workers-free-reliability-report.md). A Durable Object request may use
 *   30 s of CPU and is available on the Free plan (SQLite-backed class).
 * - How: the object runs the same app router, so routes are identical.
 * - Shards: requests are spread over a few objects, because each object runs one computation at
 *   a time.
 * - Failure: the ordinary Worker never computes a route itself when the binding exists, because
 *   that is the CPU-limited path the object exists to avoid. A failed call is retried once on
 *   another shard only when Cloudflare marks the error retryable and not overloaded (for example
 *   the reset every deployment causes); otherwise the answer is an explicit, logged 503.
 * This module holds the routing decision and has no runtime dependencies, so it is tested in Node
 * (tests/phase433-route-engine.test.mjs).
 */
export const ROUTE_ENGINE_SHARDS = 8;

/** Header set on responses computed in the Durable Object, so a production check can confirm it. */
export const ROUTE_ENGINE_HEADER = "x-lastrico-route-engine";

/** Shown by the planner when no route-engine object can answer (it reads the `error` field). */
export const ROUTE_ENGINE_UNAVAILABLE_MESSAGE =
  "Il calcolo dei percorsi non è disponibile in questo momento. Riprova tra qualche minuto.";

/** True for the requests the Durable Object computes: route planning and navigation reroutes. */
export function isRouteComputation(request: Request): boolean {
  return request.method === "GET" && new URL(request.url).pathname === "/api/routes";
}

/** Cloudflare's advice for Durable Object errors: retry when retryable, but not when overloaded. */
function retryable(error: unknown): boolean {
  const flags = error as { retryable?: unknown; overloaded?: unknown } | null;
  return flags?.retryable === true && flags.overloaded !== true;
}

function log(event: string, error: unknown, attempt: number) {
  console.log(JSON.stringify({
    event,
    attempt,
    errorName: error instanceof Error ? error.name : "unknown",
    retryable: (error as { retryable?: unknown } | null)?.retryable === true,
    overloaded: (error as { overloaded?: unknown } | null)?.overloaded === true,
  }));
}

/** The explicit answer when no route-engine object can compute the route. No personal data. */
export function routeEngineUnavailableResponse(): Response {
  return new Response(JSON.stringify({ error: ROUTE_ENGINE_UNAVAILABLE_MESSAGE, code: "route_engine_unavailable" }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
      [ROUTE_ENGINE_HEADER]: "unavailable",
    },
  });
}

/**
 * Sends a route request to one of the route-engine objects.
 * - Returns null, so the Worker handles the request itself, only when it is not a route
 *   computation or the binding is absent (local tools that run without Durable Objects).
 * - Otherwise it always returns the object's response, or the 503 above.
 */
export async function viaRouteEngine(
  request: Request,
  namespace: DurableObjectNamespace | undefined,
  random: () => number = Math.random,
): Promise<Response | null> {
  if (!namespace || !isRouteComputation(request)) return null;
  const first = Math.min(ROUTE_ENGINE_SHARDS - 1, Math.floor(random() * ROUTE_ENGINE_SHARDS));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const shard = (first + attempt - 1) % ROUTE_ENGINE_SHARDS;
    try {
      // A request body can be read only once; route computations are GET requests and have none.
      return await namespace.get(namespace.idFromName(`routes-${shard}`)).fetch(new Request(request));
    } catch (error) {
      if (attempt === 1 && retryable(error)) {
        log("route_engine_retry", error, attempt);
        continue;
      }
      log("route_engine_unavailable", error, attempt);
      return routeEngineUnavailableResponse();
    }
  }
  return routeEngineUnavailableResponse();
}

/** Marks a response as computed in the route-engine object (no personal data). */
export function tagRouteEngineResponse(response: Response): Response {
  const tagged = new Response(response.body, response);
  tagged.headers.set(ROUTE_ENGINE_HEADER, "durable-object");
  return tagged;
}
