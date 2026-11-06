"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, GeoJSONSource } from "maplibre-gl";
import {
  createNavigationDiagnostics,
  estimateArrivalTimestamp,
  evaluateGpsSignalStall,
  formatNavigationDiagnosticsSummary,
  recordNavigationDiagnosticEvent,
  shouldApplyRouteResponse,
  shouldBeginNavigation,
  shouldRunSimulationTimer,
  shouldUpdateNavigationCamera,
  type NavigationDiagnosticEvent,
  type NavigationDiagnostics,
  type NavigationJourneyMode,
} from "@/lib/navigation-state";
import { DirectionsSheet } from "@/components/navigation/DirectionsSheet";
import { CommunityPanel } from "@/components/reports/CommunityPanel";
import { SurfaceBreakdown } from "@/components/SurfaceBreakdown";
import "@/components/phase43/phase43.css";
import {
  RouteComparisonPanel,
  LocalFieldFeedback,
  NavigationDiagnosticsCard,
  GpsTraceControls,
} from "@/components/phase43";
import {
  PILOT_AREAS,
  coordinateInArea,
  isPilotAreaId,
  getPilotJourneys,
  type PilotAreaId,
  type PilotJourneyPreset,
} from "@/lib/pilot-areas";
import {
  type NavigationInstruction,
} from "@/lib/navigation-instructions";
import {
  reportKindMeta,
  type ReportKind,
  type ReportStats,
  type RoadReport,
} from "@/lib/reporting";
import { routePaint } from "@/lib/map-route-style";
import {
  parsePromptRoutePreferences,
  type PromptRoutePreferenceResult,
} from "@/lib/prompt-route-preferences";
import {
  isNavigableRouteGeometry,
  routePreferencesMatch,
  shouldApplyPlannerRouteResponse,
  type RoutePreferences,
} from "@/lib/route-request-state";
import {
  buildRouteProgressModel,
  calculateRouteProgress,
  type RouteProgressModel,
} from "@/lib/route-progress";
import { evaluateVoiceGuidance } from "@/lib/voice-guidance";
import {
  createGpsTraceRecorder,
  deleteGpsTrace,
  listGpsTraces,
  readGpsTrace,
  type TraceRecorderStatus,
  type TraceStorage,
  type TraceSummary,
} from "@/lib/gps-trace";
import {
  bearingBetween,
  createNavigationFixState,
  distanceMeters,
  NAVIGATION_POLICY,
  processGpsFix,
  rerouteCooldownMs,
  simulationProgressMeters,
  withReplacementRoute,
  type GpsFix,
} from "@/lib/navigation-fix-processor";
import {
  ADDRESS_SEARCH_TIMEOUT_MS,
  AddressChoiceNeeded,
  AUTOCOMPLETE_DEBOUNCE_MS,
  clearStoredPlan,
  CURRENT_POSITION_LABEL,
  isConfirmedAddressField,
  MIN_AUTOCOMPLETE_CHARS,
  MINIMUM_ROUTE_METERS,
  PlannerMessage,
  plannerErrorMessage,
  pluralize,
  readApiJson,
  readStoredPlan,
  REROUTE_TIMEOUT_MS,
  ROUTE_TIMEOUT_MS,
  setStoredPlanJourney,
  shouldApplyAutocompleteResponse,
  shouldAutoCalculateAfterAddressSelection,
  storePlan,
  updateStoredPlanSelection,
} from "@/lib/planner-support";
import {
  applyJourneyMapDetail,
  applyMapTheme,
  firstLabelLayerAboveMap,
  hideBuildingExtrusions,
  vehicleCameraPadding,
  visibleMapPadding,
} from "@/lib/map-appearance";
import { Dialog } from "@/components/ui/Dialog";
import { directionIcon, Icon, type IconName } from "@/components/ui/Icon";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinate = [number, number];
type Avoidance = "balanced" | "strong" | "maximum";
type TransportMode = "car" | "motorcycle" | "bicycle";
type ThemeMode = "auto" | "light" | "dark";
type PickingMode = "start" | "end" | "reportStart" | "reportEnd";
type JourneyMode = NavigationJourneyMode;
type GpsState = "idle" | "requesting" | "live" | "weak" | "offroute" | "recalculating" | "outside" | "temporarily-unavailable" | "unavailable";
type WakeLockHandle = { release: () => Promise<void>; released?: boolean };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> };
};

type RouteResult = {
  coordinates: Coordinate[];
  distance: number;
  minutes: number;
  paveMeters: number;
  pavePercent?: number;
  smoothSurfaceMeters?: number;
  surfaceTotalMeters?: number;
  unpavedSurfaceMeters?: number;
  surfaceSource?: "osm" | "demo";
  cyclewayMeters?: number;
  unknownSurfaceMeters?: number;
  surfaceCoveragePercent?: number;
  confirmedPaveMeters?: number;
  probablePaveMeters?: number;
  surfaceConfidence?: number;
  problemSegments?: Coordinate[][];
  instructions?: NavigationInstruction[];
};

type LocationChoice = {
  label: string;
  coordinate: Coordinate;
};

type GeocodeResult = LocationChoice & {
  id: string;
  primary: string;
  secondary: string;
  type: string;
};

type RouteApiResponse = {
  area?: PilotAreaId;
  fast: RouteResult;
  safe: RouteResult;
  problemSegments: Coordinate[][];
  alternativesAnalyzed: number;
  hasDistinctAlternative: boolean;
  surfaceDataAvailable: boolean;
  dataNotice: string;
  transportMode: TransportMode;
  appliedPreferences: {
    avoidance: Avoidance;
    maximumExtraMinutes: number | null;
  };
  routingProfile: {
    provider: string;
    profile: string;
    approximate: boolean;
    notice: string;
  };
};

const transportMeta: Record<TransportMode, { label: string; short: string; article: string; safety: string }> = {
  car: { label: "Auto", short: "AUTO", article: "l’auto", safety: "Non interagire con lo schermo durante la guida" },
  motorcycle: { label: "Moto", short: "MOTO", article: "la moto", safety: "Non interagire con lo schermo durante la guida" },
  bicycle: { label: "Bici", short: "BICI", article: "la bici", safety: "Fermati in sicurezza prima di usare lo schermo" },
};
const emptyRoute: RouteResult = { coordinates: [], distance: 0, minutes: 0, paveMeters: 0 };

function promptErrorCopy(result: PromptRoutePreferenceResult) {
  if (result.status === "empty") return "Scrivi come vuoi gestire pavé e tempo extra.";
  if (result.status === "conflict") return "La richiesta contiene preferenze in conflitto o più limiti di tempo.";
  if (result.status === "invalid") return "Usa un limite intero compreso tra 1 e 30 minuti.";
  return "Questa demo comprende solo pavé, priorità al percorso rapido e minuti extra.";
}

const emptyFeatureCollection = {
  type: "FeatureCollection" as const,
  features: [],
};

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";

function routeGeoJSON(result: RouteResult) {
  return {
    type: "FeatureCollection" as const,
    features: result.coordinates.length
      ? [{
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: result.coordinates },
        }]
      : [],
  };
}

function problemGeoJSON(results: RouteResult[]) {
  return {
    type: "FeatureCollection" as const,
    features: results.flatMap((result) =>
      (result.problemSegments ?? []).map((coordinates) => ({
        type: "Feature" as const,
        properties: { name: "Pavé rilevato", surface: "OSM" },
        geometry: { type: "LineString" as const, coordinates },
      })),
    ),
  };
}

function reportsGeoJSON(reports: RoadReport[]) {
  return {
    type: "FeatureCollection" as const,
    features: reports.map((report) => ({
      type: "Feature" as const,
      properties: {
        id: report.id,
        kind: report.kind,
        severity: report.severity,
        status: report.status,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: [report.start, report.end],
      },
    })),
  };
}

function draftGeoJSON(start: Coordinate | null, end: Coordinate | null) {
  return {
    type: "FeatureCollection" as const,
    features: [
      ...(start ? [{
        type: "Feature" as const,
        properties: { role: "start" },
        geometry: { type: "Point" as const, coordinates: start },
      }] : []),
      ...(start && end ? [{
        type: "Feature" as const,
        properties: { role: "segment" },
        geometry: { type: "LineString" as const, coordinates: [start, end] },
      }] : []),
    ],
  };
}

