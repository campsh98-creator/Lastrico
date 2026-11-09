import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ROUTE_ENGINE_HEADER, ROUTE_ENGINE_SHARDS, ROUTE_ENGINE_UNAVAILABLE_MESSAGE, isRouteComputation, tagRouteEngineResponse, viaRouteEngine,
} from "../worker/route-engine.ts";

/** Phase 4.33: route computation moves to a Durable Object; everything else stays in the Worker. */
const root = new URL("../", import.meta.url);
// `failures` are thrown by the first calls, in order; later calls answer 200.
const namespace = (failures = []) => {
  const calls = [];
  return {
    calls,
    idFromName: (name) => ({ name, toString: () => name }),
    get: (id) => ({
      fetch: async (request) => {
        calls.push({ shard: id.name, url: request.url });
        const failure = failures[calls.length - 1];
        if (failure) throw failure;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
  };
};
const cloudflareError = (message, flags = {}) => Object.assign(new Error(message), flags);
async function capturingLogs(run) {
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(JSON.parse(line));
  try {
    return { result: await run(), logged };
  } finally {
    console.log = original;
  }
}
const routeRequest = (query = "area=milan&start=9.2,45.46&end=9.17,45.43&mode=car") => new Request(`https://pilot.example/api/routes?${query}`);

test("route planning and reroutes go to a route-engine shard; nothing else does", async () => {
  const ns = namespace();
  for (const request of [
    new Request("https://pilot.example/"),
    new Request("https://pilot.example/api/geocode?q=Duomo"),
    new Request("https://pilot.example/api/reports", { method: "POST", body: "{}" }),
    new Request("https://pilot.example/api/routes", { method: "POST", body: "{}" }),
  ]) {
    assert.equal(isRouteComputation(request), false, request.url);
    assert.equal(await viaRouteEngine(request, ns), null, request.url);
  }
  assert.equal(ns.calls.length, 0);
  const response = await viaRouteEngine(routeRequest("area=milan&start=1,2&end=3,4&mode=bicycle&navigation=1"), ns, () => 0.999);
  assert.equal(response.status, 200);
  assert.deepEqual(ns.calls.map((call) => call.shard), [`routes-${ROUTE_ENGINE_SHARDS - 1}`]);
  assert.match(ns.calls[0].url, /navigation=1/, "the request reaches the object unchanged");
  await viaRouteEngine(routeRequest(), ns, () => 0);
  assert.equal(ns.calls.at(-1).shard, "routes-0");
});

test("without the binding (local tools only) the Worker handles the route itself", async () => {
  assert.equal(await viaRouteEngine(routeRequest(), undefined), null);
});

test("when the object fails, the Worker answers an explicit, logged 503 and never computes the route", async () => {
  for (const failure of [
    cloudflareError("Exceeded allowed volume of requests in Durable Objects free tier."),
    cloudflareError("Durable Object is overloaded.", { retryable: true, overloaded: true }),
  ]) {
    const ns = namespace([failure]);
    const { result, logged } = await capturingLogs(() => viaRouteEngine(routeRequest(), ns, () => 0));
    assert.equal(result.status, 503, failure.message);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("retry-after"), "60");
    assert.equal(result.headers.get(ROUTE_ENGINE_HEADER), "unavailable");
    assert.deepEqual(await result.json(), { error: ROUTE_ENGINE_UNAVAILABLE_MESSAGE, code: "route_engine_unavailable" });
    assert.equal(ns.calls.length, 1, "no retry unless retryable and not overloaded");
    assert.deepEqual(logged, [{
      event: "route_engine_unavailable", attempt: 1, errorName: "Error",
      retryable: failure.retryable === true, overloaded: failure.overloaded === true,
    }]);
  }
});

test("a retryable error (as after a deployment) is retried once on the next shard, and logged", async () => {
  const reset = cloudflareError("Durable Object reset because its code was updated.", { retryable: true });
  const recovered = namespace([reset]);
  const first = await capturingLogs(() => viaRouteEngine(routeRequest(), recovered, () => 0.999));
  assert.equal(first.result.status, 200);
  assert.deepEqual(recovered.calls.map((call) => call.shard), [`routes-${ROUTE_ENGINE_SHARDS - 1}`, "routes-0"]);
  assert.deepEqual(first.logged.map((line) => line.event), ["route_engine_retry"]);

  const failedTwice = namespace([reset, reset]);
  const second = await capturingLogs(() => viaRouteEngine(routeRequest(), failedTwice, () => 0));
  assert.equal(second.result.status, 503);
  assert.equal(failedTwice.calls.length, 2, "one retry at most");
  assert.deepEqual(second.logged.map((line) => [line.event, line.attempt]), [["route_engine_retry", 1], ["route_engine_unavailable", 2]]);
});

test("the Worker sends route computations to the object before anything else, and has no other route path", async () => {
  const worker = await read("worker/index.ts");
  const fetchBody = worker.slice(worker.indexOf("const worker = {"));
  assert.ok(fetchBody.indexOf("viaRouteEngine(request, env.ROUTE_ENGINE)") < fetchBody.indexOf("handler.fetch(request, env, ctx)"));
  assert.match(fetchBody, /if \(routed\) return routed;/);
});

test("responses from the object keep status, body and headers, and say where they were computed", async () => {
  const original = new Response('{"error":"x"}', { status: 422, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const tagged = tagRouteEngineResponse(original);
  assert.equal(tagged.status, 422);
  assert.equal(tagged.headers.get("cache-control"), "no-store");
  assert.equal(tagged.headers.get(ROUTE_ENGINE_HEADER), "durable-object");
  assert.equal(await tagged.text(), '{"error":"x"}');
});

test("the build declares a SQLite-backed route-engine class (the only kind Workers Free allows) and exports it", async () => {
  const [vite, worker] = await Promise.all([read("vite.config.ts"), read("worker/index.ts")]);
  assert.match(vite, /bindings: \[\{ name: "ROUTE_ENGINE", class_name: "RouteEngine" \}\]/);
  assert.match(vite, /new_sqlite_classes: \["RouteEngine"\]/);
  assert.doesNotMatch(vite, /new_classes:/, "a key-value Durable Object class is not available on Workers Free");
  assert.match(worker, /export class RouteEngine/);
});

function read(path) {
  return readFile(new URL(path, root), "utf8");
}
