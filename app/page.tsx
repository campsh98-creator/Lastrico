"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, GeoJSONSource } from "maplibre-gl";
import {
  estimateArrivalTimestamp,
  evaluateOffRouteReading,
  evaluateTimedGpsReading,
  gpsCoordinateMoved,
  shouldApplyRouteResponse,
  shouldRunSimulationTimer,
  shouldUpdateNavigationCamera,
  smoothGpsCoordinate,
  smoothHeading,
  type NavigationJourneyMode,
} from "@/lib/navigation-state";
import { DirectionsSheet } from "@/components/navigation/DirectionsSheet";
import { CommunityPanel } from "@/components/reports/CommunityPanel";
import {
  directionGlyph,
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
  buildRouteProgressModel,
  calculateRouteProgress,
  type RouteProgressModel,
} from "@/lib/route-progress";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinate = [number, number];
type Surface = "asphalt" | "sett" | "cobblestone" | "paving_stones";
type Avoidance = "balanced" | "strong" | "maximum";
type TransportMode = "car" | "motorcycle" | "bicycle";
type ThemeMode = "auto" | "light" | "dark";
type PickingMode = "start" | "end" | "reportStart" | "reportEnd";
type JourneyMode = NavigationJourneyMode;
type GpsState = "idle" | "requesting" | "live" | "weak" | "offroute" | "recalculating" | "unavailable";
type WakeLockHandle = { release: () => Promise<void>; released?: boolean };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> };
};

type RoadNode = {
  id: string;
  name: string;
  coordinate: Coordinate;
  landmark?: boolean;
};

type RoadEdge = {
  from: string;
  to: string;
  name: string;
  distance: number;
  minutes: number;
  surface: Surface;
  geometry?: Coordinate[];
};

type RouteResult = {
  nodes: string[];
  edges: RoadEdge[];
  coordinates: Coordinate[];
  distance: number;
  minutes: number;
  paveMeters: number;
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
  fast: Omit<RouteResult, "nodes" | "edges">;
  safe: Omit<RouteResult, "nodes" | "edges">;
  problemSegments: Coordinate[][];
  alternativesAnalyzed: number;
  hasDistinctAlternative: boolean;
  surfaceDataAvailable: boolean;
  dataNotice: string;
  transportMode: TransportMode;
  routingProfile: {
    provider: string;
    profile: string;
    approximate: boolean;
    notice: string;
  };
};

const nodes: RoadNode[] = [
  { id: "castello", name: "Castello Sforzesco", coordinate: [9.1785, 45.4705], landmark: true },
  { id: "cairoli", name: "Cairoli", coordinate: [9.1825, 45.4689] },
  { id: "duomo", name: "Duomo", coordinate: [9.1901, 45.4642], landmark: true },
  { id: "sanbabila", name: "San Babila", coordinate: [9.1979, 45.4663], landmark: true },
  { id: "venezia", name: "Porta Venezia", coordinate: [9.2056, 45.4731], landmark: true },
  { id: "brera", name: "Brera", coordinate: [9.1886, 45.4721], landmark: true },
  { id: "repubblica", name: "Repubblica", coordinate: [9.1968, 45.4792] },
  { id: "centrale", name: "Milano Centrale", coordinate: [9.2042, 45.4857], landmark: true },
  { id: "cadorna", name: "Cadorna", coordinate: [9.1765, 45.4682], landmark: true },
  { id: "santambrogio", name: "Sant’Ambrogio", coordinate: [9.1762, 45.4622], landmark: true },
  { id: "navigli", name: "Darsena / Navigli", coordinate: [9.1771, 45.4523], landmark: true },
  { id: "portaromana", name: "Porta Romana", coordinate: [9.2025, 45.4512], landmark: true },
  { id: "missori", name: "Missori", coordinate: [9.1887, 45.4607] },
  { id: "garibaldi", name: "Porta Garibaldi", coordinate: [9.1877, 45.4848], landmark: true },
];

const edges: RoadEdge[] = [
  { from: "castello", to: "cairoli", name: "Piazza Castello", distance: 0.42, minutes: 1.4, surface: "asphalt" },
  { from: "cairoli", to: "duomo", name: "Via Dante", distance: 0.86, minutes: 2.7, surface: "sett", geometry: [[9.1845, 45.4679], [9.1874, 45.4662]] },
  { from: "duomo", to: "sanbabila", name: "Corso Europa", distance: 0.83, minutes: 2.6, surface: "cobblestone", geometry: [[9.1932, 45.4647], [9.1960, 45.4655]] },
  { from: "sanbabila", to: "venezia", name: "Corso Venezia", distance: 0.94, minutes: 2.8, surface: "asphalt", geometry: [[9.2012, 45.4685], [9.2035, 45.4707]] },
  { from: "castello", to: "brera", name: "Via Pontaccio", distance: 0.92, minutes: 2.8, surface: "asphalt", geometry: [[9.1819, 45.4721], [9.1856, 45.4726]] },
  { from: "brera", to: "repubblica", name: "Via Turati", distance: 1.21, minutes: 3.8, surface: "asphalt", geometry: [[9.1918, 45.4744], [9.1942, 45.4770]] },
  { from: "repubblica", to: "venezia", name: "Viale Tunisia", distance: 1.17, minutes: 3.5, surface: "asphalt", geometry: [[9.1997, 45.4775], [9.2025, 45.4756]] },
  { from: "repubblica", to: "centrale", name: "Via Vittor Pisani", distance: 0.93, minutes: 2.8, surface: "asphalt", geometry: [[9.1998, 45.4817]] },
  { from: "venezia", to: "centrale", name: "Via Vitruvio", distance: 1.54, minutes: 4.7, surface: "asphalt", geometry: [[9.2071, 45.4771], [9.2065, 45.4815]] },
  { from: "brera", to: "garibaldi", name: "Corso Garibaldi", distance: 1.48, minutes: 4.9, surface: "sett", geometry: [[9.1875, 45.4764], [9.1868, 45.4809]] },
  { from: "garibaldi", to: "repubblica", name: "Viale della Liberazione", distance: 0.89, minutes: 2.9, surface: "asphalt" },
  { from: "cadorna", to: "castello", name: "Foro Buonaparte", distance: 0.48, minutes: 1.5, surface: "asphalt" },
  { from: "cadorna", to: "santambrogio", name: "Via Carducci", distance: 0.76, minutes: 2.5, surface: "asphalt" },
  { from: "santambrogio", to: "duomo", name: "Via Torino", distance: 1.25, minutes: 4.0, surface: "paving_stones", geometry: [[9.1807, 45.4624], [9.1847, 45.4631]] },
  { from: "santambrogio", to: "navigli", name: "Via De Amicis", distance: 1.21, minutes: 3.9, surface: "asphalt", geometry: [[9.1748, 45.4579]] },
  { from: "navigli", to: "portaromana", name: "Viale Gorizia", distance: 2.15, minutes: 6.5, surface: "asphalt", geometry: [[9.1855, 45.4491], [9.1951, 45.4490]] },
  { from: "portaromana", to: "missori", name: "Corso di Porta Romana", distance: 1.43, minutes: 4.8, surface: "sett", geometry: [[9.1983, 45.4552], [9.1938, 45.4584]] },
  { from: "missori", to: "duomo", name: "Via Mazzini", distance: 0.47, minutes: 1.6, surface: "asphalt" },
  { from: "missori", to: "navigli", name: "Corso Italia", distance: 1.29, minutes: 4.2, surface: "asphalt", geometry: [[9.1852, 45.4575], [9.1815, 45.4546]] },
  { from: "missori", to: "portaromana", name: "Via Lamarmora", distance: 1.55, minutes: 5.1, surface: "asphalt", geometry: [[9.1946, 45.4569], [9.1993, 45.4538]] },
];

