/**
 * Phase 4.31 — the journey's routing objective survives every reroute.
 *
 * Before, each reroute asked for "the kind of route currently shown". A reroute that found no
 * distinct lower-pavé alternative showed the fastest route (honestly, since they were the same),
 * and from then on every reroute asked for the fastest route: the anti-pavé choice was lost for
 * the rest of the journey. The objective is now fixed when navigation starts and only an
 * explicit choice of the person changes it.
 */
export type RouteKind = "safe" | "fast";

/**
 * The objective at navigation start. The fastest route is the objective only when the person (or
 * their typed preference) chose it over a real alternative; a plan without an alternative keeps
 * the anti-pavé objective, so a later reroute can still offer one.
 */
export function journeyObjective(activeRoute: RouteKind, hasDistinctAlternative: boolean): RouteKind {
  return activeRoute === "fast" && hasDistinctAlternative ? "fast" : "safe";
}

/** The route shown after a reroute. Without an alternative both cards are the fastest route. */
export function rerouteDisplayKind(objective: RouteKind, hasDistinctAlternative: boolean): RouteKind {
  return objective === "safe" && hasDistinctAlternative ? "safe" : "fast";
}

/** A short, honest line for the navigation HUD after a successful reroute. */
export function rerouteOutcomeNotice(objective: RouteKind, hasDistinctAlternative: boolean, antiPaveStatus?: string): string {
  if (objective === "fast") return "Nuovo percorso più rapido";
  if (hasDistinctAlternative) return "Nuovo percorso · anti-pavé mantenuto";
  // The penalised search found a route that avoids the standard route's stones and is not slower.
  if (antiPaveStatus === "fastest-avoids-pave") return "Nuovo percorso · anti-pavé mantenuto, ed è anche il più rapido";
  if (antiPaveStatus === "generation-failed" || antiPaveStatus === "generation-skipped") {
    return "Nuovo percorso più rapido · ricerca anti-pavé non riuscita, riprovo al prossimo ricalcolo";
  }
  return "Nuovo percorso · da qui nessuna alternativa con meno pavé";
}
