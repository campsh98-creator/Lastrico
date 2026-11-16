/**
 * Phase 4.36 routing-experiments: extra generators probed directly on the two public-landmark replicas (1 request each, shared budget).
 *   P1 "shortest": costing_options.auto.shortest = true (quasi-shortest metric: the provider optimises distance instead of its cost model).
 * Responses are normalised with the production normaliser and saved for the replica evaluation (exp-run-replicas.mjs).
 */
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, OUT, CACHE, ProviderStub } from "./exp-harness.mjs";
const { normalizeValhallaResponse } = await import(new URL("lib/routing-providers.ts", ROOT).href);
const live = process.argv.includes("--live");
const SA0 = [9.2071562, 45.4507078], E1 = [9.1759083, 45.4437792];
const probes = [
  { id: "replica-return-heading", label: "P1 shortest", start: SA0, end: E1, heading: 121 },
  { id: "replica-outbound", label: "P1 shortest", start: E1, end: SA0 },
];
const stub = new ProviderStub({ allowLive: live, liveBudget: 25, logFile: new URL("live-request-log.json", OUT), stage: "probes" });
const out = JSON.parse(await readFile(new URL("probes.json", CACHE), "utf8").catch(() => "[]"));
for (const p of probes) {
  const locations = [{ lon: p.start[0], lat: p.start[1], type: "break", ...(p.heading ? { heading: p.heading } : {}) }, { lon: p.end[0], lat: p.end[1], type: "break" }];
  const body = { locations, costing: "auto", costing_options: { auto: { use_highways: 0.7, use_tolls: 0.2, shortest: true } }, units: "kilometers", directions_options: { units: "kilometers", language: "it-IT" }, alternates: 0 };
  stub.install(`${p.id} ${p.label}`);
  const res = await fetch("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Client-Id": "lastrico-milano", "User-Agent": "Lastrico/0.5.0 (+https://github.com/campsh98-creator/Lastrico)" }, body: JSON.stringify(body) });
  stub.uninstall();
  const text = await res.text();
  let routes = []; try { routes = normalizeValhallaResponse(JSON.parse(text), "car"); } catch { /* keep [] */ }
  const rec = { case: p.id, label: p.label, status: res.status, call: stub.calls.at(-1)?.hit, routes: routes.map((r) => ({ seconds: Math.round(r.duration), meters: Math.round(r.distance), coordinates: r.coordinates, uturns: r.instructions.filter((i) => i.direction === "uturn").length, maneuvers: r.instructions.length })) };
  console.log(p.id, p.label, res.status, stub.calls.at(-1)?.hit, rec.routes.map((r) => `${r.seconds}s/${r.meters}m/uturns ${r.uturns}`).join(" | "), res.status !== 200 ? text.slice(0, 160) : "");
  out.push(rec);
}
await writeFile(new URL("probes.json", CACHE), JSON.stringify(out));
