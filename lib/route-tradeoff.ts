/**
 * Route trade-off explanation (Phase 4.21).
 *
 * Pure description of what the anti-pavé alternative returned by `/api/routes` changes compared
 * with the `fast` route of the same response, which the handler builds with
 * `fastestLegalCandidate` (the real fastest legal route). This module does not select routes: the
 * production selector in `lib/route-optimization.ts` stays the only decision rule. The sentence
 * states measured differences only, so it can never explain a choice with a different formula.
 *
 * Honesty rules:
 * - A saving exists only when the server reports a distinct alternative and known pavé goes down.
 * - Confirmed and probable pavé are named separately only when the response carries a consistent
 *   split; otherwise the figure is "pavé noto" (confirmed + probable), never "confermato".
 * - An increase of either kind is stated, not netted away (above the noise floor).
 * - Unknown surface is never described as smooth: added unverified metres are listed as a cost.
 *
 * No I/O, no React, no imports: safe for the client bundle and for `node --test`.
 */

export type TradeoffRoute = {
  /** Travel time in minutes. */
  minutes: number;
  /** Length in kilometres. */
  distance: number;
  /** Known pavé: confirmed + probable metres. */
  paveMeters: number;
  confirmedPaveMeters?: number;
  probablePaveMeters?: number;
  unknownSurfaceMeters?: number;
  smoothSurfaceMeters?: number;
  unpavedSurfaceMeters?: number;
  surfaceTotalMeters?: number;
};

export type ActiveRoute = "fast" | "safe";

export const TRADEOFF_RULES = {
  /** Differences smaller than this many metres are data noise and are not named on their own. */
  noiseFloorMeters: 10,
  /** Added unverified metres are named when they reach this share of the known pavé avoided. */
  unknownShareOfSaving: 0.25,
  /** Extra distance is named only when it is at least this many kilometres... */
  distanceMinimumKilometres: 0.5,
  /** ...and at least this share of the fastest route; otherwise the minutes already tell the cost. */
  distanceShareOfFastest: 0.25,
  /** Split tolerance: confirmed + probable may differ from paveMeters by rounding only. */
  splitToleranceMeters: 1,
} as const;

export type FastSurfaceState = "no-data" | "no-known-pave" | "known-pave";

export type RouteTradeoff =
  | {
      kind: "alternative";
      /** True when confirmed and probable metres are known for both routes. */
      splitAvailable: boolean;
      /** Known pavé avoided (fast − alternative), whole metres, always > 0. */
      knownAvoidedMeters: number;
      /** Confirmed pavé avoided; negative means the alternative adds confirmed pavé. Null without split. */
      confirmedAvoidedMeters: number | null;
      /** Probable pavé avoided; negative means the alternative adds probable pavé. Null without split. */
      probableAvoidedMeters: number | null;
      /** Extra minutes: difference of the two times shown on the cards (0.1 min; 0 = same time). */
      extraMinutes: number;
      /** Extra length: difference of the two distances shown on the cards (0.1 km; negative = shorter). */
      extraKilometres: number;
      /** Extra unverified metres (negative means fewer). Never counted as smooth. */
      unknownAddedMeters: number;
      /** Extra unpaved metres (negative means fewer). */
      unpavedAddedMeters: number;
      mentionDistance: boolean;
      mentionUnknown: boolean;
      mentionUnpaved: boolean;
    }
  | {
      kind: "none";
      reason: "no-distinct-alternative" | "no-known-saving";
      fastSurface: FastSurfaceState;
    };

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const TENTH = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, useGrouping: false });

/** Rounds to one decimal exactly as the Italian card labels do (same Intl rounding), never -0. */
function roundTenth(value: number): number {
  return Number(TENTH.format(value)) + 0;
}

function wholeMeters(value: number | undefined): number {
  return finite(value) ? Math.round(value) + 0 : 0;
}

/** Unknown metres: the reported value, or what is left after known surfaces. Never negative. */
export function computeUnknownMeters(route: TradeoffRoute): number {
  if (finite(route.unknownSurfaceMeters)) return Math.max(0, route.unknownSurfaceMeters);
  const total = route.surfaceTotalMeters ?? route.distance * 1000;
  const known = route.paveMeters + (route.smoothSurfaceMeters ?? 0) + (route.unpavedSurfaceMeters ?? 0);
  return Math.max(0, total - known);
}

