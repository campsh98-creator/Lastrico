/**
 * EXPERIMENT (local, off by default): tram infrastructure as a separate routing dimension, never as pavement material.
 *
 * Hypothesis under test: for two-wheelers, a route that runs on a carriageway shared with mapped tram rails is worse than an
 * otherwise equivalent route that does not. The rails come from dated open data (DBT 2020, OSM); they say where rails are
 * mapped, not that they are rough today. The pavé score is untouched: the candidate must not have more pavé or surface risk than
 * the route it replaces, and must fit an extra-time budget. Nothing here runs unless LASTRICO_SIL_EXPERIMENT=rails (or
 * configureSilRailExperiment) and a local layer set is readable; otherwise the route is chosen exactly as before.
 */
import type { SilRouteDiagnostics } from "./sil-shadow";

export const SIL_RAIL_EXPERIMENT = {
  /** Minimum reduction of rail exposure worth a different route. */
  minReductionMeters: 50,
  /** Extra time allowed when the request sets no budget: the larger of this many seconds or this share of the fastest route. */
  defaultExtraSeconds: 120,
  defaultExtraShare: 0.1,
} as const;

let override: boolean | undefined;
export function configureSilRailExperiment(enabled: boolean | undefined): void { override = enabled; }
export function silRailExperimentEnabled(): boolean {
  if (override !== undefined) return override;
  const env = typeof process !== "undefined" ? process.env?.LASTRICO_SIL_EXPERIMENT : undefined;
  return env === "rails";
}

/**
 * Metres on mapped rails that share the carriageway. Own right-of-way is not counted (the road does not run on it);
 * rails of unknown class are counted, because the road segment is the one the rails were matched to.
 */
export function railExposureMeters(d: SilRouteDiagnostics): number {
  return d.dbtRailClass.sharedCarriageway + d.dbtRailClass.classUnknown + d.railsMappedBy.osmOnly;
}

/** paveMeters is the route's pavé score, riskMeters adds the probable and unpaved risk: the candidate may not be worse on either. */
export type RailCandidate = { id: number; seconds: number; paveMeters: number; riskMeters: number; diagnostics: SilRouteDiagnostics };
export type RailChoice = { chosen: number; replaced: boolean; exposureBefore: number; exposureAfter: number; extraSeconds: number; reason: string };

/** Picks among candidates; `current` is the id of the route the normal selection chose, `fastestSeconds` the fastest legal route. */
export function chooseRailAware(candidates: RailCandidate[], current: number, fastestSeconds: number, maxExtraMinutes: number | null): RailChoice {
  const cur = candidates.find((c) => c.id === current);
  if (!cur) return { chosen: current, replaced: false, exposureBefore: 0, exposureAfter: 0, extraSeconds: 0, reason: "current-not-scored" };
  const before = railExposureMeters(cur.diagnostics);
  const budget = maxExtraMinutes !== null ? maxExtraMinutes * 60
    : Math.max(SIL_RAIL_EXPERIMENT.defaultExtraSeconds, fastestSeconds * SIL_RAIL_EXPERIMENT.defaultExtraShare);
  let best: RailCandidate | null = null;
  let bestExposure = before;
  for (const c of candidates) {
    if (c.id === current) continue;
    if (c.paveMeters > cur.paveMeters || c.riskMeters > cur.riskMeters) continue;
    if (c.seconds - fastestSeconds > budget) continue;
    const e = railExposureMeters(c.diagnostics);
    if (before - e < SIL_RAIL_EXPERIMENT.minReductionMeters) continue;
    if (best === null || e < bestExposure || (e === bestExposure && c.seconds < best.seconds)) { best = c; bestExposure = e; }
  }
  if (!best) return { chosen: current, replaced: false, exposureBefore: before, exposureAfter: before, extraSeconds: 0, reason: "no-better-candidate" };
  return { chosen: best.id, replaced: true, exposureBefore: before, exposureAfter: bestExposure, extraSeconds: Math.round(best.seconds - cur.seconds), reason: "less-rail-exposure" };
}
