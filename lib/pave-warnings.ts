/**
 * Phase 4.29 — pavé warnings during navigation, free of browser APIs.
 *
 * Until now the app spoke only manoeuvres: rough sections were drawn on the map but never
 * announced. Each section is announced once, with lead time, worded differently for confirmed
 * and probable stone. A section whose lead point was skipped (a GPS jump, a reroute that starts
 * close to it or inside it) is still announced on entry. The same physical section is never
 * announced twice, even after a reroute replaces the route and its distances.
 */
import type { RoughSection } from "./rough-sections";

export type PaveWarningMode = "car" | "motorcycle" | "bicycle";

export const PAVE_WARNING_POLICY: Record<PaveWarningMode, { leadMeters: number; minVoiceMeters: number; hudMeters: number }> = {
  car: { leadMeters: 250, minVoiceMeters: 80, hudMeters: 600 },
  motorcycle: { leadMeters: 250, minVoiceMeters: 60, hudMeters: 600 },
  bicycle: { leadMeters: 100, minVoiceMeters: 40, hudMeters: 300 },
};

/** Identity of an announced section on the ground, independent of which route it was on. */
export type AnnouncedSection = { start: [number, number]; end: [number, number] };

/**
 * Phase 4.31: words for a section's surface, from its OSM surface tag. Confirmed stone is "pavé"
 * (sett, cobblestone) or "ciottoli" (unhewn_cobblestone); a probable section on paving_stones is
 * "masselli". Nothing is said about asphalt condition: the data does not establish it.
 */
export type SurfaceWords = { title: string; spoken: string; on: string };
export function surfaceWords(section: RoughSection): SurfaceWords {
  if (isConfirmedSection(section)) {
    return section.surface === "unhewn_cobblestone"
      ? { title: "Ciottoli", spoken: "ciottoli", on: "Su ciottoli" }
      : { title: "Pavé", spoken: "pavé", on: "Su pavé" };
  }
  return section.surface === "paving_stones"
    ? { title: "Masselli", spoken: "masselli", on: "Su masselli" }
    : { title: "Pavé probabile", spoken: "pavé probabile", on: "Su pavé probabile" };
}

export type PaveWarningResult = {
  /** sectionStartMeters (Phase 4.34) identifies the section, so a field trace can tell when its warning appeared. */
  hud:
    | { kind: "ahead"; distanceMeters: number; lengthMeters: number; confirmed: boolean; words: SurfaceWords; name?: string; sectionStartMeters: number }
    | { kind: "inside"; remainingMeters: number; confirmed: boolean; words: SurfaceWords; name?: string; sectionStartMeters: number }
    | null;
  speak: { text: string; section: AnnouncedSection } | null;
};

const SAME_SECTION_METERS = 35;

function groundMeters(a: [number, number], b: [number, number]) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** A section whose end (or start) is where an announced one's was: the same stones. */
export function alreadyAnnounced(section: RoughSection, announced: AnnouncedSection[]) {
  return announced.some((previous) => groundMeters(previous.end, section.end) <= SAME_SECTION_METERS
    || groundMeters(previous.start, section.start) <= SAME_SECTION_METERS);
}

/** Confirmed stone makes up most of the section: say "pavé", otherwise "pavé probabile". */
export function isConfirmedSection(section: RoughSection) {
  const total = section.confirmedMeters + section.probableMeters;
  return total > 0 && section.confirmedMeters / total >= 0.6;
}

export function spokenMeters(meters: number) {
  if (meters >= 950) {
    const kilometres = Math.round(meters / 500) / 2;
    return kilometres === 1 ? "1 chilometro" : `${kilometres.toLocaleString("it-IT")} chilometri`;
  }
  const rounded = meters < 100 ? Math.max(10, Math.round(meters / 10) * 10) : Math.round(meters / 50) * 50;
  return `${rounded} metri`;
}

export function evaluatePaveWarning(input: {
  sections: RoughSection[] | undefined;
  progressMeters: number | null;
  mode: PaveWarningMode;
  announced: AnnouncedSection[];
  /** Voice only with a trustworthy fix (or in simulation); the HUD is shown regardless. */
  canSpeak: boolean;
}): PaveWarningResult {
  const sections = input.sections ?? [];
  if (input.progressMeters === null || sections.length === 0) return { hud: null, speak: null };
  const policy = PAVE_WARNING_POLICY[input.mode];
  const progress = input.progressMeters;
  const inside = sections.find((section) => progress >= section.startMeters && progress < section.endMeters);
  const ahead = sections.find((section) => section.startMeters > progress);
  const named = (section: RoughSection) => (section.name ? { name: section.name } : {});
  const hud: PaveWarningResult["hud"] = inside
    ? { kind: "inside", remainingMeters: Math.round(inside.endMeters - progress), confirmed: isConfirmedSection(inside), words: surfaceWords(inside), ...named(inside), sectionStartMeters: inside.startMeters }
    : ahead && ahead.startMeters - progress <= policy.hudMeters
      ? { kind: "ahead", distanceMeters: Math.round(ahead.startMeters - progress), lengthMeters: Math.round(ahead.endMeters - ahead.startMeters), confirmed: isConfirmedSection(ahead), words: surfaceWords(ahead), ...named(ahead), sectionStartMeters: ahead.startMeters }
      : null;

  let speak: PaveWarningResult["speak"] = null;
  if (input.canSpeak) {
    const candidate = inside ?? (ahead && ahead.startMeters - progress <= policy.leadMeters ? ahead : null);
    if (candidate && !alreadyAnnounced(candidate, input.announced)) {
      const remaining = candidate === inside ? candidate.endMeters - progress : candidate.endMeters - candidate.startMeters;
      if (remaining >= policy.minVoiceMeters) {
        const words = surfaceWords(candidate);
        const on = candidate.name ? ` su ${candidate.name}` : "";
        const text = candidate === inside
          ? `${words.title} ora${on}, per circa ${spokenMeters(remaining)}.`
          : `Tra ${spokenMeters(candidate.startMeters - progress)}, ${words.spoken}${on} per circa ${spokenMeters(remaining)}.`;
        speak = { text, section: { start: candidate.start, end: candidate.end } };
      }
    }
  }
  return { hud, speak };
}