export function hasPaveSplit(route: TradeoffRoute): boolean {
  const { confirmedPaveMeters: confirmed, probablePaveMeters: probable } = route;
  return finite(confirmed) && finite(probable) && confirmed >= 0 && probable >= 0
    && Math.abs(confirmed + probable - route.paveMeters) <= TRADEOFF_RULES.splitToleranceMeters;
}

function fastSurfaceState(fast: TradeoffRoute): FastSurfaceState {
  if (wholeMeters(fast.paveMeters) > 0) return "known-pave";
  const verified = (fast.smoothSurfaceMeters ?? 0) + (fast.unpavedSurfaceMeters ?? 0);
  // Only a response that reports surface fields can say "no data"; a bare route just has no known pavé.
  const reportsSurface = finite(fast.smoothSurfaceMeters) || finite(fast.unknownSurfaceMeters);
  return reportsSurface && !(verified > 0) ? "no-data" : "no-known-pave";
}

/**
 * Measured differences between the alternative (`safe`) and the fastest route (`fast`).
 * Without a distinct alternative, or without a known pavé reduction, no saving is reported.
 */
export function computeRouteTradeoff(
  fast: TradeoffRoute,
  safe: TradeoffRoute,
  hasDistinctAlternative: boolean,
): RouteTradeoff {
  const knownAvoidedMeters = wholeMeters(fast.paveMeters) - wholeMeters(safe.paveMeters);
  if (!hasDistinctAlternative || knownAvoidedMeters <= 0) {
    return {
      kind: "none",
      reason: hasDistinctAlternative ? "no-known-saving" : "no-distinct-alternative",
      fastSurface: fastSurfaceState(fast),
    };
  }

  const splitAvailable = hasPaveSplit(fast) && hasPaveSplit(safe);
  // Time and distance deltas are taken from the rounded card values, so the sentence and the
  // cards can always be checked against each other by the user.
  const fastKilometres = roundTenth(fast.distance);
  const extraKilometres = roundTenth(roundTenth(safe.distance) - fastKilometres);
  const unknownAddedMeters = Math.round(computeUnknownMeters(safe)) - Math.round(computeUnknownMeters(fast));
  const unpavedAddedMeters = wholeMeters(safe.unpavedSurfaceMeters) - wholeMeters(fast.unpavedSurfaceMeters);
  const floor = TRADEOFF_RULES.noiseFloorMeters;

  return {
    kind: "alternative",
    splitAvailable,
    knownAvoidedMeters,
    confirmedAvoidedMeters: splitAvailable
      ? wholeMeters(fast.confirmedPaveMeters) - wholeMeters(safe.confirmedPaveMeters)
      : null,
    probableAvoidedMeters: splitAvailable
      ? wholeMeters(fast.probablePaveMeters) - wholeMeters(safe.probablePaveMeters)
      : null,
    extraMinutes: roundTenth(roundTenth(safe.minutes) - roundTenth(fast.minutes)),
    extraKilometres,
    unknownAddedMeters,
    unpavedAddedMeters,
    mentionDistance: extraKilometres >= TRADEOFF_RULES.distanceMinimumKilometres
      && extraKilometres >= fastKilometres * TRADEOFF_RULES.distanceShareOfFastest,
    mentionUnknown: unknownAddedMeters >= floor
      && unknownAddedMeters >= knownAvoidedMeters * TRADEOFF_RULES.unknownShareOfSaving,
    mentionUnpaved: unpavedAddedMeters >= floor,
  };
}

