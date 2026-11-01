import { normalizeOsmFeature } from "../../scripts/osm/normalize.mjs";
import { createRoadIntelligenceIndex } from "../../lib/road-intelligence-scoring.ts";
import { createPaveSpatialIndex, spatialRoadStore } from "../../lib/spatial-road-store.ts";

/** Wraps a store lookup so synthetic OSM ways are scored alongside the bundled tiles. */
export function scopedWithWays(lookup, ways) {
  const fixtureSegments = ways.flatMap((way) =>
    normalizeOsmFeature(way, { ingestedAt: "2026-01-01T00:00:00.000Z" }).segments);
  return (coordinates, paddingMeters) => {
    const base = lookup(coordinates, paddingMeters);
    const roads = [...base.roads, ...fixtureSegments];
    const paveDetails = roads
      .filter((road) => road.osmWayId !== null
        && (road.surfaceCategory === "confirmed_rough" || road.surfaceCategory === "probable_rough"))
      .map((road) => ({
        id: road.osmWayId,
        name: road.name ?? "Strada senza nome",
        surface: road.surface.value ?? "unknown",
        coordinates: road.coordinates,
      }));
    return {
      roads,
      paveDetails,
      surfaceIndex: createRoadIntelligenceIndex(roads),
      paveIndex: createPaveSpatialIndex(paveDetails),
    };
  };
}

const activeLookups = new WeakMap();

/** The handler shares this store instance with the test, so no production seam is needed.
 * Node restores nested mocks of one method in creation order, which would leak fixtures into
 * later tests, so repeated calls in a test replace the ways instead of mocking again. */
export function mockRoadWays(t, ways, store = spatialRoadStore) {
  const active = activeLookups.get(t);
  if (active) {
    active.lookup = scopedWithWays(active.original, ways);
    return;
  }
  const original = store.getScopedIntelligence.bind(store);
  const state = { original, lookup: scopedWithWays(original, ways) };
  activeLookups.set(t, state);
  t.mock.method(store, "getScopedIntelligence", (coordinates, paddingMeters) => state.lookup(coordinates, paddingMeters));
}
