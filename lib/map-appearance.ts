/** How the basemap looks and where the camera frames it, given the panels floating over it. */
import type { Map as MapLibreMap } from "maplibre-gl";

type TextPaint = { color: unknown; halo: unknown };
const originalTextPaint = new WeakMap<MapLibreMap, Map<string, TextPaint>>();

function labelLayers(map: MapLibreMap) {
  return (map.getStyle()?.layers ?? []).filter((layer) =>
    layer.type === "symbol" && map.getLayoutProperty(layer.id, "text-field") !== undefined);
}

/**
 * Some symbols, such as one-way arrows, sit below the buildings. Anything meant to cover the map
 * must go above its last drawn area and line, or the buildings stay undimmed.
 */
export function firstLabelLayerAboveMap(map: MapLibreMap) {
  const layers = map.getStyle()?.layers ?? [];
  let lastDrawn = -1;
  layers.forEach((layer, index) => {
    if (layer.type !== "symbol") lastDrawn = index;
  });
  return layers[lastDrawn + 1]?.id;
}

export function hideBuildingExtrusions(map: MapLibreMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", "none");
  }
}

/** Dims the map under its labels and turns the labels light, instead of a grey wash over everything. */
export function applyMapTheme(map: MapLibreMap, theme: "light" | "dark") {
  if (!map.getLayer("theme-overlay")) return;
  map.setPaintProperty("theme-overlay", "fill-opacity", theme === "dark" ? 0.66 : 0);
  let originals = originalTextPaint.get(map);
  if (!originals) {
    originals = new Map();
    for (const layer of labelLayers(map)) {
      originals.set(layer.id, {
        color: map.getPaintProperty(layer.id, "text-color"),
        halo: map.getPaintProperty(layer.id, "text-halo-color"),
      });
    }
    originalTextPaint.set(map, originals);
  }
  for (const [id, paint] of originals) {
    map.setPaintProperty(id, "text-color", theme === "dark" ? "#d5e1de" : paint.color);
    map.setPaintProperty(id, "text-halo-color", theme === "dark" ? "#0b1315" : paint.halo);
  }
}

/** Points of interest compete with the route while driving. */
export function applyJourneyMapDetail(map: MapLibreMap, journeyActive: boolean) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith("poi")) {
      map.setLayoutProperty(layer.id, "visibility", journeyActive ? "none" : "visible");
    }
  }
}

/**
 * Space taken by elements marked `data-map-overlay`. A wide panel covers the top or the bottom
 * of the map, and a narrow one covers a side, which is how the layouts differ by device.
 * `data-map-overlay="top"` pins an element to the top edge whatever its width.
 */
export function visibleMapPadding(container: HTMLElement, margin = 28) {
  const box = container.getBoundingClientRect();
  const padding = { top: margin, right: margin, bottom: margin, left: margin };
  container.ownerDocument.querySelectorAll<HTMLElement>("[data-map-overlay]").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const edge = element.dataset.mapOverlay;
    if (edge === "top") {
      // Bars along the top stay there on every layout, even when they do not span the screen.
      padding.top = Math.max(padding.top, rect.bottom - box.top + margin);
    } else if (rect.width >= box.width * 0.7) {
      if (rect.top + rect.height / 2 < box.top + box.height / 2) {
        padding.top = Math.max(padding.top, rect.bottom - box.top + margin);
      } else {
        padding.bottom = Math.max(padding.bottom, box.bottom - rect.top + margin);
      }
    } else if (rect.left + rect.width / 2 < box.left + box.width / 2) {
      padding.left = Math.max(padding.left, rect.right - box.left + margin);
    } else {
      padding.right = Math.max(padding.right, box.right - rect.left + margin);
    }
  });
  // Very short screens could otherwise leave nothing for the map, and MapLibre rejects that.
  const scale = (first: "top" | "left", second: "bottom" | "right", size: number) => {
    const total = padding[first] + padding[second];
    const limit = size * 0.8;
    if (total > limit) {
      padding[first] *= limit / total;
      padding[second] *= limit / total;
    }
  };
  scale("top", "bottom", box.height);
  scale("left", "right", box.width);
  return padding;
}

/** Puts the vehicle in the lower part of the free map, so the road ahead is what you see. */
export function vehicleCameraPadding(container: HTMLElement) {
  const padding = visibleMapPadding(container, 12);
  const free = container.getBoundingClientRect().height - padding.top - padding.bottom;
  return { ...padding, top: padding.top + Math.max(0, free * 0.35) };
}
