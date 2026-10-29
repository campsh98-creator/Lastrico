export type PilotAreaId = "milan" | "roccella";
export type PilotArea = {
  id: PilotAreaId;
  name: string;
  bounds: { west: number; south: number; east: number; north: number };
  center: [number, number];
};
export const PILOT_AREAS: Record<PilotAreaId, PilotArea> = {
  milan: { id: "milan", name: "Milano", bounds: { west: 9.04, south: 45.38, east: 9.31, north: 45.55 }, center: [9.19, 45.464] },
  roccella: { id: "roccella", name: "Roccella Ionica", bounds: { west: 16.36, south: 38.29, east: 16.44, north: 38.35 }, center: [16.4008, 38.3224] },
};
export function isPilotAreaId(value: string): value is PilotAreaId {
  return Object.hasOwn(PILOT_AREAS, value);
}
export function coordinateInArea(coordinate: [number, number], area: PilotArea) {
  const [lon, lat] = coordinate;
  const b = area.bounds;
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}
export function areaForCoordinate(coordinate: [number, number]): PilotArea | undefined {
  return Object.values(PILOT_AREAS).find((area) => coordinateInArea(coordinate, area));
}

export type TransportMode = "car" | "motorcycle" | "bicycle";

export type PilotJourneyPreset = {
  id: string;
  areaId: PilotAreaId;
  name: string;
  description: string;
  modes: TransportMode[];
  start: { label: string; coordinate: [number, number] };
  end: { label: string; coordinate: [number, number] };
};

export const PILOT_JOURNEYS: PilotJourneyPreset[] = [
  // Milano Pilot Journeys
  {
    id: "milan-brera-santa-sofia",
    areaId: "milan",
    name: "Brera → Santa Sofia",
    description: "Attraversamento centro storico: test pavé storico (via Verdi, via Larga, Corso Italia)",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Brera (via Fiori Chiari)", coordinate: [9.1886, 45.4721] },
    end: { label: "Santa Sofia / Missori", coordinate: [9.1887, 45.4607] },
  },
  {
    id: "milan-castello-porta-venezia",
    areaId: "milan",
    name: "Castello → Porta Venezia",
    description: "Asse nord-est attraverso Foro Buonaparte, Bastioni e corso di Porta Venezia",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Castello Sforzesco", coordinate: [9.1785, 45.4705] },
    end: { label: "Porta Venezia", coordinate: [9.2056, 45.4731] },
  },
  {
    id: "milan-cadorna-darsena",
    areaId: "milan",
    name: "Cadorna → Darsena",
    description: "Corridoio sud-ovest via Carducci, via De Amicis verso la Darsena dei Navigli",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Cadorna", coordinate: [9.1765, 45.4682] },
    end: { label: "Darsena / Navigli", coordinate: [9.1771, 45.4523] },
  },
  // Roccella Ionica Pilot Journeys
  {
    id: "roccella-borgo-marina",
    areaId: "roccella",
    name: "Castello Carafa → Lungomare",
    description: "Discesa dal borgo medievale (via Città) al Lungomare Sisinio Zito",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Castello Carafa / Borgo", coordinate: [16.4068, 38.3260] },
    end: { label: "Lungomare Sisinio Zito", coordinate: [16.3959, 38.3182] },
  },
  {
    id: "roccella-san-vittorio-garibaldi",
    areaId: "roccella",
    name: "Piazza S. Vittorio → Stazione",
    description: "Attraversamento centro abitato verso via Giuseppe Garibaldi",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Piazza San Vittorio", coordinate: [16.4047, 38.3219] },
    end: { label: "Via Giuseppe Garibaldi", coordinate: [16.3990, 38.3242] },
  },
  {
    id: "roccella-cavone-marina",
    areaId: "roccella",
    name: "Via Cavone → Lungomare Sud",
    description: "Collegamento litoraneo nord-est via SS106 verso il lungomare centrale",
    modes: ["car", "motorcycle", "bicycle"],
    start: { label: "Via Cavone", coordinate: [16.4131, 38.3240] },
    end: { label: "Lungomare Sisinio Zito", coordinate: [16.3959, 38.3182] },
  },
];

export function getPilotJourneys(areaId: PilotAreaId): PilotJourneyPreset[] {
  return PILOT_JOURNEYS.filter((journey) => journey.areaId === areaId);
}
