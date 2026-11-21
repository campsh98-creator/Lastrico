import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./helpers/load-api.mjs";

// The real handler with a stubbed provider: what the reroute (navigation=1) request sends to Valhalla.
const START = [9.2, 45.452];
const END = [9.2, 45.4575];
const trip = () => Response.json({ trip: { status: 0, summary: { length: 0.61, time: 90 }, legs: [{
  shape: encodePolyline([START, [9.2, 45.455], END]),
  maneuvers: [
    { type: 1, instruction: "Parti", begin_shape_index: 0 },
    { type: 4, instruction: "Arrivo", begin_shape_index: 2 },
  ],
}] } });

function install(t, { rejectHeading = false } = {}) {
  let now = Date.now() + 100_000;
  t.mock.method(Date, "now", () => now);
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    now += 2_000;
    const body = init?.body ? JSON.parse(init.body) : null;
    if (!body?.locations) return new Response("{}", { status: 500 });
    sent.push(body);
    // A provider that finds no edge facing the requested direction answers with an error, as Valhalla does.
    if (rejectHeading && "heading" in body.locations[0]) return new Response(JSON.stringify({ error_code: 171 }), { status: 400 });
    return trip();
  });
  return sent;
}

function url(extra) {
  const params = new URLSearchParams({ start: START.join(","), end: END.join(","), mode: "bicycle", avoid: "balanced", ...extra });
  return `http://localhost/api/routes?${params}`;
}

test("a reroute passes the vehicle heading to the first point of every provider request", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const sent = install(t);
  const response = await GET(new NextRequest(url({ navigation: "1", heading: "311" })));
  assert.equal(response.status, 200);
  assert.ok(sent.length >= 1);
  for (const body of sent) {
    assert.equal(body.locations[0].heading, 311);
    assert.equal(body.locations[0].heading_tolerance, 60);
    assert.equal("heading" in body.locations.at(-1), false);
  }
});

test("the planner ignores a heading: its start is an address, not a moving vehicle", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const sent = install(t);
  const response = await GET(new NextRequest(url({ heading: "311" })));
  assert.equal(response.status, 200);
  for (const body of sent) assert.equal("heading" in body.locations[0], false);
});

test("a heading that is not a number is ignored and the request still answers", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const sent = install(t);
  for (const heading of ["abc", "", "NaN", "Infinity"]) {
    const response = await GET(new NextRequest(url({ navigation: "1", heading })));
    assert.equal(response.status, 200, `heading=${heading}`);
  }
  for (const body of sent) assert.equal("heading" in body.locations[0], false);
});

test("when no road faces the heading, one counted request without it still gives a route", async (t) => {
  const { GET } = await loadApi("app/api/routes/route.ts");
  const sent = install(t, { rejectHeading: true });
  const response = await GET(new NextRequest(url({ navigation: "1", heading: "311" })));
  assert.equal(response.status, 200);
  const withHeading = sent.filter((body) => "heading" in body.locations[0]).length;
  const without = sent.filter((body) => !("heading" in body.locations[0])).length;
  assert.ok(withHeading >= 1 && without >= 1, `with ${withHeading}, without ${without}`);
  assert.ok(sent.length <= 4, "the navigation cap of four provider requests holds");
  // Once the heading is dropped, no later request of the calculation sends it again.
  const firstWithout = sent.findIndex((body) => !("heading" in body.locations[0]));
  assert.ok(sent.slice(firstWithout).every((body) => !("heading" in body.locations[0])));
});
