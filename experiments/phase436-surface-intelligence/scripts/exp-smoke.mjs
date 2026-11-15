import { readFile } from "node:fs/promises";
import { ROOT, loadPatchedHandler, ProviderStub, runCase } from "./exp-harness.mjs";
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", ROOT), "utf8"));
const { GET } = await loadPatchedHandler([], "smoke");
const stub = new ProviderStub();
for (const id of ["abbiategrasso-colonne", "moscova-crocetta", "cadorna-cinque-giornate"]) {
  const j = fixture.journeys.find((x) => x.id === id);
  for (const mode of ["car", "bicycle"]) {
    const r = await runCase(GET, stub, { area: "milan", start: j.start.join(","), end: j.end.join(","), mode, avoid: "strong", departure: "2026-11-09T12:00" });
    const p = r.payload;
    console.log(id, mode, r.status, p.antiPave?.status, p.fast && [p.fast.paveMeters, p.fast.confirmedPaveMeters, Math.round(p.fast.minutes * 60)], p.safe && [p.safe.paveMeters, p.safe.confirmedPaveMeters, Math.round(p.safe.minutes * 60)], "calls", r.calls.map((c) => c.kind + ":" + c.hit).join(","), r.computeMs + "ms", "pool", r.captured?.scored.length);
  }
}
