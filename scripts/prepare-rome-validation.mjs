/** Derive route endpoints from actual named OSM way vertices, not invented POIs. */
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { extractHighways } from "./osm/build-representative-network.mjs";
import { geographicDistance } from "./osm/validate.mjs";

const root = new URL("../", import.meta.url);
const manifestPath = "data/sources/rome-osm.source.json";
const manifestBytes = await readFile(new URL(manifestPath, root));
const manifest = JSON.parse(manifestBytes);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const responses = [];
for (const source of manifest.sources) {
  const raw = gunzipSync(await readFile(new URL(`data/sources/${source.file}`, root)));
  if (sha(raw) !== source.sha256) throw new Error(`Checksum mismatch ${source.file}`);
  const data = JSON.parse(raw);
  responses.push({ ...data, generator: "openstreetmap-overpass-adapter" });
}
const ways = extractHighways(responses).filter(w => w.tags.area !== "yes");
const specifications = [
  ["corso", "Via del Corso", 12.478, 41.908], ["ripetta", "Via di Ripetta", 12.475, 41.909],
  ["nazionale", "Via Nazionale", 12.492, 41.9], ["cavour", "Via Cavour", 12.493, 41.895],
  ["termini", "Via Giovanni Giolitti", 12.504, 41.898], ["merulana", "Via Merulana", 12.5, 41.891],
  ["sangiovanni", "Piazza di San Giovanni in Laterano", 12.506, 41.886],
  ["prati", "Via Cola di Rienzo", 12.465, 41.908], ["vaticano", "Via della Conciliazione", 12.461, 41.902],
  ["giuliocesare", "Viale Giulio Cesare", 12.457, 41.913],
  ["trastevere", "Viale di Trastevere", 12.47, 41.88], ["lungaretta", "Via della Lungaretta", 12.473, 41.889],
  ["testaccio", "Via Marmorata", 12.478, 41.878], ["ostiense", "Via Ostiense", 12.479, 41.867],
  ["garbatella", "Via delle Sette Chiese", 12.487, 41.858], ["eur", "Viale Europa", 12.47, 41.831],
  ["colombo", "Via Cristoforo Colombo", 12.477, 41.82], ["flaminia", "Via Flaminia", 12.473, 41.946],
  ["nomentana", "Via Nomentana", 12.539, 41.934], ["tuscolana", "Via Tuscolana", 12.568, 41.858],
  ["aurelia", "Via Aurelia", 12.415, 41.897], ["portuense", "Via Portuense", 12.435, 41.853],
  ["laurentina", "Via Laurentina", 12.48, 41.804], ["prenestina", "Via Prenestina", 12.59, 41.89],
  ["salaria", "Via Salaria", 12.506, 41.962],
];
const anchors = {};
for (const [id, name, lon, lat] of specifications) {
  const matches = ways.filter(w => w.tags.name?.toLocaleLowerCase("it") === name.toLocaleLowerCase("it"));
  const vertices = matches.flatMap(w => w.coordinates.map(coordinate => ({ coordinate, osmWayId: w.id, name: w.tags.name,
    surface: w.tags.surface ?? null, highway: w.tags.highway, access: w.tags.access ?? null,
    distanceFromSearchHintMeters: geographicDistance([lon, lat], coordinate) })));
  vertices.sort((a, b) => a.distanceFromSearchHintMeters - b.distanceFromSearchHintMeters || a.osmWayId - b.osmWayId);
  if (!vertices[0] || vertices[0].distanceFromSearchHintMeters > 2000) throw new Error(`No authentic nearby anchor: ${name}`);
  anchors[id] = { ...vertices[0], source: `https://www.openstreetmap.org/way/${vertices[0].osmWayId}` };
}
const pairs = [
  ["corso", "cavour", "Centro storico / Monti; ZTL"], ["ripetta", "nazionale", "Tridente A1 / Centro; ZTL"],
  ["prati", "vaticano", "Prati / Vaticano short"], ["giuliocesare", "termini", "Prati / Termini medium"],
  ["lungaretta", "testaccio", "Trastevere / Testaccio; ZTL"], ["trastevere", "garbatella", "Southern mixed urban"],
  ["termini", "sangiovanni", "Esquilino / San Giovanni"], ["merulana", "cavour", "Monti short mixed stone"],
  ["ostiense", "eur", "Ostiense / EUR medium"], ["garbatella", "colombo", "Garbatella / EUR"],
  ["flaminia", "ripetta", "Northern corridor / Tridente"], ["nomentana", "termini", "Northeastern corridor"],
  ["tuscolana", "sangiovanni", "Southeastern corridor"], ["aurelia", "vaticano", "Western boundary corridor"],
  ["portuense", "testaccio", "Southwestern corridor"], ["laurentina", "eur", "Southern dataset boundary"],
  ["prenestina", "termini", "Eastern dataset boundary"], ["salaria", "nazionale", "Northern dataset boundary"],
  ["eur", "prati", "Long cross-city route"], ["aurelia", "tuscolana", "Long west-east route"],
];
const routes = pairs.map(([startId, endId, coverage]) => ({ id: `${startId}-${endId}`, startId, endId, coverage,
  start: anchors[startId].coordinate, end: anchors[endId].coordinate }));
const result = { provenance: "Exact vertices of named highway ways from checksum-verified archived OpenStreetMap responses; not POI entrances or legality guarantees.",
  manifestPath, manifestSha256: sha(manifestBytes), anchors, routes, reroute: { start: anchors.merulana.coordinate } };
await writeFile(new URL("tests/fixtures/phase423-rome-journeys.json", root), JSON.stringify(result, null, 2) + "\n");
console.log(`Prepared ${routes.length} journeys × 3 modes from ${Object.keys(anchors).length} authentic named-road anchors`);
