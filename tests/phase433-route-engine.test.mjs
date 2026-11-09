import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ROUTE_ENGINE_HEADER, ROUTE_ENGINE_SHARDS, isRouteComputation, tagRouteEngineResponse, viaRouteEngine } from "../worker/route-engine.ts";

/** Phase 4.33: route computation moves to a Durable Object; everything else stays in the Worker. */
const root = new URL("../", import.meta.url);
const namespace = (behaviour) => {
  const calls = [];
  return {
    calls,
    idFromName: (name) => ({ name, toString: () => name }),
    get: (id) => ({
      fetch: async (request) => {
        calls.push({ shard: id.name, url: request.url });
        if (behaviour === "throw") throw new Error("Durable Object quota exceeded");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
  };
};
const routeRequest = (query = "area=milan&start=9.2,45.46&end=9.17,45.43&mode=car") => new Request(`https://pilot.example/api/routes?${query}`);

test("route planning and reroutes go to a route-engine shard; nothing else does", async () => {
  const ns = namespace("ok");
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

test("without the binding, or when the object fails, the Worker computes the route itself and logs it", async () => {
  assert.equal(await viaRouteEngine(routeRequest(), undefined), null);
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(line);
  try {
    assert.equal(await viaRouteEngine(routeRequest(), namespace("throw")), null);
  } finally {
    console.log = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ event: "route_engine_unavailable", errorName: "Error" }]);
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
