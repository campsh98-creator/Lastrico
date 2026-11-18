/** The one place the map library is imported on demand: every page shares the same chunk, so the build has a single graph for it. */
export const loadMapLibre = () => import("maplibre-gl");
