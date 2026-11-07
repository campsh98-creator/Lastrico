/** Phase 4.24 — Milan surface data-quality audit. Offline: archived OSM sources only.
 * Compares the legacy rules ("2026-10", the archive compiled on 2026-11-04) with the
 * corrected Phase 4.24 rules on the exact segment list the compiler uses.
 *   node --max-old-space-size=6144 scripts/osm/audit-milan-surfaces.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { collectMilanSegments } from "./compile-compact-tiles.mjs";

const root = new URL("../../", import.meta.url);
const out = new URL("outputs/phase424-data-quality/", root);
await mkdir(out, { recursive: true });
const CATS = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const MODES = ["car", "motorcycle", "bicycle"];
const km = (m) => Math.round(m / 10) / 100;
const empty = () => Object.fromEntries(CATS.map((c) => [c, 0]));
const way = (s) => `osm:way:${s.osmWayId}`;

const before = await collectMilanSegments({ surfaceRules: "2026-10" });
const after = await collectMilanSegments({ surfaceRules: "2026-11" });

function coverage(segments) {
  const network = { all: empty(), ...Object.fromEntries(MODES.map((m) => [m, empty()])) };
  for (const s of segments) {
    network.all[s.surfaceCategory] += s.lengthMeters;
    for (const m of MODES) if (s.modeAccess?.[m]) network[m][s.surfaceCategory] += s.lengthMeters;
  }
  return Object.fromEntries(Object.entries(network).map(([k, b]) => {
    const total = CATS.reduce((a, c) => a + b[c], 0);
    return [k, { totalKm: km(total), ...Object.fromEntries(CATS.map((c) => [`${c}Km`, km(b[c])])),
      knownPercent: Math.round(((total - b.unknown) / total) * 1000) / 10,
      confirmedEvidencePercent: Math.round(((b.confirmed_rough + b.confirmed_smooth + b.unpaved_loose) / total) * 1000) / 10 }];
  }));
}

// Per-segment transitions between rule sets (same geometry → same hash).
const afterByHash = new Map(after.allSegments.map((s) => [s.segmentHash, s]));
const transitions = new Map();
const changedWays = new Map();
for (const s of before.allSegments) {
  const a = afterByHash.get(s.segmentHash);
  const to = a ? a.surfaceCategory : "removed";
  if (to === s.surfaceCategory) continue;
  const reason = !a ? (after.removedBoundaryStubs.some((r) => r.segmentHash === s.segmentHash) ? "clipped pilot stub duplicated by the citywide snapshot" : "dropped by the expansion-ring filter once unknown")
    : a.rawTags?.tracktype === "grade1" && !a.rawTags?.surface ? "tracktype=grade1 is not asphalt evidence"
      : s.surfaceCategory === "probable_rough" ? "paving_stones with explicit smoothness excellent/good"
        : s.surfaceCategory === "confirmed_smooth" ? "asphalt/concrete with explicit smoothness bad or worse"
          : a.rawTags?.surface === "cobblestone:rounded" ? "cobblestone:rounded is cobblestone" : "other";
  const key = `${s.surfaceCategory}→${to}|${reason}`;
  const t = transitions.get(key) ?? { from: s.surfaceCategory, to, reason, segments: 0, meters: 0, ways: new Set(), ...Object.fromEntries(MODES.map((m) => [`${m}Meters`, 0])) };
  t.segments += 1; t.meters += s.lengthMeters; t.ways.add(s.osmWayId);
  for (const m of MODES) if (s.modeAccess?.[m]) t[`${m}Meters`] += s.lengthMeters;
  transitions.set(key, t);
  const w = changedWays.get(s.osmWayId) ?? { way: way(s), name: s.name, highway: s.highwayClass, from: s.surfaceCategory, to, reason,
    surface: s.rawTags?.surface ?? null, smoothness: s.rawTags?.smoothness ?? null, tracktype: s.rawTags?.tracktype ?? null, meters: 0,
    car: Boolean(s.modeAccess?.car), bicycle: Boolean(s.modeAccess?.bicycle) };
  w.meters += s.lengthMeters; changedWays.set(s.osmWayId, w);
}

// Retained but uncertain readings: documented, not changed (no explicit contradicting tag).
const tags = (s) => s.rawTags ?? {};
const RETAINED = [
  ["pebblestone kept as confirmed pavé (OSM: rounded pebbles, loose or set; Milan uses it for park paths and rizzada)", (s) => tags(s).surface === "pebblestone"],
  ["surface_bike used when surface is missing (non-standard key, Milan cycling mapping)", (s) => !tags(s).surface && tags(s).surface_bike],
  ["concrete:plates kept as smooth (jointed slabs; ride quality not verified)", (s) => tags(s).surface === "concrete:plates"],
  ["sett/cobblestone with smoothness excellent/good stays confirmed pavé (stone is never upgraded)", (s) => ["confirmed_rough"].includes(s.surfaceCategory) && ["excellent", "good"].includes(tags(s).smoothness)],
  ["paving_stones with smoothness bad or worse stays probable, not confirmed", (s) => s.surfaceCategory === "probable_rough" && ["bad", "very_bad", "horrible"].includes(tags(s).smoothness)],
  ["generic surface=paved stays unknown, also with smoothness", (s) => tags(s).surface === "paved"],
  ["missing surface with only a smoothness tag stays unknown", (s) => !tags(s).surface && !tags(s).surface_bike && tags(s).smoothness],
  ["unsupported values (wood, metal, stone, linoleum, rock…) stay unknown", (s) => s.surface?.value === "other"],
];
const retained = RETAINED.map(([rule, f]) => {
  const segs = after.allSegments.filter(f);
  const m = (pred) => km(segs.filter(pred).reduce((a, s) => a + s.lengthMeters, 0));
  return { rule, ways: new Set(segs.map((s) => s.osmWayId)).size, km: m(() => true), carKm: m((s) => s.modeAccess?.car), bicycleKm: m((s) => s.modeAccess?.bicycle) };
});

// Raw surface values and their category under the corrected rules.
const values = new Map();
for (const s of after.allSegments) {
  const k = `${tags(s).surface ?? (tags(s).surface_bike ? `surface_bike=${tags(s).surface_bike}` : "(none)")}|${s.surfaceCategory}`;
  values.set(k, (values.get(k) ?? 0) + s.lengthMeters);
}

// Unknown share of the car network by class: where independent verification adds most value.
const unknownByClass = new Map();
for (const s of after.allSegments) {
  if (!s.modeAccess?.car) continue;
  const e = unknownByClass.get(s.highwayClass) ?? { highway: s.highwayClass, totalKm: 0, unknownKm: 0 };
  e.totalKm += s.lengthMeters / 1000; if (s.surfaceCategory === "unknown") e.unknownKm += s.lengthMeters / 1000;
  unknownByClass.set(s.highwayClass, e);
}

const report = {
  generatedAt: new Date().toISOString(),
  sources: "data/surfaces/milan-central.json (OSM API 2026-10-28), data/milan-road-network-representative.json, data/sources/milan-citywide-*.osm.json.gz (Overpass 2026-11-04); ODbL © OpenStreetMap contributors",
  segments: { before: before.allSegments.length, after: after.allSegments.length },
  coverage: { before: coverage(before.allSegments), after: coverage(after.allSegments) },
  transitions: [...transitions.values()].map((t) => ({ ...t, ways: t.ways.size, km: km(t.meters), carKm: km(t.carMeters), motorcycleKm: km(t.motorcycleMeters), bicycleKm: km(t.bicycleMeters), meters: undefined, carMeters: undefined, motorcycleMeters: undefined, bicycleMeters: undefined })),
  retainedUncertain: retained,
  rawSurfaceValues: [...values].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k.split("|")[0], category: k.split("|")[1], km: km(v) })),
  carUnknownByClass: [...unknownByClass.values()].sort((a, b) => b.unknownKm - a.unknownKm).map((e) => ({ ...e, totalKm: Math.round(e.totalKm * 100) / 100, unknownKm: Math.round(e.unknownKm * 100) / 100, unknownPercent: Math.round((e.unknownKm / e.totalKm) * 1000) / 10 })),
};
await writeFile(new URL("audit.json", out), JSON.stringify(report, null, 2) + "\n");
const rows = [...changedWays.values()].sort((a, b) => b.meters - a.meters);
const csv = ["way,name,highway,from,to,reason,surface,smoothness,tracktype,meters,car,bicycle",
  ...rows.map((w) => [w.way, w.name ?? "", w.highway, w.from, w.to, w.reason, w.surface ?? "", w.smoothness ?? "", w.tracktype ?? "", Math.round(w.meters), w.car, w.bicycle]
    .map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))].join("\n") + "\n";
await writeFile(new URL("changed-ways.csv", out), csv);
console.log(JSON.stringify({ segments: report.segments, transitions: report.transitions.map((t) => `${t.from}→${t.to} ${t.km} km (${t.ways} ways): ${t.reason}`),
  coverageCarBefore: report.coverage.before.car.knownPercent, coverageCarAfter: report.coverage.after.car.knownPercent }, null, 1));
