/** Phase 4.25 — deterministic Milan origin–destination matrix for the anti-pavé benchmark.
 * Previously validated pairs keep their recorded coordinates. New anchors are snapped to the
 * nearest vertex of a named, car-accessible road in the production Milan archive, so every
 * endpoint lies on a real street. No network access.
 * The committed matrix was snapped against the archive compiled on 2026-11-04 (rules "2026-10"):
 * it is the fixed benchmark definition. This script only rewrites it with --write.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const tilesDir = new URL("data/surfaces/milan-tiles/", root);
const ROAD_CLASSES = new Set([4, 5, 6, 7, 8]); // primary, secondary, tertiary, unclassified, residential (HC_ENUM)
const vertices = [];
for (const file of (await readdir(tilesDir)).filter((f) => f !== "metadata.json")) {
  const { tuples } = JSON.parse(await readFile(new URL(file, tilesDir), "utf8"));
  for (const t of tuples) {
    const [, nameId, c, , , , , , maBits, hcId] = t;
    if (nameId < 0 || maBits < 0 || (maBits & 7) !== 7 || !ROAD_CLASSES.has(hcId)) continue;
    vertices.push([c[0], c[1]], [c[2], c[3]]);
  }
}
const failures = [];
function snap([lon, lat]) {
  let best = null, bestD = Infinity;
  const sx = 111_320 * Math.cos((lat * Math.PI) / 180);
  for (const v of vertices) {
    const d = Math.hypot((v[0] - lon) * sx, (v[1] - lat) * 110_540);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (bestD > 250) failures.push(`${lon},${lat}: ${Math.round(bestD)} m`);
  return { coordinate: [Number(best[0].toFixed(7)), Number(best[1].toFixed(7))], snapMeters: Math.round(bestD) };
}

// Approximate landmarks; coordinates are only seeds for the snap above.
const A = {
  duomo: [9.1900, 45.4642], cordusio: [9.1858, 45.4655], castello: [9.1785, 45.4705], brera: [9.1886, 45.4721],
  "san-babila": [9.1985, 45.4668], santambrogio: [9.1756, 45.4622], missori: [9.1887, 45.4607], colonne: [9.1813, 45.4580],
  cadorna: [9.1765, 45.4682], "porta-venezia": [9.2056, 45.4731], "cinque-giornate": [9.2075, 45.4625],
  "porta-romana": [9.2010, 45.4520], "xxiv-maggio": [9.1795, 45.4520], moscova: [9.1870, 45.4775],
  "porta-garibaldi": [9.1872, 45.4848], "arco-pace": [9.1726, 45.4757], cenacolo: [9.1708, 45.4659],
  "piazza-fontana": [9.1937, 45.4637], centrale: [9.2040, 45.4847], repubblica: [9.1975, 45.4800],
  "gae-aulenti": [9.1895, 45.4836], "porta-genova": [9.1700, 45.4530], crocetta: [9.1940, 45.4565],
  "via-torino": [9.1838, 45.4613], "corso-magenta": [9.1780, 45.4655], isola: [9.1895, 45.4890],
  nolo: [9.2210, 45.4910], "citta-studi": [9.2270, 45.4780], lambrate: [9.2370, 45.4840],
  "porta-vittoria": [9.2160, 45.4580], corvetto: [9.2240, 45.4400], rogoredo: [9.2390, 45.4335],
  "lodi-tibb": [9.2100, 45.4450], vigentino: [9.2030, 45.4360], abbiategrasso: [9.1800, 45.4300],
  famagosta: [9.1680, 45.4370], barona: [9.1560, 45.4350], "bande-nere": [9.1420, 45.4600],
  lorenteggio: [9.1350, 45.4530], "de-angeli": [9.1530, 45.4680], wagner: [9.1620, 45.4680],
  "san-siro": [9.1380, 45.4720], qt8: [9.1410, 45.4860], portello: [9.1530, 45.4810],
  monumentale: [9.1790, 45.4860], bovisa: [9.1620, 45.4990], dergano: [9.1780, 45.4990],
  maciachini: [9.1850, 45.4970], "ca-granda": [9.1930, 45.4990], greco: [9.2120, 45.4990],
  crescenzago: [9.2380, 45.4950], turro: [9.2240, 45.4980], ortica: [9.2380, 45.4700],
  forlanini: [9.2400, 45.4610], calvairate: [9.2250, 45.4570], "naviglio-pavese": [9.1760, 45.4420],
  tortona: [9.1650, 45.4540], sempione: [9.1650, 45.4780], piola: [9.2230, 45.4810],
  dateo: [9.2170, 45.4680], "buenos-aires": [9.2120, 45.4800], conciliazione: [9.1660, 45.4660],
  "sant-agostino": [9.1690, 45.4590], "corso-garibaldi": [9.1840, 45.4770], "via-manzoni": [9.1925, 45.4700],
  "corso-venezia": [9.2010, 45.4700], policlinico: [9.1960, 45.4600], bocconi: [9.1900, 45.4490],
};

// Pairs recorded by earlier phases (PILOT_JOURNEYS and the 2026-11-05 live corpus): exact coordinates.
const VALIDATED = [
  ["castello-porta-venezia", [9.1785, 45.4705], [9.2056, 45.4731]],
  ["duomo-porta-garibaldi", [9.19, 45.4642], [9.1872, 45.4848]],
  ["cordusio-porta-romana", [9.1858, 45.4655], [9.201, 45.452]],
  ["santambrogio-san-babila", [9.1756, 45.4622], [9.1985, 45.4668]],
  ["colonne-repubblica", [9.1813, 45.458], [9.1975, 45.48]],
  ["arco-pace-duomo", [9.1726, 45.4757], [9.19, 45.4642]],
  ["cenacolo-missori", [9.1708, 45.4659], [9.1887, 45.4607]],
  ["brera-darsena", [9.1886, 45.4721], [9.1771, 45.4523]],
  ["porta-venezia-xxiv-maggio", [9.2056, 45.4731], [9.1795, 45.452]],
  ["centrale-piazza-fontana", [9.204, 45.4847], [9.1937, 45.4637]],
  ["gae-aulenti-porta-romana", [9.1895, 45.4836], [9.1975, 45.456]],
  ["cadorna-cinque-giornate", [9.1765, 45.4682], [9.2075, 45.4625]],
  ["brera-santa-sofia", [9.1886, 45.4721], [9.1887, 45.4607]],
  ["cadorna-darsena", [9.1765, 45.4682], [9.1771, 45.4523]],
];
const NEW = [
  // central, short
  ["duomo", "brera"], ["cordusio", "moscova"], ["missori", "crocetta"], ["via-torino", "santambrogio"],
  ["corso-magenta", "cordusio"], ["piazza-fontana", "san-babila"], ["colonne", "porta-genova"],
  ["xxiv-maggio", "bocconi"], ["corso-garibaldi", "castello"], ["via-manzoni", "porta-venezia"],
  ["policlinico", "cinque-giornate"], ["cadorna", "conciliazione"], ["sant-agostino", "colonne"],
  ["corso-venezia", "repubblica"], ["brera", "corso-garibaldi"],
  // central, medium
  ["castello", "porta-romana"], ["porta-genova", "san-babila"], ["duomo", "isola"], ["moscova", "crocetta"],
  ["conciliazione", "piazza-fontana"], ["porta-garibaldi", "missori"], ["bocconi", "brera"],
  ["repubblica", "santambrogio"], ["monumentale", "duomo"], ["corso-magenta", "porta-venezia"],
  // periphery to centre
  ["citta-studi", "duomo"], ["lambrate", "cadorna"], ["corvetto", "duomo"], ["rogoredo", "porta-romana"],
  ["abbiategrasso", "colonne"], ["famagosta", "castello"], ["bande-nere", "duomo"], ["de-angeli", "san-babila"],
  ["qt8", "brera"], ["bovisa", "castello"], ["ca-granda", "repubblica"], ["greco", "centrale"],
  ["ortica", "porta-venezia"], ["forlanini", "cinque-giornate"], ["barona", "porta-genova"],
  ["lorenteggio", "santambrogio"], ["san-siro", "cadorna"], ["maciachini", "moscova"], ["nolo", "piazza-fontana"],
  ["dergano", "porta-garibaldi"],
  // periphery to periphery
  ["san-siro", "citta-studi"], ["bovisa", "lambrate"], ["famagosta", "corvetto"], ["qt8", "ca-granda"],
  ["bande-nere", "abbiategrasso"], ["de-angeli", "portello"], ["forlanini", "rogoredo"], ["greco", "lambrate"],
  ["ortica", "calvairate"], ["barona", "lodi-tibb"], ["lorenteggio", "famagosta"], ["turro", "citta-studi"],
  ["crescenzago", "nolo"], ["sempione", "portello"], ["tortona", "naviglio-pavese"], ["dateo", "piola"],
  ["buenos-aires", "dateo"], ["lodi-tibb", "vigentino"], ["wagner", "de-angeli"], ["calvairate", "porta-vittoria"],
  // cross-city, long
  ["san-siro", "forlanini"], ["bovisa", "rogoredo"], ["ca-granda", "famagosta"], ["lorenteggio", "lambrate"],
  ["qt8", "corvetto"], ["greco", "bocconi"],
];
// Outside the surface archive on purpose: the honest answer is mostly unknown surface.
const OUTSIDE = [
  ["bicocca-niguarda", [9.2115, 45.5135], [9.1935, 45.5105]],
  ["baggio-san-siro", [9.0930, 45.4620], [9.1240, 45.4780]],
  ["gratosoglio-abbiategrasso", [9.1750, 45.4130], [9.1800, 45.4300]],
];
const DUOMO = [9.19, 45.4642];
const meters = (a, b) => Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110_540);
const zone = (p) => (meters(p, DUOMO) <= 1_700 ? "centre" : "periphery");
const lengthClass = (d) => (d < 2_000 ? "short" : d <= 5_000 ? "medium" : "long");
const snapped = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, snap(v)]));
if (failures.length) throw new Error(`Anchors far from an archived road:\n${failures.join("\n")}`);
const journeys = [
  ...VALIDATED.map(([id, start, end]) => ({ id, origin: "previously-validated", start, end })),
  ...NEW.map(([a, b]) => ({ id: `${a}-${b}`, origin: "phase425", start: snapped[a].coordinate, end: snapped[b].coordinate,
    snapMeters: [snapped[a].snapMeters, snapped[b].snapMeters] })),
  ...OUTSIDE.map(([id, start, end]) => ({ id, origin: "outside-archive", start, end })),
].map((j) => {
  const crow = meters(j.start, j.end);
  return { ...j, straightLineMeters: Math.round(crow), lengthClass: lengthClass(crow),
    zones: `${zone(j.start)}-${zone(j.end)}` };
});
if (new Set(journeys.map((j) => j.id)).size !== journeys.length) throw new Error("Duplicate journey id");
// Stability: every third journey, both ends shifted by a fixed 18 m east / 12 m north (≈22 m),
// the size of a misplaced tap or a geocoder offset.
const SHIFT = { eastMeters: 18, northMeters: 12 };
const shift = ([lon, lat]) => [Number((lon + SHIFT.eastMeters / (111_320 * Math.cos((lat * Math.PI) / 180))).toFixed(7)),
  Number((lat + SHIFT.northMeters / 110_540).toFixed(7))];
const stability = journeys.filter((_, i) => i % 3 === 0).map((j) => ({ id: `${j.id}~shift`, baseId: j.id, start: shift(j.start), end: shift(j.end) }));
const out = { description: "Phase 4.25 Milan anti-pavé benchmark matrix (car, motorcycle, bicycle; avoid=strong, no time budget = app defaults)",
  generatedBy: "scripts/prepare-milan-benchmark.mjs", modes: ["car", "motorcycle", "bicycle"], request: { avoid: "strong" },
  shift: SHIFT, journeys, stability };
const target = new URL("tests/fixtures/phase425-milan-journeys.json", root);
if (process.argv.includes("--write")) await writeFile(target, JSON.stringify(out, null, 2) + "\n");
else console.log(`Dry run: ${JSON.stringify(out, null, 2) + "\n" === await readFile(target, "utf8").catch(() => "") ? "identical to" : "differs from"} the committed matrix (use --write to replace it).`);
const count = (k) => journeys.reduce((m, j) => ({ ...m, [j[k]]: (m[j[k]] ?? 0) + 1 }), {});
console.log({ journeys: journeys.length, stability: stability.length, byLength: count("lengthClass"), byZones: count("zones"),
  maxSnap: Math.max(...journeys.flatMap((j) => j.snapMeters ?? [0])) });
