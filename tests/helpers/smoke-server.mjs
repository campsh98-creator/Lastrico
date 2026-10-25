// Local-only browser fixture server. Run the normal dev server on localhost:3000 first,
// then `node tests/helpers/smoke-server.mjs`; inspect http://localhost:3001.
// Geocoding/routing fixtures never contact public providers or persist reports.
import http from "node:http";
import { NextRequest } from "next/server.js";
import { loadApi, encodePolyline } from "./load-api.mjs";

const nativeFetch = globalThis.fetch;
const points = [[9.29, 45.53], [9.295, 45.53]];
const detour = [points[0], [9.29, 45.531], [9.295, 45.531], points[1]];
const trip = (coordinates, time) => ({
  status: 0, summary: { length: 0.6, time },
  legs: [{ shape: encodePolyline(coordinates), maneuvers: [
    { type: 1, instruction: "Parti sul percorso di prova", begin_shape_index: 0, length: 0.3 },
    { type: 10, instruction: "Svolta a destra", begin_shape_index: 1, length: 0.3 },
    { type: 4, instruction: "Arrivo al punto di prova", begin_shape_index: coordinates.length - 1, length: 0 },
  ] }],
});
globalThis.fetch = async (url, init) => {
  if (String(url).includes("valhalla1.openstreetmap.de/route")) {
    return Response.json({ trip: trip(points, 600), alternates: [{ trip: trip(detour, 750) }] });
  }
  if (String(url).includes("overpass-api.de")) {
    return Response.json({ elements: [{ id: 900000001, tags: { surface: "sett" }, geometry: points.map(([lon, lat]) => ({ lon, lat })) }] });
  }
  return nativeFetch(url, init);
};
const { GET } = await loadApi("app/api/routes/route.ts");
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost:3001");
    let response;
    if (url.pathname === "/api/routes") response = await GET(new NextRequest(url));
    else if (url.pathname === "/api/geocode") {
      const start = url.searchParams.get("q")?.toLowerCase().includes("partenza");
      const primary = start ? "Partenza test locale" : "Arrivo test locale";
      response = Response.json({ results: [{ id: start ? "1" : "2", primary, secondary: "Fixture · Milano", label: primary, coordinate: points[start ? 0 : 1], type: "test" }] });
    } else if (url.pathname.startsWith("/api/reports")) {
      response = req.method === "GET" ? Response.json({ reports: [], stats: { total: 0, pending: 0, verified: 0, communityMeters: 0 } }) : Response.json({ error: "Fixture: scrittura disabilitata" }, { status: 405 });
    } else {
      const headers = {};
      for (const name of ["accept", "sec-fetch-dest"]) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      response = await nativeFetch(new URL(req.url, "http://localhost:3000"), { headers });
    }
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(error));
  }
}).listen(3001, "localhost", () => process.stdout.write("Local fixture smoke server: http://localhost:3001\n"));
