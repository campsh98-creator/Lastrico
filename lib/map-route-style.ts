export type RouteVisualRole = "active" | "alternative";

export const ROUTE_LAYER_ORDER = [
  "fast-outline",
  "fast-line",
  "safe-outline",
  "safe-line",
] as const;

export const ROUTE_STYLE = {
  active: {
    color: "#00a878",
    width: 8,
    opacity: 1,
    outlineColor: "#ffffff",
    outlineWidth: 12,
    outlineOpacity: 0.96,
  },
  alternative: {
    color: "#64748b",
    width: 4,
    opacity: 0.38,
    outlineColor: "#ffffff",
    outlineWidth: 7,
    outlineOpacity: 0.58,
  },
} as const;

export function routePaint(role: RouteVisualRole) {
  const style = ROUTE_STYLE[role];
  return {
    line: {
      "line-color": style.color,
      "line-width": style.width,
      "line-opacity": style.opacity,
    },
    outline: {
      "line-color": style.outlineColor,
      "line-width": style.outlineWidth,
      "line-opacity": style.outlineOpacity,
    },
  };
}

