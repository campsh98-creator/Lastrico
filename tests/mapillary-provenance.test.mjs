import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

/**
 * Guard for the Mapillary rule of the audit reconciliation (21 November 2026): nothing derived from Mapillary enters production
 * road data. Imagery stays a human-review channel (outputs/street-imagery-evaluation.md). Two checks, both offline:
 *  1. no production source file refers to Mapillary at all (no API call, no token, no import of its detections);
 *  2. in the bundled Milan road data the only trace of Mapillary is the `mapillary` key that OpenStreetMap contributors put on a
 *     way (an image id kept as OSM's own tag, under the ODbL attribution of the data) — no field derived from imagery.
 */
const root = new URL("../", import.meta.url);

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) found.push(...await sourceFiles(`${path}/`));
    else if (/\.(ts|tsx|mjs|js|json|css)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("no production source refers to Mapillary", async () => {
  const offenders = [];
  for (const directory of ["lib/", "app/", "components/", "worker/"]) {
    for (const path of await sourceFiles(directory)) {
      if (/mapillary|graph\.mapillary\.com|tiles\.mapillary\.com|MLY\|/i.test(await readFile(new URL(path, root), "utf8"))) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, [], "Mapillary-derived data needs a provenance and licence review before any code may use it");
});

test("the bundled Milan road data carries Mapillary only as OpenStreetMap's own image-id tag", async () => {
  const text = await readFile(new URL("data/surfaces/milan-central.json", root), "utf8");
  const keys = new Set([...text.matchAll(/"([^"\n]*mapillary[^"\n]*)"\s*:/gi)].map((match) => match[1]));
  assert.deepEqual([...keys], ["mapillary"], "no other field mentions Mapillary");
  const values = [...text.matchAll(/"mapillary"\s*:\s*"([^"\n]*)"/g)].map((match) => match[1]);
  assert.ok(values.length > 0, "the OSM tag is present in the extract");
  assert.ok(values.every((value) => /^\d{6,20}$/.test(value)), "each value is a bare image id, never a classification");
  // The extract's own licence is the OSM one: attribution and ODbL are declared with the data.
  const manifest = JSON.parse(await readFile(new URL("data/surfaces/milan-central.manifest.json", root), "utf8"));
  assert.match(JSON.stringify(manifest), /ODbL-1\.0/);
  assert.match(JSON.stringify(manifest), /OpenStreetMap contributors/);
});
