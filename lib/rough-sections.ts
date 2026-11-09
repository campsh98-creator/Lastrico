/**
 * Phase 4.29 — contiguous rough-surface sections along a route, for warnings during navigation.
 *
 * Built from the per-segment marks the scorer already makes, so no extra matching (and no extra
 * Worker CPU) is needed. Adjacent OSM ways and short gaps at junctions merge into one section:
 * a 1 km stone street split into twenty ways is one warning, not twenty.
 */
export type SectionCoordinate = [number, number];

export type RoughSection = {
  /** Metres from the route start, measured on the route geometry. */
  startMeters: number;
  endMeters: number;
  /** Confirmed stone (sett, cobblestone) and probable (paving_stones) metres inside the section. */
  confirmedMeters: number;
  probableMeters: number;
  start: SectionCoordinate;
  end: SectionCoordinate;
  /**
   * Phase 4.31: the OSM name of the way covering most (≥60%) of the section, when one does. Never
   * guessed: a section across several differently named streets has no name.
   */
  name?: string;
  /** Phase 4.31: the OSM surface covering most of the section's rough metres (sett, cobblestone…). */
  surface?: string;
};

export type RoughSegmentFeature = { name: string | null; material: string | null };

export const ROUGH_SECTION_MERGE_GAP_METERS = 25;
export const ROUGH_SECTION_MIN_METERS = 15;

function segmentMeters(a: SectionCoordinate, b: SectionCoordinate) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** `rough` and `confirmed` hold segment indices i (the segment from coordinate i−1 to i). */
export function buildRoughSections(
  coordinates: SectionCoordinate[],
  rough: Set<number> | undefined,
  confirmed: Set<number> | undefined,
  mergeGapMeters = ROUGH_SECTION_MERGE_GAP_METERS,
  minMeters = ROUGH_SECTION_MIN_METERS,
  features?: Map<number, RoughSegmentFeature>,
): RoughSection[] {
  if (!rough || rough.size === 0 || coordinates.length < 2) return [];
  const sections: RoughSection[] = [];
  // Metres per OSM name and per surface inside each section, to name it only when one dominates.
  const tallies = new Map<RoughSection, { names: Map<string, number>; surfaces: Map<string, number> }>();
  let along = 0;
  let current: RoughSection | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const length = segmentMeters(coordinates[index - 1], coordinates[index]);
    if (rough.has(index)) {
      const isConfirmed = confirmed?.has(index) ?? false;
      if (current && along - current.endMeters <= mergeGapMeters) {
        current.endMeters = along + length;
        current.end = coordinates[index];
      } else {
        if (current) sections.push(current);
        current = { startMeters: along, endMeters: along + length, confirmedMeters: 0, probableMeters: 0, start: coordinates[index - 1], end: coordinates[index] };
      }
      if (isConfirmed) current.confirmedMeters += length;
      else current.probableMeters += length;
      const feature = features?.get(index);
      if (feature) {
        const tally = tallies.get(current) ?? { names: new Map(), surfaces: new Map() };
        tallies.set(current, tally);
        if (feature.name) tally.names.set(feature.name, (tally.names.get(feature.name) ?? 0) + length);
        if (feature.material) tally.surfaces.set(feature.material, (tally.surfaces.get(feature.material) ?? 0) + length);
      }
    }
    along += length;
  }
  if (current) sections.push(current);
  const dominant = (counts: Map<string, number> | undefined, total: number) => {
    if (!counts || total <= 0) return undefined;
    let best: [string, number] | null = null;
    for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
    return best && best[1] / total >= 0.6 ? best[0] : undefined;
  };
  return sections
    .filter((section) => section.endMeters - section.startMeters >= minMeters)
    .map((section) => {
      const roughMeters = section.confirmedMeters + section.probableMeters;
      const name = dominant(tallies.get(section)?.names, roughMeters);
      const surface = dominant(tallies.get(section)?.surfaces, roughMeters);
      return { ...section, ...(name ? { name } : {}), ...(surface ? { surface } : {}) };
    })
    .map((section) => ({
      ...section,
      startMeters: Math.round(section.startMeters),
      endMeters: Math.round(section.endMeters),
      confirmedMeters: Math.round(section.confirmedMeters),
      probableMeters: Math.round(section.probableMeters),
    }));
}