const nodeMap = new Map(nodes.map((node) => [node.id, node]));
const isPave = (surface: Surface) => surface !== "asphalt";
const transportMeta: Record<TransportMode, { label: string; short: string; article: string; safety: string }> = {
  car: { label: "Auto", short: "AUTO", article: "l’auto", safety: "Non interagire con lo schermo durante la guida" },
  motorcycle: { label: "Moto", short: "MOTO", article: "la moto", safety: "Non interagire con lo schermo durante la guida" },
  bicycle: { label: "Bici", short: "BICI", article: "la bici", safety: "Fermati in sicurezza prima di usare lo schermo" },
};
const navigationPolicy: Record<TransportMode, { offRouteMeters: number; readings: number; arrivalMeters: number; simulationSteps: number }> = {
  car: { offRouteMeters: 55, readings: 2, arrivalMeters: 35, simulationSteps: 80 },
  motorcycle: { offRouteMeters: 50, readings: 2, arrivalMeters: 30, simulationSteps: 90 },
  bicycle: { offRouteMeters: 38, readings: 3, arrivalMeters: 24, simulationSteps: 110 },
};
const MILAN_GPS_BOUNDS = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
};
const formatMinutes = (minutes: number) => minutes.toLocaleString("it-IT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function promptErrorCopy(result: PromptRoutePreferenceResult) {
  if (result.status === "empty") return "Scrivi come vuoi gestire pavé e tempo extra.";
  if (result.status === "conflict") return "La richiesta contiene preferenze in conflitto o più limiti di tempo.";
  if (result.status === "invalid") return "Usa un limite intero compreso tra 1 e 30 minuti.";
  return "Questa demo comprende solo pavé, priorità al percorso rapido e minuti extra.";
}

function edgeCoordinates(edge: RoadEdge, forward: boolean) {
  const start = nodeMap.get(edge.from)!.coordinate;
  const end = nodeMap.get(edge.to)!.coordinate;
  const coordinates = [start, ...(edge.geometry ?? []), end];
  return forward ? coordinates : [...coordinates].reverse();
}

