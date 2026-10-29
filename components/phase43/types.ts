import type { NavigationDiagnostics } from "@/lib/navigation-state";

export type TransportMode = "car" | "motorcycle" | "bicycle";

export type ComparableRoute = {
  label?: string;
  distance: number;
  minutes: number;
  paveMeters: number;
  smoothSurfaceMeters?: number;
  unknownSurfaceMeters?: number;
  unpavedSurfaceMeters?: number;
  surfaceTotalMeters?: number;
  surfaceSource?: "osm" | "demo";
  instructionsCount?: number;
};

export type RouteComparisonProps = {
  fastRoute: ComparableRoute;
  safeRoute: ComparableRoute;
  hasDistinctAlternative: boolean;
  activeRoute: "fast" | "safe";
  onSelectRoute?: (route: "fast" | "safe") => void;
  transportMode: TransportMode;
  extraTimeBudgetMinutes?: number | null;
  className?: string;
};

export type FieldFeedbackCategory = "surface" | "navigation";

export type FieldFeedbackKind =
  | "unmapped_pave"
  | "false_pave_smooth"
  | "hazardous_surface"
  | "incorrect_maneuver"
  | "road_closure"
  | "gps_drift"
  | "other";

export type FieldFeedbackItem = {
  id: string;
  timestamp: number;
  category: FieldFeedbackCategory;
  kind: FieldFeedbackKind;
  transportMode: TransportMode;
  coordinate?: [number, number];
  note: string;
  areaId?: string;
  predictedSurfaceCategory?: string;
  routeSummary?: {
    from?: string;
    to?: string;
    activeRoute?: "fast" | "safe";
    distanceKm?: number;
    minutes?: number;
  };
};

export type LocalFieldFeedbackProps = {
  isOpen: boolean;
  onClose: () => void;
  coordinate?: [number, number] | null;
  transportMode: TransportMode;
  areaId?: string;
  activeRoute?: "fast" | "safe";
  predictedSurfaceCategory?: string;
  routeSummary?: {
    from?: string;
    to?: string;
    distanceKm?: number;
    minutes?: number;
  };
  onFeedbackSaved?: (item: FieldFeedbackItem) => void;
  className?: string;
};

export type NavigationDiagnosticsCardProps = {
  diagnostics: NavigationDiagnostics;
  gpsState: string;
  journeyMode: "gps" | "simulation" | null;
  isOnline?: boolean;
  onResetDiagnostics?: () => void;
  className?: string;
};
