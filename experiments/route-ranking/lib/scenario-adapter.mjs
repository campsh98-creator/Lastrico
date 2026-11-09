/**
 * Shared glue between corpus scenarios, the experimental ranker and the production baseline.
 * Both selectors receive exactly the same candidate metrics and the same corridor-equivalence
 * answers, so any divergence comes from the selection logic alone.
 */

/** Corridor equivalence for a scenario, keyed by candidate id. */
export function equivalenceById(scenario) {
  if (scenario.set === "G") {
    const pairs = new Set(scenario.equivalence.pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    return (a, b) => a === b || pairs.has(`${a}|${b}`);
  }
  // Set R: only "distinct from the recorded fast route" was recorded. Production queries
  // equivalence exclusively against the fast route, so this is sufficient when the current
  // fastest legal candidate is the recorded fast one (checked in the benchmark).
  const fastId = scenario.recorded.fastId;
  const byId = new Map(scenario.candidates.map((c) => [c.id, c]));
  return (a, b) => {
    if (a === b) return true;
    if (a === fastId) return byId.get(b)?.distinctFromRecordedFast === false;
    if (b === fastId) return byId.get(a)?.distinctFromRecordedFast === false;
    return false;
  };
}

export function rankerEquivalent(scenario) {
  const eq = equivalenceById(scenario);
  return (a, b) => eq(a.id, b.id);
}

/** Budget used for a scenario's "as requested" comparison. */
export function requestedBudget(scenario) {
  if (scenario.set === "R") return scenario.requested.maxExtraMinutes ?? null;
  return 5; // Phase 3.2 and 4.2 captures were requested with maxExtraMinutes=5
}

export const knownPave = (c) => c.confirmedPaveM + c.probablePaveM;
