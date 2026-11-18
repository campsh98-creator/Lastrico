// Phase 4.40: import index of the source-separated SIL layers (shadow mode).
//
// This committed default is EMPTY on purpose. The layers mix three licences (ODbL 1.0, CC BY 2.5 IT or 4.0, CC BY 4.0)
// and their distribution is not cleared, so no layer data is versioned in Git. The generator script generate-sil-layer-index.mjs
// copies a locally built layer set into the git-ignored data/surfaces/sil-layers/ and rewrites this file with one
// lazy `import()` per layer tile (like lib/milan-tile-index.ts). With this empty index the shadow adapter reports
// "unavailable" and routing is unaffected.

export type SilLayerLoader = () => Promise<{ default: unknown }>;

export type SilLayerIndex = {
  manifest: SilLayerLoader | null;
  tiles: Partial<Record<"osm" | "dbt" | "atm" | "assoc", Record<string, SilLayerLoader>>>;
};

export const silLayerIndex: SilLayerIndex = { manifest: null, tiles: {} };