function traceStorage(): TraceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function formatArrivalTime(remainingMinutes: number) {
  return new Date(estimateArrivalTimestamp(Date.now(), remainingMinutes)).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const GPS_REARM_INTERVAL_MS = 20_000;
const MAP_LOAD_PATIENCE_MS = 12_000;

export default function Home() {
  const [areaId, setAreaId] = useState<PilotAreaId>("milan");
  const area = PILOT_AREAS[areaId];
  const areaIdRef = useRef<PilotAreaId>("milan");
  const addressRequestRef = useRef<AbortController | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pointMarkersRef = useRef<{ start?: MapLibreMarker; end?: MapLibreMarker; vehicle?: MapLibreMarker }>({});
  const vehicleArrowRef = useRef<HTMLSpanElement | null>(null);
  const pickingRef = useRef<PickingMode | null>(null);
  const directionsTriggerRef = useRef<HTMLButtonElement>(null);
  const journeyWatchRef = useRef<number | null>(null);
  const simulationTimerRef = useRef<number | null>(null);
  const navigationSessionRef = useRef(0);
  const journeyModeRef = useRef<JourneyMode | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const wakeLockPendingSessionRef = useRef<number | null>(null);
  const lastJourneyOriginRef = useRef<Coordinate | null>(null);
  const lastJourneyCalculationRef = useRef(0);
  const navigationFixStateRef = useRef(createNavigationFixState());
  const traceRecorderRef = useRef<ReturnType<typeof createGpsTraceRecorder> | null>(null);
  const lastSpokenInstructionRef = useRef("");
  const journeyActiveRef = useRef(false);
  const selectedRouteRef = useRef<RouteResult | null>(null);
  const selectedRouteModelRef = useRef<RouteProgressModel<NavigationInstruction> | null>(null);
  const endLocationRef = useRef<LocationChoice | null>(null);
  const loadingRef = useRef(false);
  const recalculatingRef = useRef(false);
  const voiceEnabledRef = useRef(false);
  const navigationStartedAtRef = useRef(0);
  const lastValidGpsFixAtRef = useRef<number | null>(null);
  const gpsStallReportedRef = useRef(false);
  const transportModeRef = useRef<TransportMode>("car");
  const transportReadyRef = useRef(false);
  const voiceReadyRef = useRef(false);
  const activeRouteRef = useRef<"safe" | "fast">("fast");
  const routeRequestRef = useRef<{ id: number; revision: number; controller: AbortController } | null>(null);
  const routeRequestCounterRef = useRef(0);
  const plannerRevisionRef = useRef(0);
  const navigationPreferencesRef = useRef<RoutePreferences>({ avoidance: "strong", maxExtraMinutes: null });
  const cameraLastUpdateRef = useRef(0);
  const cameraLastCenterRef = useRef<Coordinate | null>(null);
  const cameraLastHeadingRef = useRef(0);
  const promptPreferredRouteRef = useRef<"fast" | null>(null);
  const pendingCalculationRef = useRef(false);
  const resolvedStartRef = useRef<LocationChoice | null>(null);
  const startLocationRef = useRef<LocationChoice>({ label: "", coordinate: PILOT_AREAS.milan.center });
  const startTextRef = useRef("");
  const endTextRef = useRef("");
  const routeFieldsRef = useRef<HTMLDivElement | null>(null);
  const autocompleteTimerRef = useRef<number | null>(null);
  const autocompleteRequestIdRef = useRef(0);
  const autocompleteControllerRef = useRef<AbortController | null>(null);
  const focusedAddressFieldRef = useRef<"start" | "end" | null>(null);
  const geocodeCacheRef = useRef<Map<string, { timestamp: number; results: GeocodeResult[] }>>(new Map());
  const rerouteFailuresRef = useRef(0);
  const lastWatchArmedAtRef = useRef(0);
  const discardPlannedRouteRef = useRef<() => void>(() => undefined);
  const [startLocation, setStartLocation] = useState<LocationChoice>({ label: "", coordinate: PILOT_AREAS.milan.center });
  const [endLocation, setEndLocation] = useState<LocationChoice>({ label: "", coordinate: PILOT_AREAS.milan.center });
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [inlineSuggestions, setInlineSuggestions] = useState<GeocodeResult[]>([]);
  const [inlineSuggestionTarget, setInlineSuggestionTarget] = useState<"start" | "end" | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [transportMode, setTransportMode] = useState<TransportMode>("car");
  const [avoidance, setAvoidance] = useState<Avoidance>("strong");
  const [maxExtraMinutes, setMaxExtraMinutes] = useState<number | null>(null);
  const [routePrompt, setRoutePrompt] = useState("");
  const [promptInterpretation, setPromptInterpretation] = useState<PromptRoutePreferenceResult | null>(null);
  const [fastRoute, setFastRoute] = useState<RouteResult>(emptyRoute);
  const [safeRoute, setSafeRoute] = useState<RouteResult>(emptyRoute);
  const [activeRoute, setActiveRoute] = useState<"safe" | "fast">("fast");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [picking, setPicking] = useState<PickingMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Scegli partenza e destinazione.");
  const [planError, setPlanError] = useState<string | null>(null);
  const [isLiveResult, setIsLiveResult] = useState(false);
  const [mapKeyAtBottom, setMapKeyAtBottom] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [alternativesAnalyzed, setAlternativesAnalyzed] = useState(0);
  const [hasDistinctAlternative, setHasDistinctAlternative] = useState(false);
  const [activePanel, setActivePanel] = useState<"plan" | "routes" | "community">("plan");
  const [isJourneyActive, setIsJourneyActive] = useState(false);
  const [journeyMode, setJourneyMode] = useState<JourneyMode | null>(null);
  const [journeyPosition, setJourneyPosition] = useState<Coordinate | null>(null);
  const [gpsProgress, setGpsProgress] = useState<ReturnType<typeof calculateRouteProgress<NavigationInstruction>> | null>(null);
  const [journeyHeading, setJourneyHeading] = useState(0);
  const [journeyAccuracy, setJourneyAccuracy] = useState<number | null>(null);
  const [followVehicle, setFollowVehicle] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [lastRecalculatedAt, setLastRecalculatedAt] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState("");
  const [rerouteIssue, setRerouteIssue] = useState(false);
  const [hasGpsFix, setHasGpsFix] = useState(false);
  const [gpsAcquireIssue, setGpsAcquireIssue] = useState<"timeout" | "imprecise" | null>(null);
  const [resumeOffer, setResumeOffer] = useState<JourneyMode | null>(null);
  const [startupNoticeVisible, setStartupNoticeVisible] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [routeDetailsOpen, setRouteDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [routingProfile, setRoutingProfile] = useState<RouteApiResponse["routingProfile"]>({
    provider: "pending",
    profile: "car",
    approximate: false,
    notice: "Da calcolare",
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [addressResults, setAddressResults] = useState<GeocodeResult[]>([]);
  const [addressSearchTarget, setAddressSearchTarget] = useState<"start" | "end" | null>(null);
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [mapChooserOpen, setMapChooserOpen] = useState(false);
  const [reports, setReports] = useState<RoadReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportStats, setReportStats] = useState<ReportStats>({ total: 0, pending: 0, verified: 0, communityMeters: 0 });
  const [reportStart, setReportStart] = useState<Coordinate | null>(null);
  const [reportEnd, setReportEnd] = useState<Coordinate | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportKind, setReportKind] = useState<ReportKind>("pave");
  const [reportSeverity, setReportSeverity] = useState(2);
  const [reportNote, setReportNote] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportSubmitError, setReportSubmitError] = useState("");
  const [reportsAvailable, setReportsAvailable] = useState(true);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadIssue, setMapLoadIssue] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [fieldFeedbackOpen, setFieldFeedbackOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [traceEnabled, setTraceEnabled] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceRecorderStatus>("idle");
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [navigationDiagnostics, setNavigationDiagnostics] = useState<NavigationDiagnostics>(() => createNavigationDiagnostics());
  const recordDiagnostic = useCallback((event: NavigationDiagnosticEvent) => {
    setNavigationDiagnostics((current) => recordNavigationDiagnosticEvent(current, event));
    if (event.type !== "fix-accepted" && event.type !== "fix-rejected") {
      traceRecorderRef.current?.recordEvent(event.type, event.type === "wake-lock" ? String(event.active) : undefined);
    }
  }, []);
  const selectedRoute = activeRoute === "safe" ? safeRoute : fastRoute;
  const selectedRouteModel = useMemo(
    () => buildRouteProgressModel(
      selectedRoute.coordinates,
      selectedRoute.instructions ?? [],
      distanceMeters,
    ),
    [selectedRoute],
  );
  const navigationProgress = useMemo(
    () => {
      // GPS decisions are made once per fix; projecting again here could disagree with them.
      if (isJourneyActive && journeyMode === "gps" && gpsProgress) return gpsProgress;
      return calculateRouteProgress(
        selectedRouteModel,
        journeyPosition,
        selectedRoute.minutes,
        isJourneyActive ? navigationFixStateRef.current.progressMeters : null,
        isJourneyActive && journeyAccuracy !== null
          ? {
              accuracy: journeyAccuracy,
              elapsedSeconds: 1,
              maxSpeedMps: transportMode === "bicycle" ? 22 : 45,
            }
          : undefined,
      );
    },
    [
      gpsProgress,
      isJourneyActive,
      journeyAccuracy,
      journeyMode,
      journeyPosition,
      selectedRoute.minutes,
      selectedRouteModel,
      transportMode,
    ],
  );
  const navigationPhase = isJourneyActive
    ? journeyMode === "gps" && !hasGpsFix
      ? "starting"
      : isRecalculating
        ? "rerouting"
        : "navigating"
    : isLoading
      ? "planning"
      : routeReady && isLiveResult
        ? "route-ready"
        : "idle";
  const navigationModeLabel = (() => {
    if (journeyMode === "simulation") return "SIMULAZIONE";
    if (gpsState === "recalculating" || isRecalculating) return "RICALCOLO";
    if (gpsState === "requesting") return "RICERCA GPS";
    if (gpsState === "weak") return "GPS DEBOLE";
    if (gpsState === "outside") return "FUORI AREA";
    if (gpsState === "temporarily-unavailable") return "GPS IN ATTESA";
    if (gpsState === "offroute") return "FUORI PERCORSO";
    if (journeyAccuracy !== null && journeyAccuracy > 65) return "GPS IMPRECISO";
    return "GPS LIVE";
  })();
  const navigationStateDescription = (() => {
    if (journeyMode === "simulation") return "Avanzamento automatico · GPS non usato";
    if (!isOnline) return "Connessione assente · continuo sul percorso salvato";
    if (gpsState === "recalculating" || isRecalculating) return "Fuori percorso · sto calcolando una nuova strada";
    if (rerouteIssue) return "Ricalcolo non riuscito · continuo sull’ultimo percorso e riprovo a breve";
    if (gpsState === "weak") {
      return `Segnale debole${journeyAccuracy ? ` · ±${Math.round(journeyAccuracy)} m` : ""} · ultimo punto valido`;
    }
    if (gpsState === "outside") return `Posizione fuori dall’area pilota di ${area.name}`;
    if (gpsState === "temporarily-unavailable") return "Segnale GPS assente · ultimo punto valido";
    if (gpsState === "offroute") return "Fuori percorso · attendo una posizione affidabile";
    if (journeyAccuracy !== null && journeyAccuracy > 65) return `Posizione imprecisa · ±${Math.round(journeyAccuracy)} m`;
    return null;
  })();
  const positionStorageNote = traceStatus === "recording"
    ? "traccia salvata su questo dispositivo"
    : "La posizione non viene salvata";
  const speakInstruction = useCallback((text: string) => {
    if (!voiceEnabledRef.current || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "it-IT";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Visual guidance remains available when speech synthesis fails.
    }
  }, []);
  const toggleVoiceGuidance = useCallback(() => {
    if (!voiceAvailable) {
      setStatus("La guida vocale non è disponibile su questo dispositivo.");
      return;
    }
    setVoiceEnabled((current) => {
      const next = !current;
      voiceEnabledRef.current = next;
      if (current) window.speechSynthesis?.cancel();
      else lastSpokenInstructionRef.current = "";
      return next;
    });
  }, [voiceAvailable]);

  function selectActiveRoute(routeKind: "safe" | "fast") {
    promptPreferredRouteRef.current = null;
    updateStoredPlanSelection(routeKind);
    activeRouteRef.current = routeKind;
    const nextSelectedRoute = routeKind === "safe" ? safeRoute : fastRoute;
    selectedRouteRef.current = nextSelectedRoute;
    selectedRouteModelRef.current = buildRouteProgressModel(
      nextSelectedRoute.coordinates,
      nextSelectedRoute.instructions ?? [],
      distanceMeters,
    );
    navigationFixStateRef.current = withReplacementRoute(navigationFixStateRef.current, 0);
    setGpsProgress(null);
    traceRecorderRef.current?.addRoute({
      progressMeters: 0,
      minutes: nextSelectedRoute.minutes,
      distanceKm: nextSelectedRoute.distance,
      coordinates: nextSelectedRoute.coordinates,
      instructions: nextSelectedRoute.instructions ?? [],
    });
    setActiveRoute(routeKind);
  }

  const setPickingMode = useCallback((mode: PickingMode | null) => {
    pickingRef.current = mode;
    setPicking(mode);
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = mode ? "crosshair" : "";
  }, []);

  const closeDirections = useCallback(() => {
    setDirectionsOpen(false);
    window.queueMicrotask(() => directionsTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("area");
    const plan = readStoredPlan<RouteApiResponse>();
    const restorable = plan !== null && isPilotAreaId(plan.areaId)
      && (!requested || requested === plan.areaId)
      && isNavigableRouteGeometry(plan.data?.fast?.coordinates)
      && isNavigableRouteGeometry(plan.data?.safe?.coordinates);
    if (restorable) window.queueMicrotask(() => restorePlan(plan));
    else if (requested && isPilotAreaId(requested)) window.queueMicrotask(() => changeArea(requested));
    // Apply the initial URL and stored plan once; later changes use the explicit controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.jumpTo({ center: area.center, zoom: areaId === "milan" ? 13.5 : 13, pitch: 0, bearing: 0 });
  }, [area, areaId, mapReady]);

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then(({ Map, AttributionControl, NavigationControl, Marker }) => {
      if (cancelled || !mapContainer.current || mapRef.current) return;
      const map = new Map({
        container: mapContainer.current,
        style: mapStyle,
        center: PILOT_AREAS[areaIdRef.current].center,
        zoom: 13.5,
        attributionControl: false,
      });
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      // The sheet covers the map's lower edge on a phone, and the data credit has to stay readable.
      // It starts open and folds into its info button once the camera first moves.
      map.addControl(new AttributionControl({ compact: true }), "bottom-left");
      const collapseAttribution = () => {
        const credit = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
        credit?.removeAttribute("open");
        credit?.classList.remove("maplibregl-compact-show");
      };
      collapseAttribution();
      map.once("style.load", collapseAttribution);
      map.once("load", collapseAttribution);
      map.once("idle", collapseAttribution);
      map.once("movestart", collapseAttribution);
      map.on("styleimagemissing", ({ id }) => {
        if (!map.hasImage(id)) {
          map.addImage(id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
        }
      });
      map.once("error", () => {
        if (!cancelled) setStatus("La mappa non è disponibile. Il percorso resta consultabile nei dettagli.");
      });
      const startElement = document.createElement("div");
      startElement.className = "endpoint-marker start";
      startElement.setAttribute("aria-label", "Partenza");
      pointMarkersRef.current.start = new Marker({ element: startElement })
        .setLngLat(startLocation.coordinate)
        .addTo(map);
      const endElement = document.createElement("div");
      endElement.className = "endpoint-marker end";
      endElement.setAttribute("aria-label", "Destinazione");
      pointMarkersRef.current.end = new Marker({ element: endElement })
        .setLngLat(endLocation.coordinate)
        .addTo(map);
      const vehicleElement = document.createElement("div");
      vehicleElement.className = "vehicle-marker";
      vehicleElement.setAttribute(
        "aria-label",
        `Posizione ${transportMeta[transportModeRef.current].label.toLowerCase()}`,
      );
      vehicleElement.dataset.testid = "vehicle-marker";
      vehicleElement.dataset.transport = transportModeRef.current;
      vehicleElement.style.display = "none";
      const accuracyHalo = document.createElement("i");
      const vehicleArrow = document.createElement("span");
      vehicleArrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 20l7-3.5L19 20 12 3Z" fill="currentColor"/></svg>';
      vehicleElement.append(accuracyHalo, vehicleArrow);
      vehicleArrowRef.current = vehicleArrow;
      pointMarkersRef.current.vehicle = new Marker({ element: vehicleElement, rotationAlignment: "map" })
        .setLngLat(startLocation.coordinate)
        .addTo(map);
      map.on("dragstart", () => {
        if (journeyActiveRef.current) setFollowVehicle(false);
      });
      map.on("click", (event) => {
        const target = pickingRef.current;
        if (!target) return;
        const coordinate: Coordinate = [
          Number(event.lngLat.lng.toFixed(6)),
          Number(event.lngLat.lat.toFixed(6)),
        ];
        if (!coordinateInArea(coordinate, PILOT_AREAS[areaIdRef.current])) {
          setStatus(`Scegli un punto nell’area pilota di ${PILOT_AREAS[areaIdRef.current].name}.`);
          return;
        }
        const label = `Punto scelto · ${coordinate[1].toFixed(4)}, ${coordinate[0].toFixed(4)}`;
        if (target === "start") {
          discardPlannedRouteRef.current();
          const chosen = { label, coordinate };
          startLocationRef.current = chosen;
          resolvedStartRef.current = chosen;
          startTextRef.current = label;
          setStartLocation(chosen);
          setStartText(label);
        } else if (target === "end") {
          discardPlannedRouteRef.current();
          const chosen = { label, coordinate };
          endLocationRef.current = chosen;
          endTextRef.current = label;
          setEndLocation(chosen);
          setEndText(label);
        } else if (target === "reportStart") {
          setReportStart(coordinate);
          setReportEnd(null);
          setPickingMode("reportEnd");
          setStatus("Ora clicca il punto finale del tratto da segnalare.");
          return;
        } else {
          setReportEnd(coordinate);
          setPickingMode(null);
          setReportModalOpen(true);
          setStatus("Descrivi il tratto selezionato e invia la segnalazione.");
          return;
        }
        setPickingMode(null);
        if (target === "start" || target === "end") {
          setStatus(`${target === "start" ? "Partenza" : "Destinazione"} impostata. Ora calcola il percorso.`);
        }
      });
      // The style is enough to draw routes; waiting for "load" would also wait for every tile,
      // which leaves a calculated route invisible on a slow connection.
      const mapLoadTimer = window.setTimeout(() => setMapLoadIssue(!map.getSource("fast-route")), MAP_LOAD_PATIENCE_MS);
      map.on("error", (event) => {
        const failedSource = (event as { sourceId?: string }).sourceId;
        if (!failedSource && !map.getSource("fast-route")) setMapLoadIssue(true);
      });
      map.once("style.load", () => {
        window.clearTimeout(mapLoadTimer);
        setMapLoadIssue(false);
        const alternativePaint = routePaint("alternative");
        map.addSource("fast-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("safe-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("problem-segments", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("community-reports", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("report-draft", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("theme-overlay", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
            },
          },
        });
        // Under the labels, so dimming the map for the dark theme keeps street names readable.
        map.addLayer({
          id: "theme-overlay",
          type: "fill",
          source: "theme-overlay",
          paint: { "fill-color": "#071315", "fill-opacity": 0 },
        }, firstLabelLayerAboveMap(map));
        hideBuildingExtrusions(map);
        map.addLayer({
          id: "fast-outline",
          type: "line",
          source: "fast-route",
          paint: alternativePaint.outline,
        });
        map.addLayer({
          id: "fast-line",
          type: "line",
          source: "fast-route",
          paint: alternativePaint.line,
        });
        map.addLayer({
          id: "safe-outline",
          type: "line",
          source: "safe-route",
          paint: alternativePaint.outline,
        });
        map.addLayer({
          id: "safe-line",
          type: "line",
          source: "safe-route",
          paint: alternativePaint.line,
        });
        map.addLayer({
          id: "problem-line",
          type: "line",
          source: "problem-segments",
          paint: { "line-color": "#e2553f", "line-width": 7, "line-dasharray": [1.2, 1.2] },
        });
        map.addLayer({
          id: "community-report-line",
          type: "line",
          source: "community-reports",
          paint: {
            "line-color": ["match", ["get", "kind"],
              "recently_asphalted", "#16886e",
              "wrong_data", "#748083",
              "rough_cobblestone", "#d84a35",
              "#e59a2f",
            ],
            "line-width": ["match", ["get", "severity"], 3, 8, 2, 6, 4],
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "report-draft-line",
          type: "line",
          source: "report-draft",
          paint: {
            "line-color": "#122023",
            "line-width": 7,
            "line-dasharray": [1, 1],
          },
        });
        map.addLayer({
          id: "report-draft-start",
          type: "circle",
          source: "report-draft",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 9,
            "circle-color": "#122023",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 4,
          },
        });
        setMapReady(true);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // MapLibre owns this imperative instance for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    discardPlannedRouteRef.current = discardPlannedRoute;
  });

  useEffect(() => {
    pickingRef.current = picking;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  useEffect(() => {
    pointMarkersRef.current.start?.setLngLat(startLocation.coordinate);
    const element = pointMarkersRef.current.start?.getElement();
    if (element) element.style.display = startLocation.label ? "" : "none";
    startLocationRef.current = startLocation;
  }, [startLocation, mapReady]);

  useEffect(() => {
    pointMarkersRef.current.end?.setLngLat(endLocation.coordinate);
    const element = pointMarkersRef.current.end?.getElement();
    if (element) element.style.display = endLocation.label ? "" : "none";
    endLocationRef.current = endLocation;
  }, [endLocation, mapReady]);

  useEffect(() => {
    startTextRef.current = startText;
  }, [startText]);

  useEffect(() => {
    endTextRef.current = endText;
  }, [endText]);

  useEffect(() => {
    if (!inlineSuggestionTarget) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const targetNode = event.target;
      if (targetNode instanceof Node && routeFieldsRef.current?.contains(targetNode)) {
        return;
      }
      focusedAddressFieldRef.current = null;
      setInlineSuggestions([]);
      setInlineSuggestionTarget(null);
      setActiveSuggestionIndex(-1);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [inlineSuggestionTarget]);

  useEffect(() => {
    journeyActiveRef.current = isJourneyActive;
    selectedRouteRef.current = selectedRoute;
    selectedRouteModelRef.current = selectedRouteModel;
  }, [isJourneyActive, selectedRoute, selectedRouteModel]);

  useEffect(() => {
    activeRouteRef.current = activeRoute;
  }, [activeRoute]);

  useEffect(() => {
    transportModeRef.current = transportMode;
    if (!transportReadyRef.current) return;
    window.localStorage.setItem("lastrico-transport", transportMode);
    const markerElement = pointMarkersRef.current.vehicle?.getElement();
    if (markerElement) {
      markerElement.dataset.transport = transportMode;
      markerElement.setAttribute(
        "aria-label",
        `Posizione ${transportMeta[transportMode].label.toLowerCase()}`,
      );
    }
  }, [transportMode]);

  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const marker = pointMarkersRef.current.vehicle;
    const element = marker?.getElement();
    if (!marker || !element) return;
    if (!journeyPosition || !isJourneyActive) {
      element.style.display = "none";
      return;
    }
    element.style.display = "grid";
    marker.setLngLat(journeyPosition);
    if (vehicleArrowRef.current) vehicleArrowRef.current.style.transform = `rotate(${journeyHeading}deg)`;
    element.style.setProperty("--accuracy", `${Math.min(90, Math.max(24, journeyAccuracy ?? 24))}px`);
    const now = performance.now();
    if (followVehicle && shouldUpdateNavigationCamera({
      mode: "navigation-following",
      now,
      lastUpdatedAt: cameraLastUpdateRef.current,
      previousCenter: cameraLastCenterRef.current,
      center: journeyPosition,
      previousHeading: cameraLastHeadingRef.current,
      heading: journeyHeading,
      distanceMeters,
    })) {
      const map = mapRef.current;
      map?.easeTo({
        center: journeyPosition,
        zoom: 16.6,
        pitch: 42,
        bearing: journeyHeading,
        duration: 650,
        essential: false,
        padding: map ? vehicleCameraPadding(map.getContainer()) : undefined,
      });
      cameraLastUpdateRef.current = now;
      cameraLastCenterRef.current = journeyPosition;
      cameraLastHeadingRef.current = journeyHeading;
    }
  }, [journeyPosition, journeyHeading, journeyAccuracy, followVehicle, isJourneyActive]);

  useEffect(() => {
    const map = mapRef.current;
    // Not isStyleLoaded(): it stays false while tiles load, which left a calculated route
    // undrawn, even during navigation, with nothing to trigger another attempt.
    if (!mapReady || !map?.getSource("fast-route")) return;
    if (!isLiveResult || !fastRoute.coordinates.length || !safeRoute.coordinates.length) {
      (map.getSource("fast-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("safe-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("problem-segments") as GeoJSONSource)?.setData(emptyFeatureCollection);
      return;
    }
    (map.getSource("fast-route") as GeoJSONSource)?.setData(routeGeoJSON(fastRoute));
    (map.getSource("safe-route") as GeoJSONSource)?.setData(
      hasDistinctAlternative ? routeGeoJSON(safeRoute) : emptyFeatureCollection,
    );
    (map.getSource("problem-segments") as GeoJSONSource)?.setData(problemGeoJSON([selectedRoute]));
    const selectedLine = `${activeRoute}-line`;
    const selectedOutline = `${activeRoute}-outline`;
    const secondaryRoute = activeRoute === "fast" ? "safe" : "fast";
    const secondaryLine = `${secondaryRoute}-line`;
    const secondaryOutline = `${secondaryRoute}-outline`;
    const activePaint = routePaint("active");
    const alternativePaint = routePaint("alternative");
    Object.entries(activePaint.line).forEach(([property, value]) =>
      map.setPaintProperty(selectedLine, property, value));
    Object.entries(activePaint.outline).forEach(([property, value]) =>
      map.setPaintProperty(selectedOutline, property, value));
    Object.entries(alternativePaint.line).forEach(([property, value]) =>
      map.setPaintProperty(secondaryLine, property, value));
    Object.entries(alternativePaint.outline).forEach(([property, value]) =>
      map.setPaintProperty(secondaryOutline, property, value));
    map.moveLayer(selectedOutline, "problem-line");
    map.moveLayer(selectedLine, "problem-line");
    if (!shouldBeginNavigation(journeyActiveRef.current)) return;
    const allCoordinates = [...fastRoute.coordinates, ...safeRoute.coordinates];
    const lngs = allCoordinates.map(([lng]) => lng);
    const lats = allCoordinates.map(([, lat]) => lat);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: visibleMapPadding(map.getContainer()),
      maxZoom: 14.7,
      duration: 650,
    });
  }, [fastRoute, safeRoute, selectedRoute, activeRoute, hasDistinctAlternative, isLiveResult, mapReady, viewportRevision]);

  useEffect(() => {
    let timer: number | undefined;
    const handleResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setViewportRevision((revision) => revision + 1), 250);
    };
    // iOS keeps the layout height when the keyboard opens, so the panel lifts itself above it.
    const viewport = window.visualViewport;
    const handleKeyboard = () => {
      if (!viewport) return;
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(covered)}px`);
    };
    window.addEventListener("resize", handleResize);
    viewport?.addEventListener("resize", handleKeyboard);
    viewport?.addEventListener("scroll", handleKeyboard);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
      viewport?.removeEventListener("resize", handleKeyboard);
      viewport?.removeEventListener("scroll", handleKeyboard);
    };
  }, []);

  // globals.css moves the legend to the bottom on tablet/desktop and in phone landscape. Declared
  // as a top overlay there, it pushed the route fit into a strip at the bottom of the map.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px) and (min-height: 501px), (max-height: 500px)");
    const update = () => setMapKeyAtBottom(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const voiceEval = evaluateVoiceGuidance({
      isJourneyActive,
      voiceEnabled,
      journeyMode,
      gpsState,
      accuracy: journeyAccuracy,
      transportMode,
      instruction: navigationProgress.instruction,
      instructionDistance: navigationProgress.instructionDistance,
      lastSpokenInstructionId: lastSpokenInstructionRef.current,
    });
    if (!voiceEval.shouldSpeak || !voiceEval.textToSpeak) return;
    lastSpokenInstructionRef.current = voiceEval.spokenInstructionId ?? "";
    speakInstruction(voiceEval.textToSpeak);
    traceRecorderRef.current?.recordEvent("voice-spoken", voiceEval.spokenInstructionId ?? undefined);
  }, [
    isJourneyActive,
    voiceEnabled,
    journeyMode,
    gpsState,
    journeyAccuracy,
    transportMode,
    navigationProgress.instruction,
    navigationProgress.instructionDistance,
    speakInstruction,
  ]);

  useEffect(() => {
    const simulationRoute = selectedRouteRef.current;
    if (!shouldRunSimulationTimer(journeyMode) || !simulationRoute?.coordinates.length) return;
    const coordinates = simulationRoute.coordinates;
    const session = navigationSessionRef.current;
    let index = 0;
    const step = Math.max(1, Math.floor(coordinates.length / NAVIGATION_POLICY[transportModeRef.current].simulationSteps));
    simulationTimerRef.current = window.setInterval(() => {
      if (
        !journeyActiveRef.current
        || journeyModeRef.current !== "simulation"
        || navigationSessionRef.current !== session
      ) return;
      index = Math.min(coordinates.length - 1, index + step);
      const position = coordinates[index];
      if (selectedRouteModelRef.current) {
        navigationFixStateRef.current = {
          ...navigationFixStateRef.current,
          progressMeters: simulationProgressMeters(selectedRouteModelRef.current, index),
        };
      }
      const previous = coordinates[Math.max(0, index - step)];
      setJourneyPosition(position);
      setJourneyHeading(bearingBetween(previous, position));
      if (index >= coordinates.length - 1) finishNavigation(true);
    }, 700);
    return () => {
      if (simulationTimerRef.current !== null) window.clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    };
    // Simulation follows the route that was active when it started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyMode]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    window.queueMicrotask(() => {
      setVoiceAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    });
  }, []);

  useEffect(() => {
    window.queueMicrotask(() => setTraces(listGpsTraces(traceStorage())));
    // iOS does not reliably fire pagehide, so a hidden page also saves what is buffered.
    const saveTrace = () => {
      if (document.visibilityState !== "visible") traceRecorderRef.current?.flush();
    };
    window.addEventListener("pagehide", saveTrace);
    document.addEventListener("visibilitychange", saveTrace);
    return () => {
      window.removeEventListener("pagehide", saveTrace);
      document.removeEventListener("visibilitychange", saveTrace);
      traceRecorderRef.current?.flush();
    };
  }, []);

  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("lastrico-theme");
    if (savedTheme === "auto" || savedTheme === "light" || savedTheme === "dark") {
      window.queueMicrotask(() => setThemeMode(savedTheme));
    }
  }, []);

  useEffect(() => {
    const savedTransport = window.localStorage.getItem("lastrico-transport");
    if (savedTransport === "car" || savedTransport === "motorcycle" || savedTransport === "bicycle") {
      transportModeRef.current = savedTransport;
      window.queueMicrotask(() => {
        setTransportMode(savedTransport);
        transportReadyRef.current = true;
      });
      return;
    }
    transportReadyRef.current = true;
  }, []);

  useEffect(() => {
    const savedVoice = window.localStorage.getItem("lastrico-voice");
    if (savedVoice === "on" || savedVoice === "off") {
      voiceEnabledRef.current = savedVoice === "on";
      window.queueMicrotask(() => {
        setVoiceEnabled(savedVoice === "on");
        voiceReadyRef.current = true;
      });
      return;
    }
    voiceReadyRef.current = true;
  }, []);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceReadyRef.current) return;
    window.localStorage.setItem("lastrico-voice", voiceEnabled ? "on" : "off");
  }, [voiceEnabled]);

  useEffect(() => {
    const applyTheme = () => {
      const hour = new Date().getHours();
      const nextTheme = themeMode === "auto"
        ? hour >= 7 && hour < 19 ? "light" : "dark"
        : themeMode;
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        nextTheme === "dark" ? "#0b1315" : "#f4f2ec",
      );
      window.localStorage.setItem("lastrico-theme", themeMode);

      const map = mapRef.current;
      if (mapReady && map) applyMapTheme(map, nextTheme);
    };
    applyTheme();
    const timer = window.setInterval(applyTheme, 60_000);
    return () => window.clearInterval(timer);
  }, [themeMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map) applyJourneyMapDetail(map, isJourneyActive);
  }, [isJourneyActive, mapReady]);

  useEffect(() => {
    if (!isJourneyActive || journeyMode !== "gps") return;
    const timer = window.setInterval(() => {
      const stall = evaluateGpsSignalStall({
        journeyActive: journeyActiveRef.current,
        mode: journeyModeRef.current,
        now: Date.now(),
        sessionStartedAt: navigationStartedAtRef.current,
        lastValidFixAt: lastValidGpsFixAtRef.current,
      });
      if (!stall.stalled) {
        gpsStallReportedRef.current = false;
        return;
      }
      // iOS can silently stop a watch, and only a new one resumes the updates.
      rearmGpsWatch();
      if (!gpsStallReportedRef.current && !recalculatingRef.current) {
        gpsStallReportedRef.current = true;
        recordDiagnostic({ type: "signal-loss" });
        setGpsState("temporarily-unavailable");
        if (stall.reason === "acquire-timeout") setGpsAcquireIssue("timeout");
      }
    }, 3_000);
    return () => window.clearInterval(timer);
    // The timer only reads refs; the watch functions it calls do too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJourneyActive, journeyMode, recordDiagnostic]);

  useEffect(() => {
    const reacquireWakeLock = () => {
      if (document.visibilityState === "visible" && journeyActiveRef.current) {
        void requestWakeLock();
        if (journeyModeRef.current === "gps") {
          recordDiagnostic({ type: "foreground-resume" });
          rearmGpsWatch();
        }
      }
    };
    document.addEventListener("visibilitychange", reacquireWakeLock);
    return () => {
      document.removeEventListener("visibilitychange", reacquireWakeLock);
      if (journeyWatchRef.current !== null) navigator.geolocation.clearWatch(journeyWatchRef.current);
      if (simulationTimerRef.current !== null) window.clearInterval(simulationTimerRef.current);
      routeRequestRef.current?.controller.abort();
      addressRequestRef.current?.abort();
      void wakeLockRef.current?.release();
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/reports")
      .then(async (response) => {
        const data = await response.json() as { reports?: RoadReport[]; stats?: ReportStats };
        if (!response.ok || !data.reports || !data.stats) throw new Error("reports unavailable");
        setReports(data.reports);
        setReportStats(data.stats);
        setReportsAvailable(true);
      })
      .catch(() => setReportsAvailable(false))
      .finally(() => setReportsLoading(false));
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("community-reports") as GeoJSONSource)?.setData(areaId === "milan" ? reportsGeoJSON(reports) : emptyFeatureCollection);
  }, [reports, mapReady, areaId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    (map.getSource("report-draft") as GeoJSONSource)?.setData(draftGeoJSON(reportStart, reportEnd));
  }, [reportStart, reportEnd, mapReady]);

  function changeArea(nextAreaId: PilotAreaId) {
    if (nextAreaId === areaIdRef.current || journeyActiveRef.current) return;
    finishNavigation();
    invalidateRouteIntent();
    cancelAddressSearch();
    geocodeCacheRef.current.clear();
    areaIdRef.current = nextAreaId;
    setAreaId(nextAreaId);
    const nextArea = PILOT_AREAS[nextAreaId];
    const nextStart: LocationChoice = { label: "", coordinate: nextArea.center };
    const nextEnd: LocationChoice = { label: "", coordinate: nextArea.center };
    startLocationRef.current = nextStart;
    resolvedStartRef.current = null;
    endLocationRef.current = nextEnd;
    startTextRef.current = "";
    endTextRef.current = "";
    setStartLocation(nextStart);
    setEndLocation(nextEnd);
    setStartText("");
    setEndText("");
    setFastRoute(emptyRoute);
    setSafeRoute(emptyRoute);
    clearStoredPlan();
    setPlanError(null);
    selectedRouteRef.current = null;
    selectedRouteModelRef.current = null;
    activeRouteRef.current = "fast";
    setActiveRoute("fast");
    setIsLiveResult(false);
    setHasDistinctAlternative(false);
    setAlternativesAnalyzed(0);
    setLastRecalculatedAt(null);
    setRoutingProfile({ provider: "pending", profile: transportModeRef.current, approximate: false, notice: "Da calcolare" });
    setAddressResults([]);
    setAddressSearchTarget(null);
    setAddressSearchLoading(false);
    setAddressQuery("");
    setPickingMode(null);
    setReportStart(null);
    setReportEnd(null);
    setReportModalOpen(false);
    setMapChooserOpen(false);
    setActivePanel("plan");
    const url = new URL(window.location.href);
    url.searchParams.set("area", nextAreaId);
    window.history.replaceState(null, "", url);
    setStatus(`${nextArea.name}: scegli partenza e destinazione.`);
  }

  function restorePlan(plan: NonNullable<ReturnType<typeof readStoredPlan<RouteApiResponse>>>) {
    const planArea = plan.areaId as PilotAreaId;
    areaIdRef.current = planArea;
    setAreaId(planArea);
    startLocationRef.current = plan.start;
    resolvedStartRef.current = plan.start;
    endLocationRef.current = plan.end;
    startTextRef.current = plan.start.label;
    endTextRef.current = plan.end.label;
    setStartLocation(plan.start);
    setEndLocation(plan.end);
    setStartText(plan.start.label);
    setEndText(plan.end.label);
    setAvoidance(plan.preferences.avoidance as Avoidance);
    setMaxExtraMinutes(plan.preferences.maxExtraMinutes);
    navigationPreferencesRef.current = plan.preferences as RoutePreferences;
    applyRouteData(plan.data, plan.activeRoute, plan.mode as TransportMode);
    if (plan.journey) {
      setResumeOffer(plan.journey);
      setStatus("La navigazione si è interrotta con il ricaricamento della pagina.");
    } else {
      setStatus(plan.data.dataNotice);
    }
  }

  function invalidateRouteIntent() {
    plannerRevisionRef.current += 1;
    setRouteReady(false);
    setPlanError(null);
    if (loadingRef.current) setStatus("Calcolo annullato: la richiesta è cambiata.");
    routeRequestRef.current?.controller.abort();
    routeRequestRef.current = null;
    loadingRef.current = false;
    setIsLoading(false);
  }

  /** A changed endpoint makes the shown route wrong, so it leaves the screen instead of lingering. */
  function discardPlannedRoute() {
    invalidateRouteIntent();
    pendingCalculationRef.current = false;
    if (!isLiveResult && !fastRoute.coordinates.length) return;
    setIsLiveResult(false);
    setHasDistinctAlternative(false);
    setFastRoute(emptyRoute);
    setSafeRoute(emptyRoute);
    selectedRouteRef.current = null;
    selectedRouteModelRef.current = null;
    activeRouteRef.current = "fast";
    setActiveRoute("fast");
    setAlternativesAnalyzed(0);
    setLastRecalculatedAt(null);
    setActivePanel((panel) => panel === "routes" ? "plan" : panel);
    clearStoredPlan();
  }

  function setManualAvoidance(value: Avoidance) {
    if (value === avoidance && maxExtraMinutes === null) return;
    const nextPreferences: RoutePreferences = { avoidance: value, maxExtraMinutes: null };
    const shouldRecalculate = isLiveResult && !isJourneyActive;
    invalidateRouteIntent();
    promptPreferredRouteRef.current = null;
    setPromptInterpretation(null);
    setMaxExtraMinutes(null);
    setAvoidance(value);
    if (shouldRecalculate) {
      setStatus("Livello aggiornato: ricalcolo le alternative…");
      void calculateRoutes(undefined, { force: true, preferences: nextPreferences });
    }
  }

  function interpretRoutePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const interpretation = parsePromptRoutePreferences(routePrompt);
    setPromptInterpretation(interpretation);
  }

  function applyInterpretedRoutePrompt() {
    const interpretation = promptInterpretation;
    if (!interpretation || interpretation.status !== "valid" || !interpretation.preferences) return;
    promptPreferredRouteRef.current = interpretation.preferences.avoidance === "balanced"
      && interpretation.preferences.maxExtraMinutes === null
      ? "fast"
      : null;
    const nextPreferences: RoutePreferences = {
      avoidance: interpretation.preferences.avoidance,
      maxExtraMinutes: interpretation.preferences.maxExtraMinutes,
    };
    invalidateRouteIntent();
    setAvoidance(nextPreferences.avoidance);
    setMaxExtraMinutes(nextPreferences.maxExtraMinutes);
    if (promptPreferredRouteRef.current === "fast") selectActiveRoute("fast");
    setStatus("Preferenza applicata: ricalcolo il percorso…");
    void calculateRoutes(undefined, { force: true, preferences: nextPreferences });
  }

  function swapLocations() {
    const oldStart = startLocationRef.current;
    const oldStartText = startTextRef.current;
    const currentEnd = endLocationRef.current ?? endLocation;
    const currentEndText = endTextRef.current;
    discardPlannedRoute();
    cancelAddressSearch();
    startLocationRef.current = currentEnd;
    resolvedStartRef.current = currentEnd.label ? currentEnd : null;
    endLocationRef.current = oldStart;
    startTextRef.current = currentEndText;
    endTextRef.current = oldStartText;
    setStartLocation(currentEnd);
    setEndLocation(oldStart);
    setStartText(currentEndText);
    setEndText(oldStartText);
    setStatus("Partenza e destinazione invertite.");
  }

  function cancelAutocomplete() {
    if (autocompleteTimerRef.current !== null) {
      window.clearTimeout(autocompleteTimerRef.current);
      autocompleteTimerRef.current = null;
    }
    autocompleteRequestIdRef.current += 1;
    autocompleteControllerRef.current?.abort();
    autocompleteControllerRef.current = null;
    setInlineSuggestions([]);
    setInlineSuggestionTarget(null);
    setActiveSuggestionIndex(-1);
  }

  async function runAutocomplete(target: "start" | "end", query: string) {
    const trimmed = query.trim();
    if (trimmed.length < MIN_AUTOCOMPLETE_CHARS) return;
    const requestId = autocompleteRequestIdRef.current + 1;
    autocompleteRequestIdRef.current = requestId;
    autocompleteControllerRef.current?.abort();
    const controller = new AbortController();
    autocompleteControllerRef.current = controller;
    const requestedArea = areaIdRef.current;
    try {
      const results = await fetchAddresses(trimmed, controller.signal);
      const currentText = target === "start" ? startTextRef.current : endTextRef.current;
      const currentLocation = target === "start" ? startLocationRef.current : (endLocationRef.current ?? endLocation);
      if (!shouldApplyAutocompleteResponse({
        activeRequestId: autocompleteRequestIdRef.current,
        responseRequestId: requestId,
        activeAreaId: areaIdRef.current,
        responseAreaId: requestedArea,
        activeTarget: focusedAddressFieldRef.current,
        responseTarget: target,
        currentFieldText: currentText,
        requestedQuery: trimmed,
        fieldConfirmed: isConfirmedAddressField(currentText, currentLocation),
        isCalculating: loadingRef.current,
      })) {
        return;
      }
      setInlineSuggestionTarget(target);
      setInlineSuggestions(results);
      setActiveSuggestionIndex(-1);
    } catch {
      // Do not surface premature errors while the user is still typing.
      if (autocompleteRequestIdRef.current === requestId) {
        setInlineSuggestions([]);
        setInlineSuggestionTarget(null);
        setActiveSuggestionIndex(-1);
      }
    } finally {
      if (autocompleteControllerRef.current === controller) {
        autocompleteControllerRef.current = null;
      }
    }
  }

  function handleAddressInputChange(target: "start" | "end", nextValue: string) {
    discardPlannedRoute();
    cancelAddressSearch();
    focusedAddressFieldRef.current = target;
    if (target === "start") {
      const resetStart: LocationChoice = { label: "", coordinate: startLocationRef.current.coordinate };
      startTextRef.current = nextValue;
      startLocationRef.current = resetStart;
      resolvedStartRef.current = null;
      setStartText(nextValue);
      setStartLocation((current) => ({ ...current, label: "" }));
    } else {
      const currentEnd = endLocationRef.current ?? endLocation;
      const resetEnd: LocationChoice = { label: "", coordinate: currentEnd.coordinate };
      endTextRef.current = nextValue;
      endLocationRef.current = resetEnd;
      setEndText(nextValue);
      setEndLocation((current) => ({ ...current, label: "" }));
    }
    const trimmed = nextValue.trim();
    if (trimmed.length >= MIN_AUTOCOMPLETE_CHARS) {
      autocompleteTimerRef.current = window.setTimeout(() => {
        autocompleteTimerRef.current = null;
        void runAutocomplete(target, trimmed);
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    }
  }

  function chooseAddress(target: "start" | "end", result: GeocodeResult) {
    const label = result.label;
    const location = { label, coordinate: result.coordinate };
    const shouldContinue = pendingCalculationRef.current;
    const resolvedStart = resolvedStartRef.current;
    pendingCalculationRef.current = false;
    cancelAddressSearch();
    discardPlannedRoute();
    setPlanError(null);

    const nextStartLocation = target === "start" ? location : startLocationRef.current;
    const nextStartText = target === "start" ? location.label : startTextRef.current;
    const nextEndLocation = target === "end" ? location : (endLocationRef.current ?? endLocation);
    const nextEndText = target === "end" ? location.label : endTextRef.current;

    if (target === "start") {
      startLocationRef.current = location;
      resolvedStartRef.current = location;
      startTextRef.current = location.label;
      setStartLocation(location);
      setStartText(location.label);
    } else {
      endLocationRef.current = location;
      endTextRef.current = location.label;
      setEndLocation(location);
      setEndText(location.label);
    }
    focusedAddressFieldRef.current = null;
    setAddressResults([]);
    setAddressSearchTarget(null);
    setAddressQuery("");
    setStatus(`${target === "start" ? "Partenza" : "Destinazione"} confermata.`);

    // Dismiss the mobile keyboard and clear active input focus upon one-tap confirmation.
    const startInput = document.getElementById("start-search");
    const endInput = document.getElementById("end-search");
    if (startInput instanceof HTMLElement) startInput.blur();
    if (endInput instanceof HTMLElement) endInput.blur();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const autoDecision = shouldAutoCalculateAfterAddressSelection({
      target,
      selected: location,
      startText: nextStartText,
      startLocation: nextStartLocation,
      endText: nextEndText,
      endLocation: nextEndLocation,
      pendingCalculation: shouldContinue,
      isLoading: loadingRef.current,
    });
    if (autoDecision.shouldCalculate) {
      void calculateRoutes(
        autoDecision.startOverride ?? (target === "start" ? location : resolvedStart ?? undefined),
        autoDecision.endOverride ? { endOverride: autoDecision.endOverride } : (target === "end" ? { endOverride: location } : {}),
      );
    }
  }

  function closeAddressPicker() {
    pendingCalculationRef.current = false;
    cancelAutocomplete();
    setAddressResults([]);
    setAddressSearchTarget(null);
    setAddressQuery("");
    setStatus("Ricerca indirizzo chiusa.");
  }

  async function fetchAddresses(text: string, signal?: AbortSignal) {
    const trimmed = text.trim();
    if (trimmed.length < 3) throw new PlannerMessage("Inserisci almeno tre caratteri.");
    const requestedArea = areaIdRef.current;
    const cacheKey = `${requestedArea}:${trimmed.toLocaleLowerCase("it")}`;
    const cached = geocodeCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 300_000 && cached.results.length > 0) {
      return cached.results;
    }
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}&area=${requestedArea}`, { signal });
    const data = await readApiJson<{ results?: GeocodeResult[]; error?: string }>(response);
    if (signal?.aborted || requestedArea !== areaIdRef.current) throw new DOMException("Ricerca superata", "AbortError");
    if (!response.ok) throw new PlannerMessage(data.error ?? "La ricerca indirizzi non è disponibile. Riprova.");
    const results = (data.results ?? []).filter((result) => coordinateInArea(result.coordinate, PILOT_AREAS[requestedArea]));
    if (!results.length) throw new PlannerMessage(`Non trovo “${trimmed}” a ${PILOT_AREAS[requestedArea].name}.`);
    geocodeCacheRef.current.set(cacheKey, { timestamp: Date.now(), results });
    return results;
  }

  async function searchAddresses(target: "start" | "end") {
    if (addressSearchLoading) return;
    const text = target === "start" ? startTextRef.current || startText : endTextRef.current || endText;
    if (!text.trim()) {
      setStatus(`Inserisci ${target === "start" ? "la partenza" : "la destinazione"}.`);
      return;
    }
    cancelAutocomplete();
    addressRequestRef.current?.abort();
    const controller = new AbortController();
    addressRequestRef.current = controller;
    const searchTimeout = window.setTimeout(
      () => controller.abort(new DOMException("Ricerca troppo lunga", "TimeoutError")),
      ADDRESS_SEARCH_TIMEOUT_MS,
    );
    const requestedArea = areaIdRef.current;
    pendingCalculationRef.current = false;
    setPlanError(null);
    setAddressQuery(text.trim());
    setAddressSearchTarget(target);
    setAddressResults([]);
    setAddressSearchLoading(true);
    setStatus(`Cerco “${text.trim()}” a ${PILOT_AREAS[requestedArea].name}…`);
    try {
      const results = await fetchAddresses(text, controller.signal);
      if (controller.signal.aborted || requestedArea !== areaIdRef.current) return;
      setAddressResults(results);
      setStatus(`${results.length} ${results.length === 1 ? "risultato trovato" : "risultati trovati"}: scegli l’indirizzo corretto.`);
    } catch (error) {
      if (requestedArea !== areaIdRef.current || addressRequestRef.current !== controller) return;
      setAddressSearchTarget(null);
      setPlanError(controller.signal.aborted
        ? "La ricerca dell’indirizzo sta impiegando troppo tempo. Riprova."
        : plannerErrorMessage(error));
    } finally {
      window.clearTimeout(searchTimeout);
      if (addressRequestRef.current === controller) setAddressSearchLoading(false);
    }
  }

  /** Editing a field cancels its search, so a late answer cannot open a list for old text. */
  function cancelAddressSearch() {
    cancelAutocomplete();
    addressRequestRef.current?.abort();
    addressRequestRef.current = null;
    setAddressSearchLoading(false);
    setAddressSearchTarget(null);
    setAddressResults([]);
  }

  async function geocode(
    text: string,
    current: LocationChoice,
    target: "start" | "end",
    signal?: AbortSignal,
  ) {
    if (!text.trim()) return current;
    if (text.trim() === current.label) return current;
    const results = await fetchAddresses(text, signal);
    if (results.length === 1) {
      const selected = { label: results[0].label, coordinate: results[0].coordinate };
      return selected;
    }
    setAddressQuery(text.trim());
    setAddressSearchTarget(target);
    setAddressResults(results);
    throw new AddressChoiceNeeded();
  }

  async function calculateRoutes(
    startOverride?: LocationChoice,
    options: {
      mode?: TransportMode;
      preserveRoute?: "safe" | "fast";
      force?: boolean;
      journeySession?: number;
      preferences?: RoutePreferences;
      endOverride?: LocationChoice;
    } = {},
  ) {
    const isReroute = options.journeySession !== undefined;
    const currentStartText = startTextRef.current || startText;
    const currentEndText = endTextRef.current || endText;
    const currentStartLocation = startLocationRef.current ?? startLocation;
    const currentEndLocation = endLocationRef.current ?? endLocation;
    if (!navigator.onLine) {
      if (isReroute && options.journeySession === navigationSessionRef.current) {
        recalculatingRef.current = false;
        setIsRecalculating(false);
        setGpsState("offroute");
        recordDiagnostic({ type: "reroute-failure" });
        setRerouteIssue(true);
      }
      setStatus("Connessione assente.");
      if (!isReroute) {
        setPlanError(selectedRouteRef.current?.coordinates.length
          ? "Connessione assente. Il percorso già calcolato resta valido."
          : "Connessione assente. Serve la rete per calcolare un percorso.");
      }
      return;
    }
    if (!isReroute && !startOverride && !currentStartText.trim()) {
      setPlanError("Inserisci la partenza, oppure usa la tua posizione.");
      document.getElementById("start-search")?.focus();
      return;
    }
    if (!isReroute && !options.endOverride && !currentEndText.trim()) {
      setPlanError("Inserisci la destinazione.");
      document.getElementById("end-search")?.focus();
      return;
    }
    if (loadingRef.current && !options.force) return;
    if (!isReroute) cancelAddressSearch();
    routeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = routeRequestCounterRef.current + 1;
    const requestedRevision = plannerRevisionRef.current;
    const requestedPreferences = options.preferences ?? { avoidance, maxExtraMinutes };
    routeRequestCounterRef.current = requestId;
    routeRequestRef.current = { id: requestId, revision: requestedRevision, controller };
    const abortWithTimeout = () => controller.abort(new DOMException("Tempo di calcolo esaurito", "TimeoutError"));
    // Searching addresses and computing the route each get their own limit.
    let requestTimeout = window.setTimeout(abortWithTimeout, ADDRESS_SEARCH_TIMEOUT_MS * 2);
    const requestedMode = options.mode ?? transportModeRef.current;
    const requestedArea = areaIdRef.current;
    let routeSucceeded = false;
    loadingRef.current = true;
    setIsLoading(true);
    setPlanError(null);
    pendingCalculationRef.current = false;
    setStatus(isReroute
      ? `Fuori percorso · ricalcolo per ${transportMeta[requestedMode].article}…`
      : `Calcolo i percorsi per ${transportMeta[requestedMode].article}…`);
    const isCurrentRequest = () => shouldApplyRouteResponse(
      routeRequestRef.current?.id ?? -1,
      requestId,
      navigationSessionRef.current,
      options.journeySession ?? null,
      journeyActiveRef.current,
    ) && shouldApplyPlannerRouteResponse({
      activeRequestId: routeRequestRef.current?.id ?? -1,
      responseRequestId: requestId,
      activeRevision: plannerRevisionRef.current,
      responseRevision: requestedRevision,
    }) && requestedArea === areaIdRef.current && (isReroute || !journeyActiveRef.current);
    try {
      const resolvedStart = startOverride
        ?? await geocode(currentStartText, currentStartLocation, "start", controller.signal);
      resolvedStartRef.current = resolvedStart;
      if (!isReroute && isCurrentRequest()) {
        startLocationRef.current = resolvedStart;
        startTextRef.current = resolvedStart.label;
        setStartLocation(resolvedStart);
        setStartText(resolvedStart.label);
      }
      if (!startOverride && currentStartText.trim() !== currentStartLocation.label && currentEndText.trim() !== currentEndLocation.label) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 250);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(controller.signal.reason);
          }, { once: true });
        });
      }
      const resolvedEnd = options.endOverride
        ?? (options.journeySession !== undefined
          ? currentEndLocation
          : await geocode(currentEndText, currentEndLocation, "end", controller.signal));
      if (!isCurrentRequest()) return;
      if (!isReroute) {
        startLocationRef.current = resolvedStart;
        endLocationRef.current = resolvedEnd;
        startTextRef.current = resolvedStart.label;
        endTextRef.current = resolvedEnd.label;
        setStartLocation(resolvedStart);
        setEndLocation(resolvedEnd);
        setStartText(resolvedStart.label);
        setEndText(resolvedEnd.label);
        if (distanceMeters(resolvedStart.coordinate, resolvedEnd.coordinate) < MINIMUM_ROUTE_METERS) {
          throw new PlannerMessage("Partenza e destinazione coincidono. Scegli due punti diversi.");
        }
      }

      const params = new URLSearchParams({
        start: resolvedStart.coordinate.join(","),
        end: resolvedEnd.coordinate.join(","),
        avoid: requestedPreferences.avoidance,
        mode: requestedMode,
        area: requestedArea,
      });
      if (requestedPreferences.maxExtraMinutes !== null) {
        params.set("maxExtraMinutes", String(requestedPreferences.maxExtraMinutes));
      }
      if (options.journeySession !== undefined) params.set("navigation", "1");
      window.clearTimeout(requestTimeout);
      requestTimeout = window.setTimeout(abortWithTimeout, isReroute ? REROUTE_TIMEOUT_MS : ROUTE_TIMEOUT_MS);
      const response = await fetch(`/api/routes?${params}`, { signal: controller.signal });
      const data = await readApiJson<RouteApiResponse & { error?: string }>(response);
      if (!response.ok || !data.fast || !data.safe) {
        throw new PlannerMessage(data.error ?? "Non riesco a calcolare il percorso. Riprova.");
      }
      // A newer request or edit owns the screen now, and it has set its own message.
      if (!isCurrentRequest()) return;
      if (
        data.transportMode !== requestedMode
        || (data.area !== undefined && data.area !== requestedArea)
        || !routePreferencesMatch(requestedPreferences, data.appliedPreferences)
      ) throw new PlannerMessage("La risposta non corrisponde alla richiesta. Riprova.");
      if (
        !isNavigableRouteGeometry(data.fast.coordinates)
        || !isNavigableRouteGeometry(data.safe.coordinates)
      ) throw new PlannerMessage("Il percorso ricevuto non è navigabile. Riprova.");
      const nextRoute = selectRouteKind(options.preserveRoute, data.hasDistinctAlternative);
      applyRouteData(data, nextRoute, requestedMode);
      const nextSelectedRoute = nextRoute === "safe" ? data.safe : data.fast;
      navigationFixStateRef.current = withReplacementRoute(navigationFixStateRef.current, 0);
      setGpsProgress(null);
      selectedRouteRef.current = nextSelectedRoute;
      const lastPosition = navigationFixStateRef.current.position;
      if (isReroute && lastPosition && selectedRouteModelRef.current) {
        // A null anchor: the replacement route has no earlier progress to stay near.
        const replacementProgress = calculateRouteProgress(
          selectedRouteModelRef.current,
          lastPosition,
          nextSelectedRoute.minutes,
          null,
        );
        navigationFixStateRef.current = withReplacementRoute(
          navigationFixStateRef.current,
          replacementProgress.routeProgressMeters,
        );
        setGpsProgress(replacementProgress);
      }
      if (isReroute) {
        traceRecorderRef.current?.addRoute({
          progressMeters: navigationFixStateRef.current.progressMeters,
          minutes: nextSelectedRoute.minutes,
          distanceKm: nextSelectedRoute.distance,
          coordinates: nextSelectedRoute.coordinates,
          instructions: nextSelectedRoute.instructions ?? [],
        });
      } else {
        storePlan({
          areaId: requestedArea,
          mode: requestedMode,
          start: resolvedStart,
          end: resolvedEnd,
          preferences: requestedPreferences,
          activeRoute: nextRoute,
          data,
        });
      }
      const lostAlternative = isReroute && options.preserveRoute === "safe" && !data.hasDistinctAlternative;
      setStatus(lostAlternative
        ? "Da qui non c’è un’alternativa con meno pavé: seguo il percorso più rapido."
        : data.dataNotice);
      routeSucceeded = true;
      if (isReroute) {
        recalculatingRef.current = false;
        rerouteFailuresRef.current = 0;
        setRerouteIssue(false);
        recordDiagnostic({ type: "reroute-success" });
        setGpsState("live");
      }
    } catch (error) {
      if (error instanceof AddressChoiceNeeded) {
        pendingCalculationRef.current = true;
        setStatus("Scegli l’indirizzo dall’elenco.");
        return;
      }
      const timedOut = controller.signal.aborted
        && controller.signal.reason instanceof DOMException
        && controller.signal.reason.name === "TimeoutError";
      if (controller.signal.aborted && !timedOut) return;
      if (isReroute) {
        if (options.journeySession === navigationSessionRef.current) {
          recalculatingRef.current = false;
          setGpsState("offroute");
        }
        setStatus(timedOut ? "Il ricalcolo sta impiegando troppo tempo." : plannerErrorMessage(error));
        return;
      }
      if (!isCurrentRequest()) return;
      const keepsRoute = Boolean(selectedRouteRef.current?.coordinates.length);
      const message = timedOut
        ? `Il calcolo sta impiegando troppo tempo.${keepsRoute ? " Il percorso precedente resta valido." : ""}`
        : plannerErrorMessage(error);
      setPlanError(message);
      setStatus(message);
    } finally {
      window.clearTimeout(requestTimeout);
      if (routeRequestRef.current?.id === requestId) {
        loadingRef.current = false;
        recalculatingRef.current = false;
        setIsLoading(false);
        setIsRecalculating(false);
        if (isReroute && options.journeySession === navigationSessionRef.current && !routeSucceeded) {
          rerouteFailuresRef.current += 1;
          recordDiagnostic({ type: "reroute-failure" });
          setRerouteIssue(true);
          setGpsState("offroute");
        }
      }
    }
  }

  /** The person's selection wins over any default; a missing alternative falls back honestly. */
  function selectRouteKind(preserved: "safe" | "fast" | undefined, hasAlternative: boolean): "safe" | "fast" {
    if (preserved === "fast" || !hasAlternative) return "fast";
    if (preserved === "safe") return "safe";
    return promptPreferredRouteRef.current === "fast" ? "fast" : "safe";
  }

  function applyRouteData(data: RouteApiResponse, nextRoute: "safe" | "fast", mode: TransportMode) {
    setFastRoute(data.fast);
    setSafeRoute(data.safe);
    setAlternativesAnalyzed(data.alternativesAnalyzed);
    setHasDistinctAlternative(data.hasDistinctAlternative);
    setRoutingProfile(data.routingProfile);
    setDataNotice(data.dataNotice);
    setTransportMode(mode);
    transportModeRef.current = mode;
    setIsLiveResult(true);
    setRouteReady(true);
    setActivePanel("routes");
    setActiveRoute(nextRoute);
    activeRouteRef.current = nextRoute;
    const selected = nextRoute === "safe" ? data.safe : data.fast;
    selectedRouteRef.current = selected;
    selectedRouteModelRef.current = buildRouteProgressModel(selected.coordinates, selected.instructions ?? [], distanceMeters);
    setLastRecalculatedAt(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
  }

  function handleSelectPilotJourney(journey: PilotJourneyPreset) {
    if (journeyActiveRef.current) return;
    if (!navigator.onLine) {
      setPlanError("Connessione assente. Serve la rete per calcolare un percorso.");
      return;
    }
    discardPlannedRoute();
    cancelAddressSearch();
    startLocationRef.current = journey.start;
    resolvedStartRef.current = journey.start;
    endLocationRef.current = journey.end;
    startTextRef.current = journey.start.label;
    endTextRef.current = journey.end.label;
    setStartLocation(journey.start);
    setEndLocation(journey.end);
    setStartText(journey.start.label);
    setEndText(journey.end.label);
    void calculateRoutes(journey.start, { endOverride: journey.end });
  }

  function handleAddressInputFocus(target: "start" | "end") {
    focusedAddressFieldRef.current = target;
    if (inlineSuggestionTarget && inlineSuggestionTarget !== target) {
      setInlineSuggestions([]);
      setInlineSuggestionTarget(null);
      setActiveSuggestionIndex(-1);
    }
  }

  function handleAddressInputKeyDown(target: "start" | "end", event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const hasInline = inlineSuggestionTarget === target && inlineSuggestions.length > 0;
    if (hasInline && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % inlineSuggestions.length);
      return;
    }
    if (hasInline && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((prev) => (prev <= 0 ? inlineSuggestions.length - 1 : prev - 1));
      return;
    }
    if (hasInline && event.key === "Escape") {
      event.preventDefault();
      setInlineSuggestions([]);
      setInlineSuggestionTarget(null);
      setActiveSuggestionIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (hasInline && activeSuggestionIndex >= 0 && inlineSuggestions[activeSuggestionIndex]) {
        chooseAddress(target, inlineSuggestions[activeSuggestionIndex]);
        return;
      }
      void searchAddresses(target);
    }
  }

  function changeTransportMode(nextMode: TransportMode) {
    if (nextMode === transportModeRef.current || isJourneyActive) return;
    // Both endpoints filled in means a route was wanted, including after a failed attempt.
    const shouldRecalculate = Boolean(startText.trim() && endText.trim());
    const routeKind = activeRouteRef.current;
    const currentPreferences = { avoidance, maxExtraMinutes };
    discardPlannedRoute();
    transportModeRef.current = nextMode;
    setTransportMode(nextMode);
    setRoutingProfile({
      provider: "pending",
      profile: nextMode,
      approximate: false,
      notice: "Da calcolare",
    });
    if (shouldRecalculate) {
      setStatus(`Ricalcolo i percorsi per ${transportMeta[nextMode].article}…`);
      void calculateRoutes(undefined, {
        mode: nextMode,
        preserveRoute: routeKind,
        force: true,
        preferences: currentPreferences,
      });
    } else {
      setActivePanel("plan");
      setStatus(`${transportMeta[nextMode].label} selezionata.`);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("La posizione non è disponibile su questo dispositivo.");
      return;
    }
    const requestedArea = areaIdRef.current;
    const requestedRevision = plannerRevisionRef.current;
    setStatus("Sto rilevando la tua posizione…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate: Coordinate = [coords.longitude, coords.latitude];
        if (requestedArea !== areaIdRef.current || requestedRevision !== plannerRevisionRef.current) return;
        if (!coordinateInArea(coordinate, PILOT_AREAS[requestedArea])) {
          setPlanError(`La tua posizione è fuori dall’area di ${PILOT_AREAS[requestedArea].name}. Cambia città se necessario.`);
          return;
        }
        const location = { label: CURRENT_POSITION_LABEL, coordinate };
        discardPlannedRoute();
        cancelAddressSearch();
        startLocationRef.current = location;
        resolvedStartRef.current = location;
        startTextRef.current = location.label;
        setStartLocation(location);
        setStartText(location.label);
        setStatus("Posizione impostata come partenza.");
      },
      () => {
        if (requestedArea === areaIdRef.current && requestedRevision === plannerRevisionRef.current) {
          setPlanError("Non ho potuto accedere alla posizione. Controlla i permessi di localizzazione o scrivi un indirizzo.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function requestWakeLock(session = navigationSessionRef.current) {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (
      !wakeLock
      || document.visibilityState !== "visible"
      || (wakeLockRef.current && !wakeLockRef.current.released)
      || wakeLockPendingSessionRef.current === session
    ) return;
    wakeLockPendingSessionRef.current = session;
    try {
      const handle = await wakeLock.request("screen");
      if (!journeyActiveRef.current || session !== navigationSessionRef.current) {
        await handle.release();
        return;
      }
      wakeLockRef.current = handle;
      recordDiagnostic({ type: "wake-lock", active: true });
    } catch {
      wakeLockRef.current = null;
      recordDiagnostic({ type: "wake-lock", active: false });
    } finally {
      if (wakeLockPendingSessionRef.current === session) wakeLockPendingSessionRef.current = null;
    }
  }

  function finishNavigation(hasArrived = false) {
    journeyActiveRef.current = false;
    recalculatingRef.current = false;
    navigationSessionRef.current += 1;
    journeyModeRef.current = null;
    if (journeyWatchRef.current !== null) {
      navigator.geolocation.clearWatch(journeyWatchRef.current);
      journeyWatchRef.current = null;
    }
    if (simulationTimerRef.current !== null) {
      window.clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    routeRequestRef.current?.controller.abort();
    routeRequestRef.current = null;
    loadingRef.current = false;
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
    wakeLockPendingSessionRef.current = null;
    window.speechSynthesis?.cancel();
    setIsJourneyActive(false);
    setIsLoading(false);
    setDirectionsOpen(false);
    setJourneyMode(null);
    setGpsState("idle");
    setIsRecalculating(false);
    setRerouteIssue(false);
    setHasGpsFix(false);
    setGpsAcquireIssue(null);
    setStartupNoticeVisible(false);
    setResumeOffer(null);
    setStoredPlanJourney(null);
    rerouteFailuresRef.current = 0;
    setJourneyPosition(null);
    setJourneyAccuracy(null);
    setJourneyHeading(0);
    setFollowVehicle(true);
    setArrived(hasArrived);
    setNavigationDiagnostics(createNavigationDiagnostics());
    lastJourneyOriginRef.current = null;
    navigationFixStateRef.current = createNavigationFixState();
    setGpsProgress(null);
    traceRecorderRef.current?.stop();
    traceRecorderRef.current = null;
    setTraceStatus("idle");
    setTraces(listGpsTraces(traceStorage()));
    navigationStartedAtRef.current = 0;
    lastValidGpsFixAtRef.current = null;
    gpsStallReportedRef.current = false;
    lastSpokenInstructionRef.current = "";
    cameraLastUpdateRef.current = 0;
    cameraLastCenterRef.current = null;
    cameraLastHeadingRef.current = 0;
    const finishedMap = mapRef.current;
    finishedMap?.easeTo({
      pitch: 0,
      bearing: 0,
      duration: 450,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    if (hasArrived) {
      speakInstruction("Sei arrivato a destinazione");
      setStatus("Arrivo raggiunto. Navigazione terminata.");
    } else {
      setStatus("Navigazione terminata. La posizione non è stata conservata.");
    }
  }

  function handleGpsFix(fix: GpsFix, session: number) {
    if (
      !journeyActiveRef.current
      || journeyModeRef.current !== "gps"
      || session !== navigationSessionRef.current
    ) return;
    const now = Date.now();
    const activeArea = PILOT_AREAS[areaIdRef.current];
    const routeResult = selectedRouteRef.current;
    const routeModel = selectedRouteModelRef.current;
    const mode = transportModeRef.current;
    const context = {
      now,
      mode,
      rerouteCooldownMs: rerouteCooldownMs(rerouteFailuresRef.current),
      bounds: activeArea.bounds,
      route: routeResult && routeModel
        ? { model: routeModel, minutes: routeResult.minutes, distanceKm: routeResult.distance }
        : null,
      lastCalculationAt: lastJourneyCalculationRef.current,
      calculationInProgress: loadingRef.current,
    };
    const decision = processGpsFix(navigationFixStateRef.current, fix, context);
    navigationFixStateRef.current = decision.state;
    const recorder = traceRecorderRef.current;
    if (recorder) {
      recorder.recordFix(fix, context, decision);
      setTraceStatus(recorder.status);
    }

    if (decision.outcome === "outside") {
      recordDiagnostic({ type: "fix-rejected", reason: "outside" });
      setGpsState("outside");
      setStatus(`Posizione fuori dall’area pilota di ${activeArea.name}.`);
      return;
    }
    if (decision.outcome === "rejected") {
      recordDiagnostic({ type: "fix-rejected", reason: decision.reason });
      // The browser repeating a fix says nothing about signal quality.
      if (decision.reason === "duplicate") return;
      setGpsState("weak");
      setJourneyAccuracy(fix.accuracy);
      // iOS reports kilometres of error when Precise Location is off for the site.
      // Once navigating, the same reading is only a moment of weak signal.
      if (decision.reason === "invalid" && fix.accuracy > 200 && lastValidGpsFixAtRef.current === null) {
        setGpsAcquireIssue("imprecise");
      }
      setStatus(decision.reason === "invalid"
        ? `Segnale GPS debole (±${Math.round(fix.accuracy)} m). Mantengo l’ultimo percorso.`
        : "Posizione GPS non affidabile o non recente. Mantengo l’ultimo punto valido.");
      return;
    }

    lastValidGpsFixAtRef.current = now;
    gpsStallReportedRef.current = false;
    setHasGpsFix(true);
    setGpsAcquireIssue(null);
    recordDiagnostic({ type: "fix-accepted" });
    if (decision.markerMoved) setJourneyPosition(decision.position);
    setJourneyAccuracy(fix.accuracy);
    setJourneyHeading(decision.heading);
    if (!recalculatingRef.current) setGpsState("live");
    if (!decision.progress) return;
    setGpsProgress(decision.progress);
    if (decision.arrived) {
      finishNavigation(true);
      return;
    }

    if (decision.offRouteStarted) recordDiagnostic({ type: "off-route" });
    if (decision.state.offRouteReadings > 0 && !recalculatingRef.current) {
      setGpsState("offroute");
    } else if (decision.progress.offRouteMeters < 30) {
      // Back on the route: an earlier failed reroute no longer matters.
      rerouteFailuresRef.current = 0;
      setRerouteIssue(false);
    }
    if (decision.shouldRecalculate) {
      if (!navigator.onLine) {
        recalculatingRef.current = false;
        setIsRecalculating(false);
        setGpsState("offroute");
        recordDiagnostic({ type: "reroute-failure" });
        setRerouteIssue(true);
        setStatus("Fuori percorso, ma sei offline. Mantengo l’ultimo percorso.");
        return;
      }
      lastJourneyCalculationRef.current = now;
      lastJourneyOriginRef.current = decision.position;
      recalculatingRef.current = true;
      setIsRecalculating(true);
      setGpsState("recalculating");
      recordDiagnostic({ type: "reroute-start" });
      setRerouteIssue(false);
      setStatus(`Fuori percorso · ricalcolo per ${transportMeta[mode].article}…`);
      void calculateRoutes(
        { label: "Posizione GPS live", coordinate: decision.position },
        {
          mode,
          preserveRoute: activeRouteRef.current,
          force: true,
          journeySession: session,
          preferences: navigationPreferencesRef.current,
        },
      );
      return;
    }

    if (!recalculatingRef.current) {
      setStatus(`GPS attivo · precisione ±${Math.round(fix.accuracy)} m · ${formatDistance(decision.progress.remainingMeters)} rimanenti.`);
    }
  }

  function startNavigation(mode: JourneyMode) {
    const routeForJourney = selectedRouteRef.current ?? selectedRoute;
    const modelForJourney = selectedRouteModelRef.current ?? selectedRouteModel;
    if (!routeReady || !isLiveResult || !isNavigableRouteGeometry(routeForJourney.coordinates)) {
      setPlanError("Ricalcola il percorso prima di avviare la navigazione.");
      return;
    }
    if (journeyActiveRef.current) return;
    setPlanError(null);
    setResumeOffer(null);
    setRerouteIssue(false);
    setHasGpsFix(false);
    setGpsAcquireIssue(null);
    rerouteFailuresRef.current = 0;
    setStoredPlanJourney(mode);
    setStartupNoticeVisible(true);
    window.setTimeout(() => setStartupNoticeVisible(false), 6_000);
    setPickingMode(null);
    setMenuOpen(false);
    setReportModalOpen(false);
    setReportStart(null);
    setReportEnd(null);
    setReportSubmitError("");
    setDirectionsOpen(false);
    // The panel opened to reach the recorder would otherwise cover the map during the drive.
    setShowDiagnostics(false);
    const session = navigationSessionRef.current + 1;
    navigationSessionRef.current = session;
    journeyModeRef.current = mode;
    recalculatingRef.current = false;
    navigationStartedAtRef.current = Date.now();
    lastValidGpsFixAtRef.current = null;
    gpsStallReportedRef.current = false;
    setNavigationDiagnostics(createNavigationDiagnostics());
    setArrived(false);
    setFollowVehicle(true);
    setJourneyMode(mode);
    setIsJourneyActive(true);
    journeyActiveRef.current = true;
    setJourneyPosition(null);
    setJourneyAccuracy(null);
    setJourneyHeading(0);
    navigationFixStateRef.current = createNavigationFixState();
    setGpsProgress(null);
    selectedRouteRef.current = routeForJourney;
    selectedRouteModelRef.current = modelForJourney;
    endLocationRef.current = endLocation;
    lastJourneyCalculationRef.current = 0;
    lastSpokenInstructionRef.current = "";
    cameraLastUpdateRef.current = 0;
    cameraLastCenterRef.current = null;
    cameraLastHeadingRef.current = 0;
    navigationPreferencesRef.current = { avoidance, maxExtraMinutes };
    void requestWakeLock(session);
    const currentTransport = transportMeta[transportModeRef.current];
    speakInstruction(mode === "simulation"
      ? `Simulazione del percorso Lastrico in ${currentTransport.label.toLowerCase()}`
      : `Navigazione Lastrico in ${currentTransport.label.toLowerCase()} avviata`);

    if (mode === "simulation") {
      setGpsState("idle");
      const coordinates = routeForJourney.coordinates;
      setJourneyPosition(coordinates[0]);
      setJourneyHeading(coordinates.length > 1 ? bearingBetween(coordinates[0], coordinates[1]) : 0);
      setJourneyAccuracy(5);
      setStatus(`SIMULAZIONE ${currentTransport.short} · avanzamento automatico senza GPS.`);
      return;
    }
    if (!navigator.geolocation) {
      finishNavigation();
      setGpsState("unavailable");
      setPlanError("Il GPS non è disponibile su questo dispositivo. Puoi usare la simulazione.");
      return;
    }
    if (traceEnabled) {
      const recorder = createGpsTraceRecorder(traceStorage());
      recorder.start({
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        area: areaIdRef.current,
        mode: transportModeRef.current,
      });
      recorder.addRoute({
        progressMeters: 0,
        minutes: routeForJourney.minutes,
        distanceKm: routeForJourney.distance,
        coordinates: routeForJourney.coordinates,
        instructions: routeForJourney.instructions ?? [],
      });
      traceRecorderRef.current = recorder;
      setTraceStatus(recorder.status);
    }
    setGpsState("requesting");
    setStatus("Autorizza la posizione precisa: aggancio il GPS al percorso Lastrico…");
    armGpsWatch(session);
  }

  function armGpsWatch(session: number) {
    if (journeyWatchRef.current !== null) navigator.geolocation.clearWatch(journeyWatchRef.current);
    lastWatchArmedAtRef.current = Date.now();
    journeyWatchRef.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => handleGpsFix({
        coordinate: [coords.longitude, coords.latitude],
        accuracy: coords.accuracy,
        timestamp,
        heading: coords.heading,
        speed: coords.speed,
      }, session),
      (error) => {
        if (session !== navigationSessionRef.current) return;
        if (error.code === error.PERMISSION_DENIED) {
          finishNavigation();
          recordDiagnostic({ type: "permission-denied" });
          setGpsState("unavailable");
          setPlanError("Permesso di posizione negato. Attivalo nelle impostazioni del browser e riprova, oppure usa la simulazione.");
          return;
        }
        recordDiagnostic({ type: "signal-loss" });
        setGpsState("temporarily-unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 },
    );
  }

  function rearmGpsWatch(force = false) {
    if (!journeyActiveRef.current || journeyModeRef.current !== "gps" || !navigator.geolocation) return;
    if (!force && Date.now() - lastWatchArmedAtRef.current < GPS_REARM_INTERVAL_MS) return;
    armGpsWatch(navigationSessionRef.current);
  }

  async function exportGpsTrace(id: string) {
    traceRecorderRef.current?.flush();
    const storage = traceStorage();
    const trace = storage && readGpsTrace(storage, id);
    if (!trace) {
      setStatus("Non riesco a leggere questa traccia dal dispositivo.");
      return;
    }
    const name = `lastrico-gps-trace-${trace.startedAt.slice(0, 16).replace(/[:T]/g, "-")}.json`;
    const file = new File([JSON.stringify(trace)], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Traccia GPS Lastrico" });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function removeGpsTrace(id: string) {
    const storage = traceStorage();
    if (!storage) return;
    deleteGpsTrace(storage, id);
    setTraces(listGpsTraces(storage));
    setStatus("Traccia GPS eliminata dal dispositivo.");
  }

  function recenterNavigation() {
    setFollowVehicle(true);
    if (journeyPosition) {
      const map = mapRef.current;
      map?.easeTo({
        padding: map ? vehicleCameraPadding(map.getContainer()) : undefined,
        center: journeyPosition,
        zoom: 16.6,
        pitch: 42,
        bearing: journeyHeading,
        duration: 450,
      });
    }
  }

  async function shareBeta() {
    const shareData = {
      title: `Lastrico — ${area.name}`,
      text: `Prova la beta che confronta il percorso rapido con quello che riduce il pavé noto a ${area.name}.`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setStatus("Link della beta condiviso.");
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setStatus("Link della beta copiato.");
      }
    } catch {
      setStatus("Condivisione annullata.");
    }
  }

  function cycleTheme() {
    setThemeMode((current) => current === "auto" ? "light" : current === "light" ? "dark" : "auto");
  }

  function openExternalMap(provider: "apple" | "google" | "waze") {
    const [lng, lat] = endLocation.coordinate;
    const mode = transportModeRef.current;
    if (mode === "bicycle" && provider !== "google") {
      setStatus("Per la bici, in questa beta il fallback verificato è Google Maps.");
      return;
    }
    const googleTravelMode = mode === "bicycle" ? "bicycling" : "driving";
    const urls = {
      apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${googleTravelMode}`,
      waze: `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`,
    };
    window.open(urls[provider], "_blank", "noopener,noreferrer");
    setMapChooserOpen(false);
    setStatus("L’app esterna ricalcolerà il proprio percorso verso la destinazione.");
  }

  function startReport() {
    if (areaIdRef.current !== "milan") {
      setFieldFeedbackOpen(true);
      return;
    }
    if (isJourneyActive) {
      setStatus("Per sicurezza, termina la navigazione prima di segnalare una strada.");
      return;
    }
    setDirectionsOpen(false);
    setReportStart(null);
    setReportEnd(null);
    setReportKind("pave");
    setReportSeverity(2);
    setReportNote("");
    setReportSubmitError("");
    setReportModalOpen(false);
    setPickingMode("reportStart");
    setStatus("Clicca il punto iniziale del tratto da segnalare.");
    setActivePanel("community");
  }

  function cancelReport() {
    setPickingMode(null);
    setReportStart(null);
    setReportEnd(null);
    setReportModalOpen(false);
    setReportSubmitError("");
    setStatus("Segnalazione annullata.");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportStart || !reportEnd || isSubmittingReport) return;
    setIsSubmittingReport(true);
    setReportSubmitError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: reportStart,
          end: reportEnd,
          kind: reportKind,
          severity: reportSeverity,
          note: reportNote,
          website: "",
        }),
      });
      const data = await response.json() as { report?: RoadReport; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error ?? "Salvataggio non riuscito.");
      const created = data.report;
      setReportModalOpen(false);
      setPickingMode(null);
      setReportStart(null);
      setReportEnd(null);
      setReportNote("");
      if (reportsAvailable) {
        setReportStats((current) => ({
          total: current.total + 1,
          pending: current.pending + 1,
          verified: current.verified,
          communityMeters: current.communityMeters,
        }));
      }
      setStatus(`Segnalazione #${created.id} ricevuta: sarà pubblicata sulla mappa solo dopo la verifica.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Non è stato possibile salvare la segnalazione.";
      setReportSubmitError(message);
      setStatus(message);
    } finally {
      setIsSubmittingReport(false);
    }
  }

  const planCalculating = isLoading && !isJourneyActive;
  const transportIcons: Record<TransportMode, IconName> = { car: "car", motorcycle: "motorcycle", bicycle: "bicycle" };
  const maneuverIcon = directionIcon(navigationProgress.instruction?.direction);
  const atFinalStep = navigationProgress.instruction?.direction === "arrive";
  const voiceLabel = !voiceAvailable ? "Voce non disponibile" : voiceEnabled ? "Disattiva la voce" : "Attiva la voce";

  return (
    <main
      className={`app-shell ${isJourneyActive ? "journey-active" : ""} ${picking ? "map-picking-active" : ""} ${
        (activePanel === "plan" && preferencesOpen) || (activePanel === "routes" && routeDetailsOpen) || activePanel === "community"
          ? "sheet-expanded"
          : ""
      }`}
      data-testid="app-shell"
      data-phase={navigationPhase}
      data-panel={activePanel}
    >
      <section className="map-stage" id="map-stage" aria-label="Mappa dei percorsi">
        <div ref={mapContainer} className="map" />
        {mapLoadIssue && !isJourneyActive && (
          <p className="map-load-issue" role="status" data-testid="map-load-issue" data-map-overlay="top">
            La mappa non si carica: controlla la connessione. Percorsi e indicazioni funzionano lo stesso.
          </p>
        )}
        {isLiveResult && !isJourneyActive && !picking && (
          <div className="map-key" aria-label="Legenda della mappa" data-map-overlay={mapKeyAtBottom ? undefined : "top"}>
            <span><i className="line selected" /> Selezionato</span>
            {hasDistinctAlternative && <span><i className="line alternative" /> Alternativa</span>}
            <span><i className="line pave" /> Pavé</span>
            {reports.length > 0 && areaId === "milan" && <span><i className="line community" /> Segnalazioni</span>}
          </div>
        )}
      </section>

      {picking && (
        <div className="map-pick-banner" role="status" data-map-overlay="top">
          <span>
            {picking === "reportStart"
              ? "Tocca l’inizio del tratto"
              : picking === "reportEnd"
                ? "Tocca la fine del tratto"
                : `Tocca la mappa per scegliere la ${picking === "start" ? "partenza" : "destinazione"}`}
          </span>
          <button
            type="button"
            className="secondary-action"
            onClick={picking === "reportStart" || picking === "reportEnd" ? cancelReport : () => setPickingMode(null)}
          >
            Annulla
          </button>
        </div>
      )}

      {!isJourneyActive && !picking && (
        <header className="top-bar" data-map-overlay="top">
          <button className="brand" type="button" onClick={() => setActivePanel(isLiveResult ? "routes" : "plan")} aria-label="Lastrico, torna al percorso">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>lastrico</span>
          </button>
          <span className="top-bar-spacer" />
          <div className="city-select">
            <label htmlFor="pilot-area" className="visually-hidden">Area pilota</label>
            <select
              id="pilot-area"
              data-testid="pilot-area"
              value={areaId}
              onChange={(event) => { if (isPilotAreaId(event.target.value)) changeArea(event.target.value); }}
              disabled={isJourneyActive}
            >
              <option value="milan">Milano</option>
              <option value="roccella">Roccella Ionica</option>
            </select>
            <Icon name="chevronDown" size={16} />
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Apri il menu"
            aria-haspopup="dialog"
            data-testid="app-menu-button"
          >
            <Icon name="menu" />
          </button>
        </header>
      )}

      {!isJourneyActive && !picking && (
        <aside className="control-panel" aria-label="Pannello percorso" data-map-overlay="">
          {activePanel === "plan" && (
            <section className="planner-panel" data-testid="planner-panel">
              <div className="sheet-body">
                <h1 className="visually-hidden">Dove andiamo?</h1>
                <div className="address-search-group" ref={routeFieldsRef}>
                  <div className="route-fields">
                    <div className={`route-field ${addressSearchTarget === "start" || inlineSuggestionTarget === "start" ? "searching" : ""}`}>
                      <i className="origin-dot" aria-hidden="true" />
                      <label htmlFor="start-search">Partenza</label>
                      <input
                        id="start-search"
                        value={startText}
                        onFocus={() => handleAddressInputFocus("start")}
                        onChange={(event) => handleAddressInputChange("start", event.target.value)}
                        onKeyDown={(event) => handleAddressInputKeyDown("start", event)}
                        placeholder="Via, numero civico o luogo"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        enterKeyHint="search"
                        spellCheck={false}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={(addressSearchTarget === "start" && addressResults.length > 0) || (inlineSuggestionTarget === "start" && inlineSuggestions.length > 0)}
                        aria-controls="start-address-results"
                        aria-activedescendant={inlineSuggestionTarget === "start" && activeSuggestionIndex >= 0 ? `start-suggestion-${activeSuggestionIndex}` : undefined}
                      />
                      <button
                        type="button"
                        onClick={startText.trim() ? () => void searchAddresses("start") : useCurrentLocation}
                        aria-label={startText.trim() ? "Cerca indirizzo di partenza" : "Usa posizione GPS"}
                      >
                        {addressSearchLoading && addressSearchTarget === "start"
                          ? <span className="spinner" aria-hidden="true" />
                          : <Icon name={startText.trim() ? "search" : "locate"} />}
                      </button>
                    </div>
                    <button type="button" className="swap-button" onClick={swapLocations} aria-label="Inverti partenza e destinazione">
                      <Icon name="swap" size={18} />
                    </button>
                    <div className={`route-field ${addressSearchTarget === "end" || inlineSuggestionTarget === "end" ? "searching" : ""}`}>
                      <i className="destination-dot" aria-hidden="true" />
                      <label htmlFor="end-search">Destinazione</label>
                      <input
                        id="end-search"
                        value={endText}
                        onFocus={() => handleAddressInputFocus("end")}
                        onChange={(event) => handleAddressInputChange("end", event.target.value)}
                        onKeyDown={(event) => handleAddressInputKeyDown("end", event)}
                        placeholder="Via, numero civico o luogo"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        enterKeyHint="search"
                        spellCheck={false}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={(addressSearchTarget === "end" && addressResults.length > 0) || (inlineSuggestionTarget === "end" && inlineSuggestions.length > 0)}
                        aria-controls="end-address-results"
                        aria-activedescendant={inlineSuggestionTarget === "end" && activeSuggestionIndex >= 0 ? `end-suggestion-${activeSuggestionIndex}` : undefined}
                      />
                      <button type="button" onClick={() => void searchAddresses("end")} aria-label="Cerca indirizzo di destinazione">
                        {addressSearchLoading && addressSearchTarget === "end"
                          ? <span className="spinner" aria-hidden="true" />
                          : <Icon name="search" />}
                      </button>
                    </div>
                  </div>
                  {inlineSuggestionTarget && inlineSuggestions.length > 0 && !addressSearchTarget && (
                    <div
                      id={inlineSuggestionTarget === "start" ? "start-address-results" : "end-address-results"}
                      className="address-suggestions"
                      role="listbox"
                      data-testid="address-suggestions"
                      data-target={inlineSuggestionTarget}
                      aria-label={inlineSuggestionTarget === "start" ? "Indirizzi di partenza" : "Indirizzi di destinazione"}
                    >
                      {inlineSuggestions.map((result, index) => (
                        <button
                          type="button"
                          role="option"
                          id={`${inlineSuggestionTarget}-suggestion-${index}`}
                          aria-selected={activeSuggestionIndex === index}
                          key={result.id}
                          className={`address-suggestion-option ${activeSuggestionIndex === index ? "active" : ""}`}
                          data-testid={`address-suggestion-${index}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseAddress(inlineSuggestionTarget, result)}
                        >
                          <b>{result.primary}</b>
                          <small>{result.secondary || area.name}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  className="transport-selector"
                  role="radiogroup"
                  aria-label="Mezzo di trasporto"
                  data-testid="transport-selector"
                >
                  {(["car", "motorcycle", "bicycle"] as TransportMode[]).map((mode) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={transportMode === mode}
                      data-transport={mode}
                      className={transportMode === mode ? "active" : ""}
                      disabled={isJourneyActive}
                      onClick={() => changeTransportMode(mode)}
                      key={mode}
                    >
                      <Icon name={transportIcons[mode]} />
                      {transportMeta[mode].label}
                    </button>
                  ))}
                </div>

                {planError && (
                  <div className="plan-alert" role="alert" data-testid="plan-error">
                    <Icon name="warning" />
                    <p>{planError}</p>
                  </div>
                )}

                <button
                  type="button"
                  className="disclosure"
                  onClick={() => setPreferencesOpen((open) => !open)}
                  aria-expanded={preferencesOpen}
                  data-testid="preferences-toggle"
                >
                  <span>Preferenze e percorsi suggeriti</span>
                  <Icon name={preferencesOpen ? "chevronUp" : "chevronDown"} size={18} />
                </button>

                {preferencesOpen && (
                  <div className="preferences">
                    <div className="preference-group">
                      <span className="preference-label">Quanto evitare il pavé?</span>
                      <div className="segmented" role="group" aria-label="Livello di evitamento">
                        {([
                          ["balanced", "Bilanciato"],
                          ["strong", "Forte"],
                          ["maximum", "Massimo"],
                        ] as [Avoidance, string][]).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={avoidance === value ? "active" : ""}
                            aria-pressed={avoidance === value}
                            onClick={() => setManualAvoidance(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <small>Più forte può significare qualche minuto in più.</small>
                    </div>

                    <div className="preference-group">
                      <span className="preference-label">Scegli sulla mappa</span>
                      <div className="location-tools">
                        <button type="button" onClick={() => setPickingMode("start")}><Icon name="pin" size={18} />Partenza</button>
                        <button type="button" onClick={() => setPickingMode("end")}><Icon name="pin" size={18} />Destinazione</button>
                      </div>
                    </div>

                    <div className="preference-group pilot-journeys-container" role="region" aria-label="Itinerari di collaudo">
                      <span className="preference-label">Percorsi suggeriti a {area.name}</span>
                      <div className="pilot-journeys-chips">
                        {getPilotJourneys(areaId).map((journey) => (
                          <button
                            key={journey.id}
                            type="button"
                            className="pilot-journey-chip"
                            onClick={() => handleSelectPilotJourney(journey)}
                            title={journey.description}
                            disabled={isJourneyActive || isLoading}
                            data-testid={`pilot-journey-${journey.id}`}
                          >
                            {journey.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <form className="route-prompt preference-group" onSubmit={interpretRoutePrompt} data-testid="route-prompt-demo">
                      <label htmlFor="route-preference-prompt" className="preference-label">Descrivi la tua preferenza</label>
                      <small>Comprende solo pavé e minuti extra. Interprete locale, non AI.</small>
                      <div className="route-prompt-entry">
                        <textarea
                          id="route-preference-prompt"
                          value={routePrompt}
                          onChange={(event) => {
                            setRoutePrompt(event.target.value);
                            setPromptInterpretation(null);
                          }}
                          placeholder="Es. Evita il pavé con massimo 8 minuti in più"
                          rows={2}
                          maxLength={180}
                        />
                        <button type="submit" className="secondary-action">Interpreta</button>
                      </div>
                      {promptInterpretation && (
                        <div className={promptInterpretation.status === "valid" ? "prompt-result valid" : "prompt-result error"}>
                          <p role={promptInterpretation.status === "valid" ? "status" : "alert"}>
                            {promptInterpretation.status === "valid" && promptInterpretation.preferences
                              ? `${promptInterpretation.preferences.avoidance === "maximum" ? "Evitamento massimo" : promptInterpretation.preferences.avoidance === "strong" ? "Evitamento forte" : "Priorità al percorso rapido"}${promptInterpretation.preferences.maxExtraMinutes === null ? "" : ` · massimo +${promptInterpretation.preferences.maxExtraMinutes} min`}`
                              : promptErrorCopy(promptInterpretation)}
                          </p>
                          {promptInterpretation.recognizedConstraints.length > 0 && (
                            <small className="prompt-constraints">
                              Riconosciuto: {promptInterpretation.recognizedConstraints.map((constraint) => String(constraint.value)).join(" · ")}
                            </small>
                          )}
                          {promptInterpretation.status === "valid" && (
                            <button type="button" className="secondary-action" onClick={applyInterpretedRoutePrompt}>Applica al percorso</button>
                          )}
                        </div>
                      )}
                    </form>
                  </div>
                )}
              </div>
              <div className="sheet-footer">
                <button
                  type="button"
                  className="primary-action"
                  data-testid="calculate-routes"
                  onClick={() => void calculateRoutes()}
                  disabled={isLoading}
                  aria-busy={planCalculating}
                >
                  {planCalculating && <span className="spinner" aria-hidden="true" />}
                  <span>{planCalculating ? "Analizzo le strade…" : "Confronta i percorsi"}</span>
                </button>
              </div>
            </section>
          )}

          {activePanel === "routes" && (
            <section
              className="routes-panel"
              data-testid="route-panel"
              data-transport={transportMode}
              aria-label={`Percorso ${transportMeta[transportMode].label}`}
            >
              <div className="sheet-body">
                <div className="routes-heading">
                  <button type="button" className="icon-button" onClick={() => setActivePanel("plan")} aria-label="Modifica il percorso" data-testid="edit-route">
                    <Icon name="chevronLeft" />
                  </button>
                  <div>
                    <h2>Percorsi in {transportMeta[transportMode].label.toLowerCase()}</h2>
                    <p>{pluralize(alternativesAnalyzed, "percorso confrontato", "percorsi confrontati")}{lastRecalculatedAt ? ` · ${lastRecalculatedAt}` : ""}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void calculateRoutes(undefined, { preserveRoute: activeRoute })}
                    disabled={isLoading}
                    aria-label="Ricalcola i percorsi"
                    data-testid="recalculate-routes"
                  >
                    {isLoading ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" />}
                  </button>
                </div>

                {resumeOffer && (
                  <div className="plan-alert info" role="status" data-testid="resume-offer">
                    <Icon name="info" />
                    <p>La navigazione si è interrotta quando la pagina è stata ricaricata.</p>
                    <button type="button" className="secondary-action" onClick={() => startNavigation(resumeOffer)} disabled={!routeReady}>Riprendi</button>
                  </div>
                )}

                {planError && (
                  <div className="plan-alert" role="alert" data-testid="plan-error">
                    <Icon name="warning" />
                    <p>{planError}</p>
                  </div>
                )}

                <RouteComparisonPanel
                  fastRoute={fastRoute}
                  safeRoute={safeRoute}
                  hasDistinctAlternative={hasDistinctAlternative}
                  activeRoute={activeRoute}
                  onSelectRoute={selectActiveRoute}
                  transportMode={transportMode}
                  extraTimeBudgetMinutes={maxExtraMinutes}
                />

                <button
                  type="button"
                  className="disclosure"
                  onClick={() => setRouteDetailsOpen((open) => !open)}
                  aria-expanded={routeDetailsOpen}
                  data-testid="route-details-toggle"
                >
                  <span>Fondo stradale e altre opzioni</span>
                  <Icon name={routeDetailsOpen ? "chevronUp" : "chevronDown"} size={18} />
                </button>

                {routeDetailsOpen && (
                  <div className="route-details">
                    <SurfaceBreakdown
                      route={selectedRoute}
                      isLiveResult={isLiveResult}
                      activeRoute={activeRoute}
                      transportMode={transportMode}
                    />
                    <p className="profile-note">{dataNotice ? `${dataNotice}. ` : ""}{routingProfile.notice} Tempi senza traffico in tempo reale.</p>
                    <div className="route-actions">
                      <button type="button" className="secondary-action" onClick={() => startNavigation("simulation")} disabled={!routeReady || isLoading} data-testid="start-simulation">
                        <Icon name="play" size={18} />Simula il percorso
                      </button>
                      <button type="button" className="secondary-action" onClick={() => setMapChooserOpen(true)} data-testid="open-external-map">
                        <Icon name="external" size={18} />Apri in un’altra app
                      </button>
                    </div>
                    <div className="p43-diagnostics-toggle-container">
                      <button
                        type="button"
                        className="disclosure subtle"
                        onClick={() => setShowDiagnostics((prev) => !prev)}
                        aria-expanded={showDiagnostics}
                        data-testid="toggle-diagnostics-btn"
                      >
                        <span>Dettagli tecnici e registrazione GPS</span>
                        <Icon name={showDiagnostics ? "chevronUp" : "chevronDown"} size={18} />
                      </button>
                      {showDiagnostics && (
                        <>
                          <NavigationDiagnosticsCard
                            diagnostics={navigationDiagnostics}
                            gpsState={gpsState}
                            journeyMode={journeyMode}
                            isOnline={isOnline}
                            onResetDiagnostics={() => setNavigationDiagnostics(createNavigationDiagnostics())}
                          />
                          <GpsTraceControls
                            enabled={traceEnabled}
                            status={traceStatus}
                            traces={traces}
                            journeyActive={isJourneyActive}
                            onToggle={setTraceEnabled}
                            onExport={(id) => void exportGpsTrace(id)}
                            onDelete={removeGpsTrace}
                          />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="sheet-footer route-footer">
                <button
                  type="button"
                  className={`icon-button voice-toggle ${voiceEnabled ? "active" : ""}`}
                  onClick={toggleVoiceGuidance}
                  aria-pressed={voiceEnabled}
                  aria-label={!voiceAvailable ? "Voce non disponibile" : voiceEnabled ? "Voce attiva" : "Voce disattivata"}
                  title={voiceLabel}
                  disabled={!voiceAvailable}
                  data-testid="voice-toggle"
                >
                  <Icon name={voiceEnabled ? "volumeOn" : "volumeOff"} />
                </button>
                <button
                  type="button"
                  className="primary-action journey-button"
                  data-testid="start-navigation"
                  onClick={routeReady ? () => startNavigation("gps") : () => void calculateRoutes()}
                  disabled={!routeReady || isLoading}
                  aria-busy={planCalculating}
                >
                  {planCalculating
                    ? <span className="spinner" aria-hidden="true" />
                    : <Icon name={routeReady ? "recenter" : "refresh"} />}
                  <span><b>{routeReady ? "Avvia navigazione" : "Ricalcola per navigare"}</b></span>
                  <small className="visually-hidden">{routeReady ? "Avvia con GPS · La freccia segue la tua posizione reale" : "Il percorso mostrato non è più aggiornato"}</small>
                </button>
              </div>
              {/* Azioni secondarie nel pannello Fondo stradale e altre opzioni: Simula percorso · Fallback mappe */}
            </section>
          )}

          {activePanel === "community" && (
            <section className="community-sheet" data-testid="community-sheet">
              <div className="sheet-body">
                <div className="routes-heading">
                  <button type="button" className="icon-button" onClick={() => setActivePanel(isLiveResult ? "routes" : "plan")} aria-label="Torna al percorso">
                    <Icon name="chevronLeft" />
                  </button>
                  <div><h2>Comunità</h2></div>
                </div>
                {areaId === "milan" ? (
                  <CommunityPanel
                    githubUrl="https://github.com/campsh98-creator/Lastrico"
                    loading={reportsLoading}
                    onOpenDetails={() => setDetailsOpen(true)}
                    onShare={shareBeta}
                    onStartReport={startReport}
                    reports={reports}
                    reportsAvailable={reportsAvailable}
                    stats={reportStats}
                  />
                ) : (
                  <p className="panel-note">Le segnalazioni pubbliche non sono ancora disponibili a {area.name}. Puoi inviare un’anomalia dal menu: resta sul tuo dispositivo.</p>
                )}
              </div>
            </section>
          )}
          <div className="visually-hidden" role="status" aria-live="polite" data-testid="status-text">{status}</div>
        </aside>
      )}

      {isJourneyActive && (
        <div className="navigation-hud" aria-label="Navigazione Lastrico" data-testid="navigation-hud" data-transport={transportMode}>
          <div className="hud-top" data-map-overlay="top">
            {navigationPhase === "starting" ? (
              <div className="navigation-instruction waiting" data-testid="gps-waiting">
                <div className="maneuver-glyph" aria-hidden="true"><span className="spinner large" /></div>
                <div className="maneuver-copy">
                  <b aria-live="polite">Cerco il segnale GPS…</b>
                  <small>Le indicazioni partono con la prima posizione valida.</small>
                </div>
              </div>
            ) : (
              <button
                ref={directionsTriggerRef}
                type="button"
                className="navigation-instruction"
                onClick={() => setDirectionsOpen(true)}
                aria-expanded={directionsOpen}
                aria-controls="directions-sheet"
                aria-label="Mostra tutte le svolte del percorso"
                data-testid="directions-trigger"
              >
                <div className="maneuver-glyph" aria-hidden="true"><Icon name={maneuverIcon} size={40} /></div>
                <div className="maneuver-copy">
                  <strong>{formatDistance(navigationProgress.instructionDistance)}</strong>
                  <b aria-live="polite">
                    {isRecalculating
                      ? `Ricalcolo per ${transportMeta[transportMode].article}…`
                      : atFinalStep
                        ? "Destinazione"
                        : navigationProgress.instruction?.text ?? "Segui il percorso"}
                  </b>
                </div>
                <Icon name="chevronDown" size={18} className="directions-hint" />
              </button>
            )}

            <div className="hud-badges">
              <span className="hud-badge" data-testid="navigation-mode">{navigationModeLabel}</span>
              <span className="hud-badge subtle">{activeRoute === "safe" ? "Anti-pavé" : "Più rapido"}</span>
              {traceStatus === "recording" && <span className="hud-badge subtle" data-testid="gps-trace-indicator">REC</span>}
              {traceStatus === "suspended" && <span className="hud-badge warning" data-testid="gps-trace-indicator">REC sospesa</span>}
            </div>

            {gpsAcquireIssue && navigationPhase === "starting" && (
              <div className="hud-notice warning" role="alert" data-testid="gps-acquire-issue">
                <p>
                  {gpsAcquireIssue === "imprecise"
                    ? "Posizione troppo imprecisa. Su iPhone attiva Posizione esatta: Impostazioni › Privacy › Localizzazione › Safari."
                    : "Nessun segnale GPS. Spostati all’aperto e controlla che la posizione sia consentita."}
                </p>
                <button type="button" className="secondary-action" onClick={() => rearmGpsWatch(true)} data-testid="gps-retry">Riprova</button>
              </div>
            )}
            {navigationPhase !== "starting" && navigationStateDescription && (
              <div className={`hud-notice ${rerouteIssue || gpsState === "offroute" || gpsState === "weak" ? "warning" : ""}`} role="status" data-testid="navigation-state">
                <p>{navigationStateDescription}</p>
              </div>
            )}
            {startupNoticeVisible && !navigationStateDescription && navigationPhase !== "starting" && (
              <div className="hud-notice" role="note" data-testid="driving-safety"><p>{transportMeta[transportMode].safety}</p></div>
            )}
          </div>

          <div className="hud-floating">
            <button
              type="button"
              className={`icon-button ${voiceEnabled ? "active" : ""}`}
              onClick={toggleVoiceGuidance}
              aria-pressed={voiceEnabled}
              aria-label={voiceLabel}
              disabled={!voiceAvailable}
              data-testid="hud-voice-toggle"
            >
              <Icon name={voiceEnabled ? "volumeOn" : "volumeOff"} />
            </button>
            <button
              type="button"
              className={`icon-button ${followVehicle ? "" : "attention"}`}
              onClick={recenterNavigation}
              aria-label={followVehicle ? "Mappa centrata" : "Ricentra la mappa"}
              data-testid="hud-recenter"
            >
              <Icon name="recenter" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowDiagnostics((prev) => !prev)}
              aria-expanded={showDiagnostics}
              aria-label={showDiagnostics ? "Nascondi i dettagli GPS" : "Mostra i dettagli GPS"}
              data-testid="hud-toggle-diagnostics-btn"
            >
              <Icon name="info" />
            </button>
          </div>

          {showDiagnostics && (
            <div className="p43-hud-diagnostics" data-testid="hud-diagnostics">
              <p className="profile-note">{positionStorageNote}.{journeyMode === "gps" ? ` ${formatNavigationDiagnosticsSummary(navigationDiagnostics)}.` : ""}</p>
              <NavigationDiagnosticsCard
                diagnostics={navigationDiagnostics}
                gpsState={gpsState}
                journeyMode={journeyMode}
                isOnline={isOnline}
                onResetDiagnostics={() => setNavigationDiagnostics(createNavigationDiagnostics())}
              />
            </div>
          )}

          <section className="navigation-tripbar" data-map-overlay="">
            <div className="trip-metric"><strong>{Math.max(0, Math.ceil(navigationProgress.remainingMinutes))}</strong><small>min</small></div>
            <div className="trip-metric"><strong>{formatDistance(navigationProgress.remainingMeters)}</strong><small>rimanenti</small></div>
            <div className="trip-metric"><strong>{formatArrivalTime(navigationProgress.remainingMinutes)}</strong><small>arrivo stimato</small></div>
            <button type="button" className="stop-navigation" onClick={() => finishNavigation()} aria-label="Termina navigazione" data-testid="stop-navigation">Termina</button>
          </section>
        </div>
      )}

      {directionsOpen && isJourneyActive && (
        <DirectionsSheet
          currentInstructionId={navigationProgress.instruction?.id}
          destinationLabel={endLocation.label}
          instructions={selectedRoute.instructions ?? []}
          onClose={closeDirections}
          remainingDistance={formatDistance(navigationProgress.remainingMeters)}
          remainingMinutes={navigationProgress.remainingMinutes}
          routeLabel={`${activeRoute === "safe" ? "Anti-pavé" : "Più rapido"} · ${transportMeta[transportMode].label}`}
        />
      )}

      {arrived && (
        <div className="arrival-banner" role="status" data-testid="arrival-banner">
          <Icon name="flag" />
          <div><b>Sei arrivato</b><small>Navigazione terminata</small></div>
          <button type="button" onClick={() => setArrived(false)} aria-label="Chiudi"><Icon name="close" /></button>
        </div>
      )}

      {menuOpen && (
        <Dialog labelledBy="app-menu-title" onClose={() => setMenuOpen(false)} className="menu-sheet" testId="app-menu">
          <button type="button" className="modal-close" onClick={() => setMenuOpen(false)} aria-label="Chiudi"><Icon name="close" /></button>
          <h2 id="app-menu-title">Menu</h2>
          <div className="menu-list">
            <button type="button" onClick={cycleTheme} data-testid="menu-theme">
              <Icon name={themeMode === "auto" ? "auto" : themeMode === "light" ? "sun" : "moon"} />
              <span>Tema: {themeMode === "auto" ? "automatico" : themeMode === "light" ? "chiaro" : "scuro"}</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); setActivePanel("community"); }} data-testid="menu-community">
              <Icon name="community" /><span>Comunità</span>
            </button>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); startReport(); }}
              data-testid="menu-report"
              aria-label="Segnala una strada"
              title={isJourneyActive ? "termina la navigazione prima di segnalare" : "Segnala una strada"}
              disabled={isJourneyActive}
            >
              <Icon name="warning" /><span>{areaId === "milan" ? "Segnala una strada" : "Segnala un’anomalia"}</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); setFieldFeedbackOpen(true); }} data-testid="field-feedback-trigger">
              <Icon name="note" /><span>Note di collaudo sul dispositivo</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); void shareBeta(); }} data-testid="menu-share">
              <Icon name="share" /><span>Condividi Lastrico</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); setDetailsOpen(true); }} data-testid="menu-info">
              <Icon name="info" /><span>Informazioni e privacy</span>
            </button>
          </div>
        </Dialog>
      )}

      {addressSearchTarget && addressResults.length > 0 && (
        <Dialog labelledBy="address-picker-title" onClose={closeAddressPicker} className="modal address-picker" testId="address-picker" restoreFocus={false}>
          <button type="button" className="modal-close" onClick={closeAddressPicker} aria-label="Chiudi"><Icon name="close" /></button>
          <span className="eyebrow">{addressSearchTarget === "start" ? "Partenza" : "Destinazione"}</span>
          <h2 id="address-picker-title">Scegli l’indirizzo</h2>
          <p className="address-query">Risultati per “{addressQuery}”</p>
          <div
            id={addressSearchTarget === "start" ? "start-address-results" : "end-address-results"}
            className="address-picker-results"
            role="listbox"
            aria-label={addressSearchTarget === "start" ? "Indirizzi di partenza" : "Indirizzi di destinazione"}
          >
            {addressResults.map((result) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={result.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseAddress(addressSearchTarget, result)}
              >
                <b>{result.primary}</b>
                <small>{result.secondary || area.name}</small>
              </button>
            ))}
          </div>
          <button type="button" className="secondary-action address-cancel" onClick={closeAddressPicker}>Annulla</button>
        </Dialog>
      )}

      {mapChooserOpen && (
        <Dialog labelledBy="map-app-title" onClose={() => setMapChooserOpen(false)} className="map-app-modal" testId="fallback-modal">
          <button type="button" className="modal-close" onClick={() => setMapChooserOpen(false)} aria-label="Chiudi"><Icon name="close" /></button>
          <span className="eyebrow">Alternativa · {transportMeta[transportMode].label}</span>
          <h2 id="map-app-title">Apri in un’altra app</h2>
          <div className="map-app-grid">
            {transportMode !== "bicycle" && (
              <button type="button" onClick={() => openExternalMap("apple")}><b>Mappe</b><small>Profilo guida</small></button>
            )}
            <button type="button" onClick={() => openExternalMap("google")}><b>Google Maps</b><small>{transportMode === "bicycle" ? "Profilo bici" : "Profilo guida"}</small></button>
            {transportMode !== "bicycle" && (
              <button type="button" onClick={() => openExternalMap("waze")}><b>Waze</b><small>{transportMode === "motorcycle" ? "Usa il profilo configurato" : "Profilo guida"}</small></button>
            )}
          </div>
          <p className="external-map-note">Usalo solo se Lastrico non funziona: l’app esterna calcolerà un percorso proprio e potrebbe perdere la deviazione anti-pavé.</p>
        </Dialog>
      )}

      {reportModalOpen && reportStart && reportEnd && (
        <Dialog as="form" labelledBy="report-title" onClose={cancelReport} className="report-modal" onSubmit={submitReport}>
          <button type="button" className="modal-close" onClick={cancelReport} aria-label="Chiudi"><Icon name="close" /></button>
          <span className="eyebrow">Contributo comunitario</span>
          <h2 id="report-title">Descrivi il fondo stradale</h2>
          <p>Il contributo entra in revisione e diventa pubblico sulla mappa solo dopo la verifica. Non raccogliamo email né la posizione continua.</p>
          <div className="report-segment-summary">
            <span aria-hidden="true">↔</span>
            <div>
              <b>Tratto selezionato</b>
              <small>{Math.round(distanceMeters(reportStart, reportEnd)).toLocaleString("it-IT")} m stimati tra i punti · coordinate associate solo a questa segnalazione.</small>
            </div>
          </div>

          <fieldset>
            <legend>Tipo di segnalazione</legend>
            <div className="report-kind-grid">
              {(Object.entries(reportKindMeta) as [ReportKind, (typeof reportKindMeta)[ReportKind]][]).map(([value, meta]) => (
                <label key={value} className={reportKind === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={reportKind === value}
                    onChange={() => {
                      setReportKind(value);
                      setReportSeverity(value === "pave" || value === "rough_cobblestone" ? 2 : 1);
                    }}
                  />
                  <i aria-hidden="true">{meta.icon}</i>
                  <span><b>{meta.label}</b><small>{meta.description}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          {(reportKind === "pave" || reportKind === "rough_cobblestone") && (
            <fieldset>
              <legend>Impatto sul comfort</legend>
              <div className="severity-control">
                {[1, 2, 3].map((value) => (
                  <button key={value} type="button" className={reportSeverity === value ? "active" : ""} onClick={() => setReportSeverity(value)}>
                    {value === 1 ? "Basso" : value === 2 ? "Medio" : "Alto"}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="report-text-fields">
            <label>
              <span>{reportKind === "wrong_data" ? "Correzione richiesta" : "Nota per la verifica (facoltativa)"}</span>
              <textarea
                value={reportNote}
                maxLength={280}
                required={reportKind === "wrong_data"}
                minLength={reportKind === "wrong_data" ? 8 : undefined}
                onChange={(event) => setReportNote(event.target.value)}
                placeholder={reportKind === "wrong_data"
                  ? "Spiega quale dato della mappa deve essere corretto…"
                  : "Es. molto sconnesso vicino al semaforo…"}
              />
              <small>La nota aiuta la moderazione e non viene pubblicata nell’API o nel CSV.</small>
            </label>
          </div>

          {reportSubmitError && <p className="report-submit-error" role="alert">{reportSubmitError}</p>}

          <div className="report-actions">
            <button type="button" className="secondary-action" onClick={cancelReport}>Annulla</button>
            <button type="submit" className="primary-action compact" disabled={isSubmittingReport}>
              {isSubmittingReport ? "Invio…" : "Invia segnalazione"}
            </button>
          </div>
        </Dialog>
      )}

      {detailsOpen && (
        <Dialog labelledBy="about-title" onClose={() => setDetailsOpen(false)} testId="about-dialog">
          <button type="button" className="modal-close" onClick={() => setDetailsOpen(false)} aria-label="Chiudi"><Icon name="close" /></button>
          <span className="eyebrow">Informazioni</span>
          <h2 id="about-title">Lastrico sull’iPhone</h2>
          <ol className="install-steps">
            <li>Apri questa pagina in Safari.</li>
            <li>Tocca Condividi e “Aggiungi alla schermata Home”.</li>
            <li>Attiva “Apri come app web”.</li>
            <li>Consenti la posizione solo quando avvii la navigazione.</li>
          </ol>
          <div className="beta-limit">
            <b>Questa è una beta, non un navigatore certificato.</b>
            <span>Servizio gratuito best-effort per pochi tester: tempi senza traffico in tempo reale, copertura pavé incompleta, disponibilità non garantita e nessuna interfaccia CarPlay.</span>
          </div>
          <p className="beta-privacy">
            Per calcolare e ricalcolare il percorso, partenza, destinazione e posizione usata come nuova partenza vengono trasmesse ai servizi OpenStreetMap/FOSSGIS e possono comparire nei loro log tecnici. Lastrico non salva la posizione continua.
          </p>
          <p className="beta-privacy">
            Lastrico è un progetto ideato e creato da <strong>Domenico Campanella Scali</strong>.
          </p>
          <div className="beta-links">
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap · ODbL</a>
            <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Correggi la mappa</a>
            <a href="https://routing.openstreetmap.de/about.html#privacy" target="_blank" rel="noreferrer">Privacy routing</a>
            <a href="https://github.com/campsh98-creator/Lastrico/issues" target="_blank" rel="noreferrer">Contatta il progetto</a>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-action" onClick={shareBeta}>Condividi</button>
            <button type="button" className="primary-action compact" onClick={() => setDetailsOpen(false)}>Chiudi</button>
          </div>
        </Dialog>
      )}

      <nav className="mobile-nav" aria-label="Navigazione beta">
        {([
          { value: "plan", label: "Pianifica" },
          { value: "routes", label: "Percorsi" },
          { value: "community", label: "Comunità" },
        ] as const).map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={activePanel === value ? "active" : ""}
            onClick={() => setActivePanel(value)}
            disabled={value === "routes" && !isLiveResult}
          >
            {label}
          </button>
        ))}
      </nav>

      <LocalFieldFeedback
        isOpen={fieldFeedbackOpen}
        onClose={() => setFieldFeedbackOpen(false)}
        coordinate={journeyPosition ?? (startLocation.label ? startLocation.coordinate : null)}
        transportMode={transportMode}
        areaId={areaId}
        activeRoute={activeRoute}
        predictedSurfaceCategory={selectedRoute.paveMeters > 0 ? "Pavé noto" : "Nessun pavé noto"}
        routeSummary={{
          from: startLocation.label || undefined,
          to: endLocation.label || undefined,
          distanceKm: selectedRoute.distance || undefined,
          minutes: selectedRoute.minutes || undefined,
        }}
      />
    </main>
  );
}
