import type { NavigationDiagnostics } from "@/lib/navigation-state";

export type TransportMode = "car" | "motorcycle" | "bicycle";

export type ComparableRoute = {
  label?: string;
  distance: number;
  minutes: number;
  /** Known pavé: confirmed + probable metres. */
  paveMeters: number;
  /** Optional split of `paveMeters`; without it the panel only speaks of "pavé noto". */
  confirmedPaveMeters?: number;
  probablePaveMeters?: number;
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
  /** Phase 4.31: the server's anti-pavé outcome for this response. */
  antiPave?: import("@/lib/route-tradeoff").AntiPaveOutcome | null;
  className?: string;
};

export type FieldFeedbackCategory = "surface" | "navigation";

export type FieldFeedbackKind =
  | "unmapped_pave"
  | "false_pave_smooth"
  | "incorrect_pave_warning"
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
  /**
   * Phase 4.34: the rough section of the route the note refers to, as the app had it: where it
   * starts and ends, its OSM street and surface, its metres, and whether its warning was shown.
   * Attached only when the person keeps the position in the note.
   */
  roadSegment?: {
    start: [number, number];
    end: [number, number];
    startMeters: number;
    endMeters: number;
    confirmedMeters: number;
    probableMeters: number;
    name?: string;
    surface?: string;
    warningShown: boolean;
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
  /** Phase 4.34: the rough section near the current position, during navigation. */
  roughSection?: import("@/lib/rough-sections").RoughSection | null;
  wasWarningShown?: (sectionStartMeters: number) => boolean;
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