/** "291 m", "1,3 km". Whole metres under 1 km, one decimal above (Italian format). */
export function formatMetersIt(meters: number): string {
  const rounded = Math.round(meters) + 0;
  if (Math.abs(rounded) < 1000) return `${rounded} m`;
  return `${(rounded / 1000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** "2,8 km" from kilometres (Italian decimal comma). */
export function formatKilometersIt(kilometres: number): string {
  return `${kilometres.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** "0,7", "12,0": the card format for minutes. */
export function formatMinutesIt(minutes: number): string {
  return minutes.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "1 minuto", "0,7 minuti", "2 minuti": Italian singular only for exactly one (decimals are plural). */
export function formatMinutesPhraseIt(minutes: number): string {
  const value = roundTenth(Math.abs(minutes));
  const text = value.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return `${text} ${value === 1 ? "minuto" : "minuti"}`;
}

function joinIt(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function pavePhrase(tradeoff: Extract<RouteTradeoff, { kind: "alternative" }>): string {
  const known = `${formatMetersIt(tradeoff.knownAvoidedMeters)} di pavé noto`;
  if (!tradeoff.splitAvailable || tradeoff.confirmedAvoidedMeters === null || tradeoff.probableAvoidedMeters === null) {
    return `evita ${known}`;
  }
  const floor = TRADEOFF_RULES.noiseFloorMeters;
  const confirmed = tradeoff.confirmedAvoidedMeters;
  const probable = tradeoff.probableAvoidedMeters;
  // The first named kind says "di pavé ..."; the second follows the idiom of the surface details
  // ("di cui 112 m probabili"): "74 m di pavé confermato e 300 m probabili",
  // "686 m di pavé probabile ma aggiunge 265 m confermati".
  if (confirmed >= floor && probable >= floor) {
    return `evita ${formatMetersIt(confirmed)} di pavé confermato e ${formatMetersIt(probable)} probabili`;
  }
  if (confirmed >= floor) {
    return `evita ${formatMetersIt(confirmed)} di pavé confermato${probable <= -floor ? ` ma aggiunge ${formatMetersIt(-probable)} probabili` : ""}`;
  }
  if (probable >= floor) {
    return `evita ${formatMetersIt(probable)} di pavé probabile${confirmed <= -floor ? ` ma aggiunge ${formatMetersIt(-confirmed)} confermati` : ""}`;
  }
  // Both kinds below the noise floor (a reduction of one with an increase of the other would make
  // the known total negative, which is not an alternative): only the total is meaningful.
  return `evita ${known}`;
}

/**
 * One short Italian sentence for the panel. With an alternative it states, for the route the user
 * is choosing, the pavé avoided and what it costs against the fastest route; without one it says so.
 */
export function describeRouteTradeoff(tradeoff: RouteTradeoff, activeRoute: ActiveRoute): string {
  if (tradeoff.kind === "none") {
    if (tradeoff.fastSurface === "no-data") {
      return "Nessun dato sul fondo di questo percorso: il pavé non è verificabile.";
    }
    if (tradeoff.fastSurface === "no-known-pave") {
      return "Nessun pavé noto sul percorso più rapido.";
    }
    return "Nessuna alternativa migliora il compromesso tra tempo, pavé noto e tratti senza dati.";
  }

  const costs: string[] = [];
  if (tradeoff.extraMinutes > 0) costs.push(formatMinutesPhraseIt(tradeoff.extraMinutes));
  if (tradeoff.mentionDistance) costs.push(formatKilometersIt(tradeoff.extraKilometres));
  if (tradeoff.mentionUnknown) costs.push(`${formatMetersIt(tradeoff.unknownAddedMeters)} di fondo non verificato`);
  if (tradeoff.mentionUnpaved) costs.push(`${formatMetersIt(tradeoff.unpavedAddedMeters)} di sterrato`);

  // `fast` is the fastest legal route, so a negative time difference should not occur; if a
  // response ever contains one, it is stated rather than hidden.
  const faster = tradeoff.extraMinutes < 0;
  let sentence = pavePhrase(tradeoff);
  if (tradeoff.extraMinutes === 0) sentence += " nello stesso tempo";
  if (costs.length > 0) sentence += `, con ${joinIt(costs)} in più`;
  if (faster) sentence += `${costs.length > 0 ? " e" : ", con"} ${formatMinutesPhraseIt(tradeoff.extraMinutes)} in meno`;

  const subject = activeRoute === "safe" ? "" : "L’alternativa ";
  const text = `${subject}${sentence}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