function route(start: string, end: string, avoidance?: Avoidance): RouteResult {
  const weights: Record<Avoidance, number> = { balanced: 3.5, strong: 10, maximum: 60 };
  const dist = new Map(nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, { node: string; edge: RoadEdge; forward: boolean }>();
  const unvisited = new Set(nodes.map((node) => node.id));
  dist.set(start, 0);

  while (unvisited.size) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    unvisited.forEach((id) => {
      if (dist.get(id)! < currentDistance) {
        current = id;
        currentDistance = dist.get(id)!;
      }
    });
    if (!current || current === end) break;
    unvisited.delete(current);

    edges.forEach((edge) => {
      const forward = edge.from === current;
      const next = forward ? edge.to : edge.to === current ? edge.from : undefined;
      if (!next || !unvisited.has(next)) return;
      const penalty = avoidance && isPave(edge.surface) ? weights[avoidance] : 1;
      const candidate = currentDistance + edge.minutes * penalty;
      if (candidate < dist.get(next)!) {
        dist.set(next, candidate);
        previous.set(next, { node: current!, edge, forward });
      }
    });
  }

  const steps: { edge: RoadEdge; forward: boolean }[] = [];
  const pathNodes = [end];
  let cursor = end;
  while (cursor !== start && previous.has(cursor)) {
    const step = previous.get(cursor)!;
    steps.unshift({ edge: step.edge, forward: step.forward });
    cursor = step.node;
    pathNodes.unshift(cursor);
  }
  const coordinates = steps.flatMap((step, index) => {
    const segment = edgeCoordinates(step.edge, step.forward);
    return index === 0 ? segment : segment.slice(1);
  });
  return {
    nodes: pathNodes,
    edges: steps.map((step) => step.edge),
    coordinates,
    distance: steps.reduce((sum, step) => sum + step.edge.distance, 0),
    minutes: steps.reduce((sum, step) => sum + step.edge.minutes, 0),
    paveMeters: Math.round(steps.filter((step) => isPave(step.edge.surface)).reduce((sum, step) => sum + step.edge.distance, 0) * 1000),
  };
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
      result.problemSegments?.map((coordinates) => ({
        type: "Feature" as const,
        properties: { name: "Pavé rilevato", surface: "OSM" },
        geometry: { type: "LineString" as const, coordinates },
      })) ?? result.edges.filter((edge) => isPave(edge.surface)).map((edge) => ({
        type: "Feature" as const,
        properties: { name: edge.name, surface: edge.surface },
        geometry: { type: "LineString" as const, coordinates: edgeCoordinates(edge, true) },
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

function distanceMeters(a: Coordinate, b: Coordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearingBetween(a: Coordinate, b: Coordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const toDegrees = (value: number) => value * 180 / Math.PI;
  const longitude = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const y = Math.sin(longitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
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

export default function Home() {
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
  const lastJourneyOriginRef = useRef<Coordinate | null>(null);
  const lastJourneyCalculationRef = useRef(0);
  const previousJourneyPositionRef = useRef<Coordinate | null>(null);
  const previousJourneyAccuracyRef = useRef<number | null>(null);
  const previousJourneyTimestampRef = useRef<number | null>(null);
  const offRouteReadingsRef = useRef(0);
  const lastSpokenInstructionRef = useRef("");
  const arrivalReadingsRef = useRef(0);
  const journeyTravelledMetersRef = useRef(0);
  const journeyActiveRef = useRef(false);
  const journeyHeadingRef = useRef(0);
  const selectedRouteRef = useRef<RouteResult | null>(null);
  const selectedRouteModelRef = useRef<RouteProgressModel<NavigationInstruction> | null>(null);
  const endLocationRef = useRef<LocationChoice | null>(null);
  const loadingRef = useRef(false);
  const transportModeRef = useRef<TransportMode>("car");
  const transportReadyRef = useRef(false);
  const voiceReadyRef = useRef(false);
  const activeRouteRef = useRef<"safe" | "fast">("fast");
  const routeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const routeRequestCounterRef = useRef(0);
  const cameraLastUpdateRef = useRef(0);
  const cameraLastCenterRef = useRef<Coordinate | null>(null);
  const cameraLastHeadingRef = useRef(0);
  const avoidanceReadyRef = useRef(false);
  const promptPreferredRouteRef = useRef<"fast" | null>(null);
  const defaultFast = useMemo(() => route("castello", "venezia"), []);
  const defaultSafe = useMemo(() => route("castello", "venezia", "strong"), []);
  const [startLocation, setStartLocation] = useState<LocationChoice>({
    label: "Castello Sforzesco",
    coordinate: nodeMap.get("castello")!.coordinate,
  });
  const [endLocation, setEndLocation] = useState<LocationChoice>({
    label: "Porta Venezia",
    coordinate: nodeMap.get("venezia")!.coordinate,
  });
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("car");
  const [avoidance, setAvoidance] = useState<Avoidance>("strong");
  const [maxExtraMinutes, setMaxExtraMinutes] = useState<number | null>(null);
  const [routePrompt, setRoutePrompt] = useState("");
  const [promptInterpretation, setPromptInterpretation] = useState<PromptRoutePreferenceResult | null>(null);
  const [fastRoute, setFastRoute] = useState<RouteResult>(defaultFast);
  const [safeRoute, setSafeRoute] = useState<RouteResult>(defaultSafe);
  const [activeRoute, setActiveRoute] = useState<"safe" | "fast">("fast");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [picking, setPicking] = useState<PickingMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Demo pronta: cerca un indirizzo o scegli due punti sulla mappa.");
  const [isLiveResult, setIsLiveResult] = useState(false);
  const [alternativesAnalyzed, setAlternativesAnalyzed] = useState(2);
  const [hasDistinctAlternative, setHasDistinctAlternative] = useState(false);
  const [activePanel, setActivePanel] = useState<"plan" | "routes" | "community">("plan");
  const [isJourneyActive, setIsJourneyActive] = useState(false);
  const [journeyMode, setJourneyMode] = useState<JourneyMode | null>(null);
  const [journeyPosition, setJourneyPosition] = useState<Coordinate | null>(null);
  const [journeyHeading, setJourneyHeading] = useState(0);
  const [journeyAccuracy, setJourneyAccuracy] = useState<number | null>(null);
  const [followVehicle, setFollowVehicle] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [lastRecalculatedAt, setLastRecalculatedAt] = useState<string | null>(null);
  const [routingProfile, setRoutingProfile] = useState<RouteApiResponse["routingProfile"]>({
    provider: "demo",
    profile: "car",
    approximate: false,
    notice: "Esempio iniziale",
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
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
  const [isOnline, setIsOnline] = useState(true);
  const landmarks = nodes.filter((node) => node.landmark);
  const savedPave = Math.max(0, fastRoute.paveMeters - safeRoute.paveMeters);
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
    () => calculateRouteProgress(selectedRouteModel, journeyPosition, selectedRoute.minutes),
    [journeyPosition, selectedRoute.minutes, selectedRouteModel],
  );
  const navigationModeLabel = journeyMode === "simulation"
    ? "SIMULAZIONE"
    : gpsState === "requesting"
      ? "GPS · AGGANCIO"
      : gpsState === "weak"
        ? "GPS DEBOLE"
        : gpsState === "offroute"
          ? "FUORI PERCORSO"
          : gpsState === "recalculating" || isRecalculating
            ? "RICALCOLO"
            : "GPS LIVE";
  const navigationStateDescription = journeyMode === "simulation"
    ? "Avanzamento automatico · GPS non usato"
    : !isOnline
      ? "Connessione assente · continuo sul percorso salvato"
      : gpsState === "requesting"
        ? "Ricerca della posizione precisa in corso"
        : gpsState === "weak"
          ? `Segnale debole${journeyAccuracy ? ` · ±${Math.round(journeyAccuracy)} m` : ""} · ultimo punto valido`
          : gpsState === "offroute"
            ? "Fuori percorso · attendo un fix affidabile"
            : gpsState === "recalculating" || isRecalculating
              ? "Fuori percorso · sto calcolando una nuova strada"
              : `Precisione ${journeyAccuracy ? `±${Math.round(journeyAccuracy)} m` : "in acquisizione"} · posizione non salvata`;
  const speakInstruction = useCallback((text: string) => {
    if (!voiceEnabled || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "it-IT";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Visual guidance remains available when speech synthesis fails.
    }
  }, [voiceEnabled]);
  const toggleVoiceGuidance = useCallback(() => {
    if (!voiceAvailable) {
      setStatus("La guida vocale non è disponibile su questo dispositivo.");
      return;
    }
    setVoiceEnabled((current) => {
      if (current) window.speechSynthesis?.cancel();
      return !current;
    });
  }, [voiceAvailable]);

  function selectActiveRoute(routeKind: "safe" | "fast") {
    activeRouteRef.current = routeKind;
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
    let cancelled = false;
    import("maplibre-gl").then(({ Map, NavigationControl, Marker }) => {
      if (cancelled || !mapContainer.current || mapRef.current) return;
      const map = new Map({
        container: mapContainer.current,
        style: mapStyle,
        center: [9.1905, 45.4685],
        zoom: 13.5,
        attributionControl: true,
      });
      map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      map.on("styleimagemissing", ({ id }) => {
        if (!map.hasImage(id)) {
          map.addImage(id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
        }
      });
      map.once("error", () => {
        if (!cancelled) setStatus("La mappa non è disponibile. Il percorso resta consultabile nei dettagli.");
      });
      landmarks.forEach((landmark) => {
        const element = document.createElement("div");
        element.className = "landmark-dot";
        element.setAttribute("aria-label", landmark.name);
        new Marker({ element }).setLngLat(landmark.coordinate).setPopup(undefined).addTo(map);
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
      vehicleArrow.textContent = "▲";
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
        const label = `Punto scelto · ${coordinate[1].toFixed(4)}, ${coordinate[0].toFixed(4)}`;
        if (target === "start") {
          setStartLocation({ label, coordinate });
          setStartText(label);
        } else if (target === "end") {
          setEndLocation({ label, coordinate });
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
      map.on("load", () => {
        const alternativePaint = routePaint("alternative");
        map.addSource("fast-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("safe-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("problem-segments", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("community-reports", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("report-draft", { type: "geojson", data: emptyFeatureCollection });
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
    pickingRef.current = picking;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  useEffect(() => {
    pointMarkersRef.current.start?.setLngLat(startLocation.coordinate);
  }, [startLocation]);

  useEffect(() => {
    pointMarkersRef.current.end?.setLngLat(endLocation.coordinate);
    endLocationRef.current = endLocation;
  }, [endLocation]);

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
    journeyHeadingRef.current = journeyHeading;
  }, [journeyHeading]);

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
      mapRef.current?.easeTo({
        center: journeyPosition,
        zoom: 16.6,
        pitch: 42,
        bearing: journeyHeading,
        duration: 650,
        essential: false,
      });
      cameraLastUpdateRef.current = now;
      cameraLastCenterRef.current = journeyPosition;
      cameraLastHeadingRef.current = journeyHeading;
    }
  }, [journeyPosition, journeyHeading, journeyAccuracy, followVehicle, isJourneyActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (!isLiveResult && transportMode !== "car") {
      (map.getSource("fast-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("safe-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("problem-segments") as GeoJSONSource)?.setData(emptyFeatureCollection);
      return;
    }
    if (!fastRoute.coordinates.length || !safeRoute.coordinates.length) return;
    (map.getSource("fast-route") as GeoJSONSource)?.setData(routeGeoJSON(fastRoute));
    (map.getSource("safe-route") as GeoJSONSource)?.setData(
      hasDistinctAlternative ? routeGeoJSON(safeRoute) : emptyFeatureCollection,
    );
    (map.getSource("problem-segments") as GeoJSONSource)?.setData(problemGeoJSON([fastRoute]));
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
    if (journeyActiveRef.current) return;
    const allCoordinates = [...fastRoute.coordinates, ...safeRoute.coordinates];
    const lngs = allCoordinates.map(([lng]) => lng);
    const lats = allCoordinates.map(([, lat]) => lat);
    const compactMap = window.innerWidth <= 760;
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: compactMap
        ? { top: 30, right: 22, bottom: 30, left: 22 }
        : { top: 90, right: 60, bottom: 90, left: 60 },
      maxZoom: 14.7,
      duration: 650,
    });
  }, [fastRoute, safeRoute, activeRoute, hasDistinctAlternative, isLiveResult, transportMode, mapReady]);

  useEffect(() => {
    if (!isJourneyActive || !voiceEnabled || !navigationProgress.instruction) return;
    if (lastSpokenInstructionRef.current === navigationProgress.instruction.id) return;
    lastSpokenInstructionRef.current = navigationProgress.instruction.id;
    speakInstruction(navigationProgress.instruction.text);
  }, [isJourneyActive, voiceEnabled, navigationProgress.instruction, speakInstruction]);

  useEffect(() => {
    if (!shouldRunSimulationTimer(journeyMode) || !selectedRoute.coordinates.length) return;
    const coordinates = selectedRoute.coordinates;
    const session = navigationSessionRef.current;
    let index = 0;
    const step = Math.max(1, Math.floor(coordinates.length / navigationPolicy[transportModeRef.current].simulationSteps));
    simulationTimerRef.current = window.setInterval(() => {
      if (
        !journeyActiveRef.current
        || journeyModeRef.current !== "simulation"
        || navigationSessionRef.current !== session
      ) return;
      index = Math.min(coordinates.length - 1, index + step);
      const position = coordinates[index];
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
      window.queueMicrotask(() => {
        setVoiceEnabled(savedVoice === "on");
        voiceReadyRef.current = true;
      });
      return;
    }
    voiceReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!voiceReadyRef.current) return;
    window.localStorage.setItem("lastrico-voice", voiceEnabled ? "on" : "off");
  }, [voiceEnabled]);

  useEffect(() => {
    const applyTheme = () => {
      const hour = new Date().getHours();
      const nextTheme = themeMode === "auto"
        ? hour >= 7 && hour < 19 ? "light" : "dark"
        : themeMode;
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        nextTheme === "dark" ? "#0b1315" : "#f4f2ec",
      );
      window.localStorage.setItem("lastrico-theme", themeMode);

      const map = mapRef.current;
      if (mapReady && map?.isStyleLoaded()) {
        if (map.getLayer("osm")) {
          map.setPaintProperty("osm", "raster-brightness-max", nextTheme === "dark" ? 0.58 : 1);
          map.setPaintProperty("osm", "raster-brightness-min", nextTheme === "dark" ? 0.18 : 0);
          map.setPaintProperty("osm", "raster-saturation", nextTheme === "dark" ? -0.62 : 0);
          map.setPaintProperty("osm", "raster-contrast", nextTheme === "dark" ? 0.22 : 0);
        }
      }
    };
    applyTheme();
    const timer = window.setInterval(applyTheme, 60_000);
    return () => window.clearInterval(timer);
  }, [themeMode, mapReady]);

  useEffect(() => {
    const reacquireWakeLock = () => {
      if (document.visibilityState === "visible" && journeyActiveRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", reacquireWakeLock);
    return () => {
      document.removeEventListener("visibilitychange", reacquireWakeLock);
      if (journeyWatchRef.current !== null) navigator.geolocation.clearWatch(journeyWatchRef.current);
      if (simulationTimerRef.current !== null) window.clearInterval(simulationTimerRef.current);
      routeRequestRef.current?.controller.abort();
      void wakeLockRef.current?.release();
      window.speechSynthesis?.cancel();
    };
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
    if (!mapReady || !map?.isStyleLoaded()) return;
    (map.getSource("community-reports") as GeoJSONSource)?.setData(reportsGeoJSON(reports));
  }, [reports, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.isStyleLoaded()) return;
    (map.getSource("report-draft") as GeoJSONSource)?.setData(draftGeoJSON(reportStart, reportEnd));
  }, [reportStart, reportEnd, mapReady]);

  useEffect(() => {
    if (!avoidanceReadyRef.current) {
      avoidanceReadyRef.current = true;
      return;
    }
    if (!isLiveResult || isJourneyActive) return;
    const timer = window.setTimeout(() => {
      setStatus("Livello aggiornato: ricalcolo le alternative…");
      void calculateRoutes();
    }, 350);
    return () => window.clearTimeout(timer);
    // Recalculate only when an implemented route preference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avoidance, maxExtraMinutes]);

  function setManualAvoidance(value: Avoidance) {
    promptPreferredRouteRef.current = null;
    setPromptInterpretation(null);
    setMaxExtraMinutes(null);
    setAvoidance(value);
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
    setAvoidance(interpretation.preferences.avoidance);
    setMaxExtraMinutes(interpretation.preferences.maxExtraMinutes);
    setStatus("Preferenza interpretata localmente e applicata al calcolo del percorso.");
  }

  function swapLocations() {
    const oldStart = startLocation;
    const oldStartText = startText;
    setStartLocation(endLocation);
    setEndLocation(oldStart);
    setStartText(endText);
    setEndText(oldStartText);
    setStatus("Partenza e destinazione invertite. Ricalcola il percorso.");
  }

  function chooseAddress(target: "start" | "end", result: GeocodeResult) {
    const label = result.label;
    const location = { label, coordinate: result.coordinate };
    if (target === "start") {
      setStartLocation(location);
      setStartText(location.label);
    } else {
      setEndLocation(location);
      setEndText(location.label);
    }
    setAddressResults([]);
    setAddressSearchTarget(null);
    setAddressQuery("");
    setStatus(`${target === "start" ? "Partenza" : "Destinazione"} confermata.`);
  }

  function closeAddressPicker() {
    setAddressResults([]);
    setAddressSearchTarget(null);
    setAddressQuery("");
    setStatus("Ricerca indirizzo chiusa.");
  }

  async function fetchAddresses(text: string, signal?: AbortSignal) {
    if (text.trim().length < 3) throw new Error("Inserisci almeno tre caratteri.");
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(text.trim())}`, { signal });
    const data = await response.json() as {
      results?: GeocodeResult[];
      error?: string;
    };
    if (!response.ok || !data.results?.length) {
      throw new Error(data.error ?? `Non trovo “${text}” a Milano.`);
    }
    return data.results;
  }

  async function searchAddresses(target: "start" | "end") {
    if (addressSearchLoading) return;
    const text = target === "start" ? startText : endText;
    if (!text.trim()) {
      setStatus(`Inserisci ${target === "start" ? "la partenza" : "la destinazione"}.`);
      return;
    }
    setAddressQuery(text.trim());
    setAddressSearchTarget(target);
    setAddressResults([]);
    setAddressSearchLoading(true);
    setStatus(`Cerco “${text.trim()}” in tutta Milano…`);
    try {
      const results = await fetchAddresses(text);
      setAddressResults(results);
      setStatus(`${results.length} ${results.length === 1 ? "risultato trovato" : "risultati trovati"}: scegli l’indirizzo corretto.`);
    } catch (error) {
      setAddressSearchTarget(null);
      setStatus(error instanceof Error ? error.message : "Ricerca non riuscita.");
    } finally {
      setAddressSearchLoading(false);
    }
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
    throw new Error(`Scegli l’indirizzo ${target === "start" ? "di partenza" : "di destinazione"} dall’elenco.`);
  }

  async function calculateRoutes(
    startOverride?: LocationChoice,
    options: {
      mode?: TransportMode;
      preserveRoute?: "safe" | "fast";
      force?: boolean;
      journeySession?: number;
    } = {},
  ) {
    if (!navigator.onLine) {
      if (
        options.journeySession !== undefined
        && options.journeySession === navigationSessionRef.current
      ) {
        setIsRecalculating(false);
        setGpsState("offroute");
      }
      setStatus("Connessione assente. Mantengo il percorso già disponibile.");
      return;
    }
    if (loadingRef.current && !options.force) return;
    routeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = routeRequestCounterRef.current + 1;
    routeRequestCounterRef.current = requestId;
    routeRequestRef.current = { id: requestId, controller };
    const requestTimeout = window.setTimeout(
      () => controller.abort(new DOMException("Tempo di calcolo esaurito", "TimeoutError")),
      options.journeySession === undefined ? 20_000 : 8_000,
    );
    const requestedMode = options.mode ?? transportModeRef.current;
    let routeSucceeded = false;
    loadingRef.current = true;
    setIsLoading(true);
    setStatus(options.journeySession === undefined
      ? `Calcolo i percorsi per ${transportMeta[requestedMode].article}…`
      : `Fuori percorso · ricalcolo per ${transportMeta[requestedMode].article}…`);
    try {
      const resolvedStart = startOverride
        ?? await geocode(startText, startLocation, "start", controller.signal);
      if (!startOverride && startText.trim() !== startLocation.label && endText.trim() !== endLocation.label) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 250);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(controller.signal.reason);
          }, { once: true });
        });
      }
      const resolvedEnd = await geocode(endText, endLocation, "end", controller.signal);
      if (!shouldApplyRouteResponse(
        routeRequestRef.current?.id ?? -1,
        requestId,
        navigationSessionRef.current,
        options.journeySession ?? null,
        journeyActiveRef.current,
      )) return;
      setStartLocation(resolvedStart);
      setEndLocation(resolvedEnd);
      setStartText(resolvedStart.label);
      setEndText(resolvedEnd.label);

      const params = new URLSearchParams({
        start: resolvedStart.coordinate.join(","),
        end: resolvedEnd.coordinate.join(","),
        avoid: avoidance,
        mode: requestedMode,
      });
      if (maxExtraMinutes !== null) {
        params.set("maxExtraMinutes", String(maxExtraMinutes));
      }
      if (options.journeySession !== undefined) params.set("navigation", "1");
      const response = await fetch(`/api/routes?${params}`, { signal: controller.signal });
      const data = await response.json() as RouteApiResponse & { error?: string };
      if (!response.ok || !data.fast || !data.safe) {
        throw new Error(data.error ?? "Non riesco a calcolare il percorso.");
      }
      if (
        !shouldApplyRouteResponse(
          routeRequestRef.current?.id ?? -1,
          requestId,
          navigationSessionRef.current,
          options.journeySession ?? null,
          journeyActiveRef.current,
        )
        || data.transportMode !== requestedMode
      ) return;
      setFastRoute({ ...data.fast, nodes: [], edges: [], problemSegments: data.problemSegments });
      setSafeRoute({ ...data.safe, nodes: [], edges: [], problemSegments: data.problemSegments });
      setAlternativesAnalyzed(data.alternativesAnalyzed);
      setHasDistinctAlternative(data.hasDistinctAlternative);
      setRoutingProfile(data.routingProfile);
      setTransportMode(requestedMode);
      transportModeRef.current = requestedMode;
      setIsLiveResult(true);
      setActivePanel("routes");
      const requestedRoute = options.preserveRoute;
      const nextRoute = requestedRoute === "fast"
        ? "fast"
        : promptPreferredRouteRef.current === "fast"
          ? "fast"
          : data.hasDistinctAlternative ? "safe" : "fast";
      setActiveRoute(nextRoute);
      activeRouteRef.current = nextRoute;
      setLastRecalculatedAt(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
      const timingNotice = requestedMode === "bicycle" ? "Tempi stimati senza traffico live" : "Tempi medi senza traffico live";
      setStatus(`${data.dataNotice}. ${timingNotice}.`);
      routeSucceeded = true;
      if (options.journeySession !== undefined) setGpsState("live");
    } catch (error) {
      if (controller.signal.aborted) {
        if (
          controller.signal.reason instanceof DOMException
          && controller.signal.reason.name === "TimeoutError"
        ) {
          setStatus("Il calcolo sta impiegando troppo tempo. Mantengo l’ultimo percorso.");
        }
        return;
      }
      if (
        options.journeySession !== undefined
        && options.journeySession === navigationSessionRef.current
      ) {
        setGpsState("offroute");
      }
      setStatus(error instanceof Error ? error.message : "Qualcosa non ha funzionato. Riprova.");
    } finally {
      window.clearTimeout(requestTimeout);
      if (routeRequestRef.current?.id === requestId) {
        loadingRef.current = false;
        setIsLoading(false);
        setIsRecalculating(false);
        if (
          options.journeySession !== undefined
          && options.journeySession === navigationSessionRef.current
          && !routeSucceeded
        ) {
          setGpsState("offroute");
        }
      }
    }
  }

  function changeTransportMode(nextMode: TransportMode) {
    if (nextMode === transportModeRef.current || isJourneyActive) return;
    const shouldRecalculate = isLiveResult || loadingRef.current;
    const routeKind = activeRouteRef.current;
    routeRequestRef.current?.controller.abort();
    transportModeRef.current = nextMode;
    setTransportMode(nextMode);
    setIsLiveResult(false);
    setHasDistinctAlternative(false);
    setRoutingProfile({
      provider: "pending",
      profile: nextMode,
      approximate: false,
      notice: "Da calcolare",
    });
    const map = mapRef.current;
    if (map?.isStyleLoaded()) {
      (map.getSource("fast-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("safe-route") as GeoJSONSource)?.setData(emptyFeatureCollection);
      (map.getSource("problem-segments") as GeoJSONSource)?.setData(emptyFeatureCollection);
    }
    if (shouldRecalculate) {
      setStatus(`Ricalcolo i percorsi per ${transportMeta[nextMode].article}…`);
      void calculateRoutes(undefined, { mode: nextMode, preserveRoute: routeKind, force: true });
    } else {
      setActivePanel("plan");
      setStatus(`${transportMeta[nextMode].label} selezionata. Inserisci gli indirizzi e calcola.`);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("La posizione non è disponibile su questo dispositivo.");
      return;
    }
    setStatus("Sto rilevando la tua posizione…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate: Coordinate = [coords.longitude, coords.latitude];
        if (coordinate[0] < 9.04 || coordinate[0] > 9.31 || coordinate[1] < 45.38 || coordinate[1] > 45.55) {
          setStatus("La demo copre per ora soltanto l’area di Milano.");
          return;
        }
        const location = { label: "La mia posizione", coordinate };
        setStartLocation(location);
        setStartText(location.label);
        setStatus("Posizione impostata come partenza.");
      },
      () => setStatus("Non ho potuto accedere alla posizione."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function requestWakeLock() {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock || document.visibilityState !== "visible") return;
    try {
      wakeLockRef.current = await wakeLock.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }

  function finishNavigation(hasArrived = false) {
    journeyActiveRef.current = false;
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
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
    window.speechSynthesis?.cancel();
    setIsJourneyActive(false);
    setDirectionsOpen(false);
    setJourneyMode(null);
    setGpsState("idle");
    setIsRecalculating(false);
    setJourneyPosition(null);
    setJourneyAccuracy(null);
    setJourneyHeading(0);
    journeyHeadingRef.current = 0;
    setFollowVehicle(true);
    setArrived(hasArrived);
    lastJourneyOriginRef.current = null;
    previousJourneyPositionRef.current = null;
    previousJourneyAccuracyRef.current = null;
    previousJourneyTimestampRef.current = null;
    offRouteReadingsRef.current = 0;
    arrivalReadingsRef.current = 0;
    journeyTravelledMetersRef.current = 0;
    lastSpokenInstructionRef.current = "";
    cameraLastUpdateRef.current = 0;
    cameraLastCenterRef.current = null;
    cameraLastHeadingRef.current = 0;
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 450 });
    if (hasArrived) {
      speakInstruction("Sei arrivato a destinazione");
      setStatus("Arrivo raggiunto. Navigazione terminata.");
    } else {
      setStatus("Navigazione terminata. La posizione non è stata conservata.");
    }
  }

  function updateJourneyPosition(
    coordinate: Coordinate,
    accuracy: number,
    reportedHeading: number | null,
    reportedSpeed: number | null,
    session: number,
  ) {
    if (
      !journeyActiveRef.current
      || journeyModeRef.current !== "gps"
      || session !== navigationSessionRef.current
    ) return;
    const previous = previousJourneyPositionRef.current;
    const previousAccuracy = previousJourneyAccuracyRef.current ?? accuracy;
    const headingMovementThreshold = Math.max(
      6,
      Math.min(25, Math.max(previousAccuracy, accuracy) * 0.75),
    );
    const movedEnoughForHeading = gpsCoordinateMoved(
      previous,
      coordinate,
      distanceMeters,
      headingMovementThreshold,
    );
    const inferredHeading = movedEnoughForHeading && previous
      ? bearingBetween(previous, coordinate)
      : journeyHeadingRef.current;
    const movingWithReportedHeading = (
      Number.isFinite(reportedHeading)
      && Number.isFinite(reportedSpeed)
      && reportedSpeed! > 1
    );
    const headingTarget = movingWithReportedHeading ? reportedHeading! : inferredHeading;
    const heading = smoothHeading(
      journeyHeadingRef.current,
      headingTarget,
      movingWithReportedHeading ? 0.46 : 0.32,
    );
    const filteredCoordinate = smoothGpsCoordinate(previous, coordinate, accuracy);
    const markerMovementThreshold = Math.max(
      4,
      Math.min(15, Math.max(previousAccuracy, accuracy) * 0.35),
    );
    const markerMoved = previous === null
      || gpsCoordinateMoved(previous, filteredCoordinate, distanceMeters, markerMovementThreshold);
    if (markerMoved) {
      if (previous) {
        journeyTravelledMetersRef.current += Math.min(
          250,
          distanceMeters(previous, filteredCoordinate),
        );
      }
      previousJourneyPositionRef.current = filteredCoordinate;
      setJourneyPosition(filteredCoordinate);
    }
    previousJourneyAccuracyRef.current = accuracy;
    journeyHeadingRef.current = heading;
    setJourneyAccuracy(accuracy);
    setJourneyHeading(heading);
    setGpsState("live");

    const routeResult = selectedRouteRef.current;
    const routeModel = selectedRouteModelRef.current;
    if (!routeResult || !routeModel) return;
    const mode = transportModeRef.current;
    const policy = navigationPolicy[mode];
    const routeEnd = routeResult.coordinates[routeResult.coordinates.length - 1];
    const arrivalTolerance = policy.arrivalMeters + Math.min(accuracy, 25);
    const progress = calculateRouteProgress(routeModel, filteredCoordinate, routeResult.minutes);
    const minimumTravelBeforeArrival = Math.min(80, routeResult.distance * 100);
    const isArrivalReading = Boolean(
      routeEnd
      && distanceMeters(filteredCoordinate, routeEnd) <= arrivalTolerance
      && progress.remainingMeters <= arrivalTolerance * 1.5
      && journeyTravelledMetersRef.current >= minimumTravelBeforeArrival
    );
    arrivalReadingsRef.current = isArrivalReading ? arrivalReadingsRef.current + 1 : 0;
    if (arrivalReadingsRef.current >= 2) {
      finishNavigation(true);
      return;
    }

    const now = Date.now();
    const offRouteDecision = evaluateOffRouteReading({
      currentReadings: offRouteReadingsRef.current,
      offRouteMeters: progress.offRouteMeters,
      thresholdMeters: policy.offRouteMeters + Math.min(accuracy, 60),
      requiredReadings: policy.readings,
      now,
      lastCalculationAt: lastJourneyCalculationRef.current,
      cooldownMs: 15_000,
      calculationInProgress: loadingRef.current,
    });
    offRouteReadingsRef.current = offRouteDecision.readings;
    if (offRouteDecision.readings > 0) setGpsState("offroute");
    if (offRouteDecision.shouldRecalculate) {
      if (!navigator.onLine) {
        setIsRecalculating(false);
        setGpsState("offroute");
        setStatus("Fuori percorso, ma sei offline. Mantengo l’ultimo percorso.");
        return;
      }
      lastJourneyCalculationRef.current = now;
      lastJourneyOriginRef.current = filteredCoordinate;
      setIsRecalculating(true);
      setGpsState("recalculating");
      setStatus(`Fuori percorso · ricalcolo per ${transportMeta[mode].article}…`);
      void calculateRoutes(
        { label: "Posizione GPS live", coordinate: filteredCoordinate },
        {
          mode,
          preserveRoute: activeRouteRef.current,
          force: true,
          journeySession: session,
        },
      );
      return;
    }

    setStatus(`GPS attivo · precisione ±${Math.round(accuracy)} m · ${formatDistance(progress.remainingMeters)} rimanenti.`);
  }

  function startNavigation(mode: JourneyMode) {
    if (!isLiveResult || !selectedRoute.coordinates.length) {
      setStatus("Calcola e seleziona prima un percorso Lastrico.");
      return;
    }
    if (isJourneyActive) finishNavigation();
    setPickingMode(null);
    setReportModalOpen(false);
    setReportStart(null);
    setReportEnd(null);
    setReportSubmitError("");
    setDirectionsOpen(false);
    const session = navigationSessionRef.current + 1;
    navigationSessionRef.current = session;
    journeyModeRef.current = mode;
    setArrived(false);
    setFollowVehicle(true);
    setJourneyMode(mode);
    setIsJourneyActive(true);
    journeyActiveRef.current = true;
    setJourneyPosition(null);
    setJourneyAccuracy(null);
    setJourneyHeading(0);
    journeyHeadingRef.current = 0;
    previousJourneyPositionRef.current = null;
    previousJourneyAccuracyRef.current = null;
    previousJourneyTimestampRef.current = null;
    selectedRouteRef.current = selectedRoute;
    selectedRouteModelRef.current = selectedRouteModel;
    endLocationRef.current = endLocation;
    lastJourneyCalculationRef.current = 0;
    offRouteReadingsRef.current = 0;
    arrivalReadingsRef.current = 0;
    journeyTravelledMetersRef.current = 0;
    lastSpokenInstructionRef.current = "";
    cameraLastUpdateRef.current = 0;
    cameraLastCenterRef.current = null;
    cameraLastHeadingRef.current = 0;
    void requestWakeLock();
    const currentTransport = transportMeta[transportModeRef.current];
    speakInstruction(mode === "simulation"
      ? `Simulazione del percorso Lastrico in ${currentTransport.label.toLowerCase()}`
      : `Navigazione Lastrico in ${currentTransport.label.toLowerCase()} avviata`);

    if (mode === "simulation") {
      setGpsState("idle");
      const coordinates = selectedRoute.coordinates;
      setJourneyPosition(coordinates[0]);
      setJourneyHeading(coordinates.length > 1 ? bearingBetween(coordinates[0], coordinates[1]) : 0);
      setJourneyAccuracy(5);
      setStatus(`SIMULAZIONE ${currentTransport.short} · avanzamento automatico senza GPS.`);
      return;
    }
    if (!navigator.geolocation) {
      finishNavigation();
      setGpsState("unavailable");
      setStatus("Il GPS non è disponibile su questo dispositivo. Puoi usare Simula percorso.");
      return;
    }
    setGpsState("requesting");
    setStatus("Autorizza la posizione precisa: aggancio il GPS al percorso Lastrico…");
    journeyWatchRef.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (
          !journeyActiveRef.current
          || journeyModeRef.current !== "gps"
          || session !== navigationSessionRef.current
        ) return;
        const coordinate: Coordinate = [coords.longitude, coords.latitude];
        const inMilan = (
          coordinate[0] >= MILAN_GPS_BOUNDS.west
          && coordinate[0] <= MILAN_GPS_BOUNDS.east
          && coordinate[1] >= MILAN_GPS_BOUNDS.south
          && coordinate[1] <= MILAN_GPS_BOUNDS.north
        );
        if (!inMilan) {
          setGpsState("weak");
          setStatus("La navigazione della beta copre per ora soltanto Milano.");
          return;
        }
        const timedReading = evaluateTimedGpsReading({
          coordinate,
          accuracy: coords.accuracy,
          timestamp,
          now: Date.now(),
          previousCoordinate: previousJourneyPositionRef.current,
          previousTimestamp: previousJourneyTimestampRef.current,
          bounds: MILAN_GPS_BOUNDS,
          distanceMeters,
          maximumSpeedMetersPerSecond: transportModeRef.current === "bicycle" ? 22 : 70,
        });
        if (!timedReading.accepted) {
          offRouteReadingsRef.current = 0;
          arrivalReadingsRef.current = 0;
          setGpsState("weak");
          setJourneyAccuracy(coords.accuracy);
          setStatus(timedReading.reason === "invalid"
            ? `Segnale GPS debole (±${Math.round(coords.accuracy)} m). Mantengo l’ultimo percorso.`
            : "Posizione GPS non affidabile o non recente. Mantengo l’ultimo punto valido.");
          return;
        }
        previousJourneyTimestampRef.current = timestamp;
        updateJourneyPosition(
          coordinate,
          coords.accuracy,
          coords.heading,
          coords.speed,
          session,
        );
      },
      (error) => {
        if (session !== navigationSessionRef.current) return;
        offRouteReadingsRef.current = 0;
        arrivalReadingsRef.current = 0;
        if (error.code === error.PERMISSION_DENIED) {
          finishNavigation();
          setGpsState("unavailable");
          setStatus("Permesso GPS negato. Abilita la posizione in Safari oppure usa Simula percorso.");
          return;
        }
        setGpsState("weak");
        setStatus(error.code === error.TIMEOUT
          ? "GPS in attesa: il segnale sta impiegando più tempo del previsto."
          : "Posizione temporaneamente non disponibile. Mantengo l’ultimo punto valido.");
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 },
    );
  }

  function recenterNavigation() {
    setFollowVehicle(true);
    if (journeyPosition) {
      mapRef.current?.easeTo({
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
      title: "Lastrico — Milano senza sobbalzi",
      text: "Prova la beta che confronta il percorso rapido con quello che riduce il pavé noto a Milano.",
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

  return (
    <main className={`app-shell ${isJourneyActive ? "journey-active" : ""} ${picking ? "map-picking-active" : ""}`}>
      <header className="app-bar">
        <button className="brand" type="button" onClick={() => setActivePanel("plan")} aria-label="Apri pianificazione">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>lastrico</span>
        </button>
        <div className="app-bar-actions">
          <button type="button" className="icon-button theme-button" onClick={cycleTheme} aria-label={`Tema: ${themeMode}`} title={`Tema ${themeMode} · ora ${resolvedTheme}`}>
            {themeMode === "auto" ? "◐" : themeMode === "light" ? "☀" : "☾"}
          </button>
          <button type="button" className="icon-button" onClick={shareBeta} aria-label="Condividi beta" title="Condividi">↗</button>
          <button
            type="button"
            className="report-button"
            onClick={startReport}
            aria-label="Segnala una strada"
            title={isJourneyActive ? "Termina la navigazione per segnalare" : "Segnala una strada"}
            disabled={isJourneyActive}
          >
            <span aria-hidden="true">⚠</span>
            <b>Segnala</b>
          </button>
          <button type="button" className="icon-button" aria-label="Informazioni sulla beta" onClick={() => setDetailsOpen(true)}>i</button>
        </div>
      </header>

      <div className="app-workspace">
        <aside className="control-panel" aria-label="Pannello percorso">
          <nav className="view-tabs" aria-label="Sezioni beta">
            {([
              ["plan", "Pianifica"],
              ["routes", "Percorsi"],
              ["community", "Comunità"],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={activePanel === value ? "active" : ""}
                onClick={() => setActivePanel(value)}
                disabled={value === "routes" && !isLiveResult}
              >
                {label}
                {value === "routes" && isLiveResult && <i />}
              </button>
            ))}
          </nav>

          <div className="panel-content">
            {activePanel === "plan" && (
              <section className="planner-panel">
                <div className="panel-heading">
                  <h1>Dove andiamo?</h1>
                </div>

                <div className="compact-locations">
                  <div className="field-shell">
                    <div className={`compact-field ${picking === "start" ? "picking" : ""} ${addressSearchTarget === "start" ? "searching" : ""}`}>
                      <i className="origin-dot" />
                      <label htmlFor="start-search">Partenza</label>
                      <input
                        id="start-search"
                        value={startText}
                        onChange={(event) => {
                          setStartText(event.target.value);
                          if (addressSearchTarget === "start") {
                            setAddressSearchTarget(null);
                            setAddressResults([]);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void searchAddresses("start");
                          }
                        }}
                        placeholder="Via e numero civico"
                        autoComplete="off"
                        enterKeyHint="search"
                        spellCheck={false}
                        role="combobox"
                        aria-expanded={addressSearchTarget === "start" && addressResults.length > 0}
                        aria-controls="start-address-results"
                      />
                      <button
                        type="button"
                        onClick={startText.trim() ? () => void searchAddresses("start") : useCurrentLocation}
                        aria-label={startText.trim() ? "Cerca indirizzo di partenza" : "Usa posizione GPS"}
                      >
                        {addressSearchLoading && addressSearchTarget === "start" ? "…" : startText.trim() ? "⌕" : "◎"}
                      </button>
                    </div>
                  </div>
                  <button type="button" className="swap-button" onClick={swapLocations} aria-label="Inverti partenza e destinazione">⇅</button>
                  <div className="field-shell">
                    <div className={`compact-field ${picking === "end" ? "picking" : ""} ${addressSearchTarget === "end" ? "searching" : ""}`}>
                      <i className="destination-dot" />
                      <label htmlFor="end-search">Destinazione</label>
                      <input
                        id="end-search"
                        value={endText}
                        onChange={(event) => {
                          setEndText(event.target.value);
                          if (addressSearchTarget === "end") {
                            setAddressSearchTarget(null);
                            setAddressResults([]);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void searchAddresses("end");
                          }
                        }}
                        placeholder="Via e numero civico"
                        autoComplete="off"
                        enterKeyHint="search"
                        spellCheck={false}
                        role="combobox"
                        aria-expanded={addressSearchTarget === "end" && addressResults.length > 0}
                        aria-controls="end-address-results"
                      />
                      <button type="button" onClick={() => void searchAddresses("end")} aria-label="Cerca indirizzo di destinazione">
                        {addressSearchLoading && addressSearchTarget === "end" ? "…" : "⌕"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="location-tools">
                  <button type="button" onClick={() => setPickingMode(picking === "start" ? null : "start")}>Partenza su mappa</button>
                  <button type="button" onClick={() => setPickingMode(picking === "end" ? null : "end")}>Arrivo su mappa</button>
                </div>

                <div className="transport-block">
                  <span>Come ti muovi?</span>
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
                        {transportMeta[mode].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="avoidance-block">
                  <div>
                    <span>Quanto evitare il pavé?</span>
                    <small>Più forte può significare qualche minuto in più.</small>
                  </div>
                  <div className="segmented" role="group" aria-label="Livello di evitamento">
                    {([
                      ["balanced", "Bilanciato"],
                      ["strong", "Forte"],
                      ["maximum", "Massimo"],
                    ] as [Avoidance, string][]).map(([value, label]) => (
                      <button type="button" key={value} className={avoidance === value ? "active" : ""} onClick={() => setManualAvoidance(value)}>{label}</button>
                    ))}
                  </div>
                </div>

                <form className="route-prompt" onSubmit={interpretRoutePrompt} data-testid="route-prompt-demo">
                  <label htmlFor="route-preference-prompt">
                    <span>Descrivi la tua preferenza <b>demo</b></span>
                    <small>Interprete locale, non AI: comprende solo pavé e minuti extra.</small>
                  </label>
                  <div className="route-prompt-entry">
                    <textarea
                      id="route-preference-prompt"
                      value={routePrompt}
                      onChange={(event) => {
                        setRoutePrompt(event.target.value);
                        setPromptInterpretation(null);
                      }}
                      placeholder="Es. Evita il pavé anche con massimo 8 minuti in più"
                      rows={2}
                      maxLength={180}
                    />
                    <button type="submit">Interpreta</button>
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
                        <button type="button" onClick={applyInterpretedRoutePrompt}>Applica al percorso</button>
                      )}
                    </div>
                  )}
                </form>

                <button type="button" className="primary-action" onClick={() => void calculateRoutes()} disabled={isLoading}>
                  <span>{isLoading ? "Analizzo le strade…" : "Confronta i percorsi"}</span>
                  <b>{isLoading ? "···" : "→"}</b>
                </button>
              </section>
            )}

            {activePanel === "routes" && (
              <section className="routes-panel" data-testid="route-panel" data-transport={transportMode}>
                <div className="panel-heading routes-heading">
                  <div>
                    <h2>Percorsi in {transportMeta[transportMode].label.toLowerCase()}</h2>
                    <p>{alternativesAnalyzed} alternative{lastRecalculatedAt ? ` · ${lastRecalculatedAt}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => void calculateRoutes()} disabled={isLoading}>
                    {isLoading ? "Calcolo…" : "↻ Ricalcola"}
                  </button>
                </div>

                <div className="route-options" role="radiogroup" aria-label={`Percorso ${transportMeta[transportMode].label}`}>
                  {hasDistinctAlternative ? (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={activeRoute === "safe"}
                      data-testid="route-option-safe"
                      className={`route-option safe ${activeRoute === "safe" ? "selected" : ""}`}
                      onClick={() => selectActiveRoute("safe")}
                    >
                      <span className="route-radio" />
                      <span className="route-name"><b>Anti-pavé · {transportMeta[transportMode].label}</b><small>{safeRoute.distance.toFixed(1)} km · {safeRoute.paveMeters} m noti</small></span>
                      <strong>{formatMinutes(safeRoute.minutes)}<small> min</small></strong>
                      <em>+{formatMinutes(Math.max(0, safeRoute.minutes - fastRoute.minutes))}</em>
                    </button>
                  ) : (
                    <div className="route-option no-alternative">
                      <span className="route-radio" />
                      <span className="route-name"><b>Nessuna deviazione migliore</b><small>Le alternative controllate non riducono il pavé noto</small></span>
                      <strong>—</strong>
                    </div>
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={activeRoute === "fast"}
                    data-testid="route-option-fast"
                    className={`route-option fast ${activeRoute === "fast" ? "selected" : ""}`}
                    onClick={() => selectActiveRoute("fast")}
                  >
                    <span className="route-radio" />
                    <span className="route-name"><b>Più rapido · {transportMeta[transportMode].label}</b><small>{fastRoute.distance.toFixed(1)} km · {fastRoute.paveMeters} m noti</small></span>
                    <strong>{formatMinutes(fastRoute.minutes)}<small> min</small></strong>
                    <em>base</em>
                  </button>
                </div>

                <div className="impact-strip">
                  <div><small>Pavé evitato</small><strong>{savedPave.toLocaleString("it-IT")} m</strong></div>
                  <div><small>Riduzione</small><strong>{fastRoute.paveMeters ? Math.round(savedPave / fastRoute.paveMeters * 100) : 0}%</strong></div>
                  <div><small>Dati</small><strong>{isLiveResult ? "OSM" : "Demo"}</strong></div>
                </div>

                <div className={`profile-note ${routingProfile.approximate ? "warning" : ""}`}>
                  {routingProfile.notice}
                </div>

                <button type="button" className="journey-button" data-testid="start-navigation" onClick={() => startNavigation("gps")}>
                  <span>▶</span>
                  <b>Avvia con GPS</b>
                  <small>La freccia segue la tua posizione reale</small>
                </button>
                <div className="route-actions">
                  <button
                    type="button"
                    className={voiceEnabled ? "active" : ""}
                    onClick={toggleVoiceGuidance}
                    aria-pressed={voiceEnabled}
                    disabled={!voiceAvailable}
                  >
                    {!voiceAvailable ? "Voce non disponibile" : voiceEnabled ? "🔊 Voce attiva" : "🔇 Voce disattivata"}
                  </button>
                  <button type="button" onClick={() => startNavigation("simulation")}>▷ Simula percorso</button>
                  <button type="button" onClick={() => setMapChooserOpen(true)}>Fallback mappe ↗</button>
                </div>
              </section>
            )}

            {activePanel === "community" && (
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
            )}
          </div>

          <div className={`status-bar ${isLoading ? "loading" : ""}`} role="status">
            <i /> <span>{status}</span>
          </div>
        </aside>

        <section className="map-stage" id="map-stage" aria-label="Mappa dei percorsi">
          <div ref={mapContainer} className="map" />
          {isJourneyActive && (
            <div className="navigation-hud" aria-label="Navigazione Lastrico" data-testid="navigation-hud" data-transport={transportMode}>
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
                <div className="navigation-mode">
                  <span>{navigationModeLabel}</span>
                  <small>{transportMeta[transportMode].short}</small>
                  <small>{activeRoute === "safe" ? "ANTI-PAVÉ" : "RAPIDO"}</small>
                </div>
                <div className="maneuver-glyph" aria-hidden="true">
                  {directionGlyph(navigationProgress.instruction?.direction)}
                </div>
                <div className="maneuver-copy">
                  <strong>{formatDistance(navigationProgress.instructionDistance)}</strong>
                  <b aria-live="polite">{isRecalculating ? `Ricalcolo per ${transportMeta[transportMode].article}…` : navigationProgress.instruction?.text ?? "Segui il percorso Lastrico"}</b>
                  {navigationProgress.instruction?.roadName && <small>{navigationProgress.instruction.roadName}</small>}
                  <span className="directions-hint">Tutte le svolte</span>
                </div>
              </button>

              <section className="navigation-tripbar">
                <div className="trip-metric"><strong>{Math.max(0, Math.ceil(navigationProgress.remainingMinutes))}</strong><small>min</small></div>
                <div className="trip-metric wide"><strong>{formatDistance(navigationProgress.remainingMeters)}</strong><small>rimanenti</small></div>
                <div className="trip-metric eta"><strong>{formatArrivalTime(navigationProgress.remainingMinutes)}</strong><small>arrivo stimato</small></div>
                <div className="navigation-controls">
                  <button
                    type="button"
                    onClick={toggleVoiceGuidance}
                    aria-pressed={voiceEnabled}
                    aria-label={voiceEnabled ? "Disattiva voce" : "Attiva voce"}
                    disabled={!voiceAvailable}
                  >
                    {!voiceAvailable ? "Voce non disponibile" : voiceEnabled ? "🔊 Voce attiva" : "🔇 Voce spenta"}
                  </button>
                  <button type="button" onClick={recenterNavigation} aria-label="Ricentra la mappa">
                    {followVehicle ? "Centrata" : "Ricentra"}
                  </button>
                  <button type="button" className="stop-navigation" onClick={() => finishNavigation()} aria-label="Termina navigazione">Termina</button>
                </div>
                <p>{navigationStateDescription}</p>
              </section>
              <div className="driving-safety">{transportMeta[transportMode].safety}</div>
            </div>
          )}
          <div className="map-top">
            <div className="confidence-pill">
              {picking
                ? picking === "reportStart"
                  ? "Tocca l’inizio del tratto"
                  : picking === "reportEnd"
                    ? "Tocca la fine del tratto"
                    : `Tocca la ${picking === "start" ? "partenza" : "destinazione"}`
                : isJourneyActive
                  ? `${navigationModeLabel} · percorso Lastrico`
                  : isLiveResult
                    ? hasDistinctAlternative
                      ? `${transportMeta[transportMode].short} · ${alternativesAnalyzed} percorsi · deviazione trovata`
                      : `${transportMeta[transportMode].short} · ${alternativesAnalyzed} percorsi · nessuna deviazione migliore`
                    : "Esempio iniziale"}
            </div>
            {(picking === "reportStart" || picking === "reportEnd") && (
              <button type="button" className="cancel-map-action" onClick={cancelReport}>Annulla</button>
            )}
          </div>
          <div className="map-key">
            {hasDistinctAlternative && <span><i className="line safe" /> Anti-pavé</span>}
            <span><i className="line fast" /> Rapido</span>
            <span><i className="line pave" /> Pavé</span>
            <span><i className="line community" /> Segnalazioni verificate</span>
          </div>
          {isLiveResult && (
            <button type="button" className="map-summary" onClick={() => setActivePanel("routes")}>
              <span className={activeRoute === "safe" ? "summary-route safe" : "summary-route"}>
                {transportMeta[transportMode].short} · {activeRoute === "safe" ? "Anti-pavé" : "Più rapido"}
              </span>
              <strong>{formatMinutes(activeRoute === "safe" ? safeRoute.minutes : fastRoute.minutes)} <small>min</small></strong>
              <span>{activeRoute === "safe" ? safeRoute.paveMeters : fastRoute.paveMeters} m di pavé noto</span>
              <b>Dettagli ↑</b>
            </button>
          )}
        </section>
      </div>

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

      <nav className="mobile-nav" aria-label="Navigazione beta">
        <button type="button" className={activePanel === "plan" ? "active" : ""} onClick={() => setActivePanel("plan")}><span>⌖</span>Pianifica</button>
        <button type="button" className={activePanel === "routes" ? "active" : ""} onClick={() => setActivePanel("routes")} disabled={!isLiveResult}><span>↝</span>Percorsi</button>
        <button type="button" className={activePanel === "community" ? "active" : ""} onClick={() => setActivePanel("community")}><span>＋</span>Comunità</button>
      </nav>

      {arrived && (
        <div className="arrival-banner" role="status">
          <span>●</span>
          <div><b>Sei arrivato</b><small>Navigazione Lastrico terminata</small></div>
          <button type="button" onClick={() => setArrived(false)} aria-label="Chiudi">×</button>
        </div>
      )}

      {addressSearchTarget && addressResults.length > 0 && (
        <div className="modal-backdrop address-picker-backdrop" role="presentation">
          <section className="modal address-picker" role="dialog" aria-modal="true" aria-labelledby="address-picker-title">
            <button type="button" className="modal-close" onClick={closeAddressPicker} aria-label="Chiudi">×</button>
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
                  onClick={() => chooseAddress(addressSearchTarget, result)}
                >
                  <b>{result.primary}</b>
                  <small>{result.secondary || "Milano"}</small>
                </button>
              ))}
            </div>
            <button type="button" className="secondary-action address-cancel" onClick={closeAddressPicker}>Annulla</button>
          </section>
        </div>
      )}

      {mapChooserOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setMapChooserOpen(false)}>
          <section className="modal map-app-modal" role="dialog" aria-modal="true" aria-labelledby="map-app-title" data-testid="fallback-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setMapChooserOpen(false)} aria-label="Chiudi">×</button>
            <span className="eyebrow">Fallback · {transportMeta[transportMode].label}</span>
            <h2 id="map-app-title">Apri un’altra app</h2>
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
          </section>
        </div>
      )}

      {reportModalOpen && reportStart && reportEnd && (
        <div className="modal-backdrop" role="presentation" onClick={cancelReport}>
          <form
            className="modal report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-title"
            onSubmit={submitReport}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="modal-close" onClick={cancelReport} aria-label="Chiudi">×</button>
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
              <button type="submit" className="report-submit-button" disabled={isSubmittingReport}>
                {isSubmittingReport ? "Invio…" : "Invia segnalazione"}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetailsOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailsOpen(false)} aria-label="Chiudi">×</button>
            <span className="eyebrow">Beta tester kit</span>
            <h2 id="about-title">Portala sull’iPhone.</h2>
            <ol className="install-steps">
              <li>Apri questa pagina in Safari.</li>
              <li>Tocca Condividi e “Aggiungi alla schermata Home”.</li>
              <li>Attiva “Apri come app web”.</li>
              <li>Consenti il GPS solo quando avvii il test.</li>
            </ol>
            <div className="beta-limit">
              <b>Questa è una beta, non un navigatore certificato.</b>
              <span>Servizio gratuito best-effort per pochi tester: tempi senza traffico live, copertura pavé incompleta, disponibilità non garantita e nessuna interfaccia CarPlay.</span>
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
              <button type="button" className="secondary-action" onClick={shareBeta}>Condividi beta</button>
              <button type="button" className="primary-action compact" onClick={() => setDetailsOpen(false)}>Inizia il test</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
