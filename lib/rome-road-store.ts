// Loaded only for Rome requests; tile payloads retain per-corridor lazy loading.
import romeMeta from "../data/surfaces/rome-tiles/metadata.json" with { type: "json" };
import { romeTileLoaders } from "./rome-tile-index.ts";
import { SpatialRoadIntelligenceStore, type CompactTileMetadata } from "./spatial-road-store.ts";

export const romeSpatialRoadStore = new SpatialRoadIntelligenceStore(
  romeMeta as unknown as CompactTileMetadata, romeTileLoaders, "rome",
);
