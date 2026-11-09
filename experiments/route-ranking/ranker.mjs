/**
 * Lastrico Phase 4.20 — experimental explainable multicriteria route ranker.
 *
 * Pure ES module, no production imports, no I/O. Input: normalised candidate metrics
 * (see `CANDIDATE_FIELDS`). Output: a deterministic ranking with a per-criterion
 * contribution breakdown and an Italian explanation.
 *
 * Pipeline
 *   1. Hard constraints: legality (same rule as lib/route-optimization.ts isLegalCandidate),
 *      reference = fastest legal route, corridor duplicates of the reference, user time
 *      budget (maxExtraMinutes), profile detour limit, evidence guard (an alternative must
 *      reduce *known* pavé by a minimum amount).
 *   2. Pareto filter over raw criteria (time, distance, confirmed pavé, probable pavé,
 *      unknown, weighted unpaved): a dominated candidate can never win.
 *   3. Additive cost in "metri-equivalenti di pavé confermato" (m-eq), relative to the
 *      reference. Every term is a named contribution; their sum *is* the cost.
 *
 * Unknown surface is never treated as smooth: it always carries a positive weight, and
 * unknown metres that replace avoided pavé without confirmed-smooth backing are surcharged
 * up to the confirmed-pavé weight ("sconosciuto non compensato").
 */

export const RANKER_VERSION = "0.1.0";
export const TRANSPORT_MODES = Object.freeze(["car", "motorcycle", "bicycle"]);
export const AVOIDANCE_LEVELS = Object.freeze(["balanced", "strong", "maximum"]);
export const MAX_EXTRA_MINUTES_LIMIT = 30; // mirrors lib/route-time-budget.ts

/**
 * Mode constants mirrored from MODE_POLICY in app/api/routes/route.ts (verified by
 * test/production-parity.test.mjs, which parses the production source).
 * paveMetersPerMinute = balancedPaveDivisor: in production "balanced", one extra minute is
 * worth that many metres of weighted pavé; "strong" divides by 10.
 */
export const MODE_SETTINGS = Object.freeze({
  car: Object.freeze({
    paveMetersPerMinute: 500,
    minKnownPaveReductionM: 20,
    detourLimits: Object.freeze({
      balanced: Object.freeze({ factor: 1.22, seconds: 180 }),
      strong: Object.freeze({ factor: 1.42, seconds: 420 }),
      maximum: Object.freeze({ factor: 1.7, seconds: 720 }),
    }),
  }),
  motorcycle: Object.freeze({
    paveMetersPerMinute: 330,
    minKnownPaveReductionM: 15,
    detourLimits: Object.freeze({
      balanced: Object.freeze({ factor: 1.28, seconds: 240 }),
      strong: Object.freeze({ factor: 1.55, seconds: 540 }),
      maximum: Object.freeze({ factor: 1.9, seconds: 900 }),
    }),
  }),
  bicycle: Object.freeze({
    paveMetersPerMinute: 260,
    minKnownPaveReductionM: 12,
    detourLimits: Object.freeze({
      balanced: Object.freeze({ factor: 1.3, seconds: 300 }),
      strong: Object.freeze({ factor: 1.6, seconds: 720 }),
      maximum: Object.freeze({ factor: 2.1, seconds: 1_200 }),
    }),
  }),
});

/** Criterion keys in the fixed summation order used for every cost. */
export const CRITERIA = Object.freeze([
  "confirmedPave", "probablePave", "unknown", "unbackedUnknown", "unpaved", "time", "distance", "switching",
]);

export const CRITERION_LABELS_IT = Object.freeze({
  confirmedPave: "pavé confermato",
  probablePave: "pavé probabile",
  unknown: "fondo sconosciuto",
  unbackedUnknown: "sconosciuto non compensato da asfalto confermato",
  unpaved: "sterrato (ponderato)",
  time: "tempo in più",
  distance: "distanza in più",
  switching: "soglia di cambio percorso",
});

/** Units of each weight (m-eq = metri-equivalenti di pavé confermato). */
export const WEIGHT_UNITS = Object.freeze({
  confirmedPave: "m-eq per m",
  probablePave: "m-eq per m",
  unknown: "m-eq per m",
  unbackedUnknown: "m-eq per m (supplemento)",
  unpaved: "m-eq per m ponderato",
  time: "m-eq per minuto",
  distance: "m-eq per km",
});

export const PROFILE_IDS = Object.freeze(["fastest", "balanced", "strong", "maximum"]);

const PROFILE_TEXT = Object.freeze({
  fastest: { label: "Più rapido", summary: "Sceglie sempre il percorso legale più veloce; il pavé non pesa." },
  balanced: { label: "Bilanciato", summary: "Accetta una deviazione solo se evita molto pavé per ogni minuto in più." },
  strong: { label: "Deciso", summary: "Un minuto in più vale un decimo rispetto al profilo Bilanciato." },
  maximum: { label: "Massimo", summary: "Il tempo pesa pochissimo entro il limite di deviazione; sconosciuto trattato con più prudenza." },
  custom: { label: "Personalizzato", summary: "Pesi impostati dall'utente." },
});

/**
 * Named profiles. Weights are in m-eq. Rationale (documented in README):
 * - confirmed = 1 (unit of account); probable = 0.65 (production roughness weight of
 *   paving_stones vs sett, scripts/osm/config.mjs).
 * - unknown = 0.35 (production discount for unknown metres backed by smooth gain) or 0.5 in
 *   "maximum"; unbackedUnknown = 1 - unknown, so unbacked unknown counts like confirmed pavé.
 * - time = mode paveMetersPerMinute (balanced), /10 (strong), /100 (maximum; production uses 0,
 *   a small positive value keeps time as a tie-breaker), 1 for fastest (pavé weights 0).
 * - distance = 10% of the per-minute time weight, per km: a secondary tie-breaker, NOT calibrated.
 * - switching = mode minimum pavé reduction: an alternative must beat the fastest by this margin.
 */
export function getProfile(id, mode) {
  assertMode(mode);
  const settings = MODE_SETTINGS[mode];
  const ppm = settings.paveMetersPerMinute;
  const base = (time, unknown, level) => ({
    id,
    label: PROFILE_TEXT[id].label,
    summary: PROFILE_TEXT[id].summary,
    mode,
    weights: {
      confirmedPave: 1,
      probablePave: 0.65,
      unknown,
      unbackedUnknown: round6(1 - unknown),
      unpaved: 1,
      time,
      distance: round6(time * 0.1),
    },
    switchingCostEq: settings.minKnownPaveReductionM,
    creditUnknownReduction: true,
    detourLimit: { ...settings.detourLimits[level] },
    detourLevel: level,
    minKnownPaveReductionM: settings.minKnownPaveReductionM,
  });
  switch (id) {
    case "fastest":
      return {
        id, label: PROFILE_TEXT.fastest.label, summary: PROFILE_TEXT.fastest.summary, mode,
        weights: { confirmedPave: 0, probablePave: 0, unknown: 0, unbackedUnknown: 0, unpaved: 0, time: 1, distance: 0 },
        switchingCostEq: settings.minKnownPaveReductionM,
        creditUnknownReduction: true,
        detourLimit: { ...settings.detourLimits.balanced },
        detourLevel: "balanced",
        minKnownPaveReductionM: settings.minKnownPaveReductionM,
      };
    case "balanced": return base(ppm, 0.35, "balanced");
    case "strong": return base(round6(ppm / 10), 0.35, "strong");
    case "maximum": return base(round6(ppm / 100), 0.5, "maximum");
    default: throw new RangeError(`Profilo sconosciuto: ${String(id)}`);
  }
}

/**
 * Configurable profile. `base` supplies defaults; `weights` overrides individual weights
 * (scaled values are validated by validateProfile). `detourLevel` picks a production detour
 * limit, or `detourLimit` sets an explicit {factor, seconds}.
 */
export function makeCustomProfile(mode, {
  base = "strong", weights = {}, detourLevel, detourLimit, switchingCostEq, minKnownPaveReductionM, label, creditUnknownReduction,
} = {}) {
  const start = getProfile(base, mode);
  const level = detourLevel ?? start.detourLevel;
  if (detourLevel !== undefined && !AVOIDANCE_LEVELS.includes(detourLevel)) {
    throw new RangeError(`Livello di deviazione non valido: ${String(detourLevel)}`);
  }
  const profile = {
    ...start,
    id: "custom",
    label: label ?? PROFILE_TEXT.custom.label,
    summary: PROFILE_TEXT.custom.summary,
    weights: { ...start.weights, ...weights },
    detourLevel: detourLimit ? "custom" : level,
    detourLimit: detourLimit ? { ...detourLimit } : { ...MODE_SETTINGS[mode].detourLimits[level] },
    switchingCostEq: switchingCostEq ?? start.switchingCostEq,
    creditUnknownReduction: creditUnknownReduction ?? start.creditUnknownReduction,
    minKnownPaveReductionM: minKnownPaveReductionM ?? start.minKnownPaveReductionM,
  };
  validateProfile(profile);
  return profile;
}

function isNonNegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== "object") throw new TypeError("Profilo mancante");
  assertMode(profile.mode);
  const w = profile.weights;
  if (!w || typeof w !== "object") throw new TypeError("Pesi del profilo mancanti");
  for (const key of Object.keys(WEIGHT_UNITS)) {
    if (!isNonNegativeFinite(w[key])) throw new RangeError(`Peso non valido per ${key}: deve essere un numero finito >= 0`);
  }
  for (const key of Object.keys(w)) {
    if (!Object.hasOwn(WEIGHT_UNITS, key)) throw new RangeError(`Peso sconosciuto: ${key}`);
  }
  if (w.probablePave > w.confirmedPave) {
    throw new RangeError("Il pavé probabile non può pesare più del pavé confermato");
  }
  const surfaceAware = w.confirmedPave > 0 || w.probablePave > 0 || w.unpaved > 0;
  if (surfaceAware && !(w.unknown > 0)) {
    throw new RangeError("Il fondo sconosciuto deve avere un peso positivo: non può essere trattato come asfalto");
  }
  if (!(w.time > 0) && !surfaceAware) throw new RangeError("Almeno un criterio deve avere peso positivo");
  const limit = profile.detourLimit;
  if (!limit || !isNonNegativeFinite(limit.factor) || limit.factor < 1 || !isNonNegativeFinite(limit.seconds)) {
    throw new RangeError("Limite di deviazione non valido (factor >= 1, seconds >= 0)");
  }
  if (!isNonNegativeFinite(profile.switchingCostEq)) throw new RangeError("Soglia di cambio percorso non valida");
  if (typeof profile.creditUnknownReduction !== "boolean") throw new TypeError("creditUnknownReduction deve essere booleano");
  if (!isNonNegativeFinite(profile.minKnownPaveReductionM)) throw new RangeError("Riduzione minima di pavé non valida");
  return true;
}

function assertMode(mode) {
  if (!TRANSPORT_MODES.includes(mode)) throw new RangeError(`Modalità di trasporto non valida: ${String(mode)}`);
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/** Fields read from each candidate. Numbers are metres or seconds. */
export const CANDIDATE_FIELDS = Object.freeze({
  required: ["id", "provider", "profile", "durationS", "distanceM", "confirmedPaveM", "probablePaveM", "unknownM"],
  optional: ["smoothM", "unpavedWeightedM", "blockingRestrictionM", "confirmedRestrictionM", "corridorId", "source"],
});

function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates deve essere un array");
  const ids = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") throw new TypeError("Ogni candidato deve essere un oggetto");
    if (typeof candidate.id !== "string" || candidate.id === "") throw new TypeError("Ogni candidato richiede un id stringa");
    if (ids.has(candidate.id)) throw new RangeError(`id duplicato: ${candidate.id}`);
    ids.add(candidate.id);
    for (const field of CANDIDATE_FIELDS.required.slice(1)) {
      if (!(field in candidate)) throw new TypeError(`Campo mancante ${field} nel candidato ${candidate.id}`);
    }
    for (const field of ["durationS", "distanceM", "confirmedPaveM", "probablePaveM", "unknownM"]) {
      if (typeof candidate[field] !== "number") throw new TypeError(`${field} deve essere numerico (${candidate.id})`);
    }
  }
}

/**
 * Same rule as isLegalCandidate (lib/route-optimization.ts): correct provider profile for the
 * mode, no blocking/confirmed restriction metres, finite non-negative metrics. Returns null when
 * legal, otherwise an Italian reason.
 */
export function legalityIssue(candidate, mode) {
  const correctProfile = mode === "car"
    ? (candidate.provider === "valhalla-fossgis" && candidate.profile === "auto")
      || (candidate.provider === "osrm-public-fallback" && candidate.profile === "driving")
    : candidate.provider === "valhalla-fossgis" && candidate.profile === mode;
  if (!correctProfile) return `profilo ${candidate.provider}/${candidate.profile} non valido per ${mode}`;
  const restricted = candidate.blockingRestrictionM ?? candidate.confirmedRestrictionM ?? 0;
  if (restricted !== 0) return `attraversa ${restricted} m vietati secondo OpenStreetMap`;
  for (const field of ["durationS", "distanceM", "confirmedPaveM", "probablePaveM", "unknownM"]) {
    if (!isNonNegativeFinite(candidate[field])) return `metrica ${field} non valida`;
  }
  for (const field of ["smoothM", "unpavedWeightedM"]) {
    if (candidate[field] !== undefined && !isNonNegativeFinite(candidate[field])) return `metrica ${field} non valida`;
  }
  return null;
}

const knownPave = (c) => c.confirmedPaveM + c.probablePaveM;

function referenceOrder(a, b) {
  return a.durationS - b.durationS || knownPave(a) - knownPave(b) || a.unknownM - b.unknownM
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const PARETO_OBJECTIVES = (c) => [c.durationS, c.distanceM, c.confirmedPaveM, c.probablePaveM, c.unknownM, c.unpavedWeightedM ?? 0];

/** True when `a` Pareto-dominates `b` over the ranker's raw criteria. */
export function dominates(a, b) {
  const va = PARETO_OBJECTIVES(a);
  const vb = PARETO_OBJECTIVES(b);
  return va.every((value, i) => value <= vb[i]) && va.some((value, i) => value < vb[i]);
}

function defaultEquivalent(a, b) {
  return a.corridorId !== undefined && a.corridorId !== null && a.corridorId === b.corridorId;
}

/**
 * Per-criterion contributions of `candidate` relative to `reference` (m-eq). Their sum is the
 * cost. The reference itself scores exactly 0 on every criterion.
 */
export function contributions(candidate, reference, profile) {
  const w = profile.weights;
  const isReference = candidate === reference;
  const deltaUnknown = candidate.unknownM - reference.unknownM;
  const knownSaved = Math.max(0, knownPave(reference) - knownPave(candidate));
  const smoothGain = Math.max(0, (candidate.smoothM ?? 0) - (reference.smoothM ?? 0));
  const unbacked = Math.min(Math.max(0, deltaUnknown), Math.max(0, knownSaved - smoothGain));
  const deltas = {
    confirmedPave: candidate.confirmedPaveM - reference.confirmedPaveM,
    probablePave: candidate.probablePaveM - reference.probablePaveM,
    // With creditUnknownReduction=false fewer unknown metres earn no credit (production-like
    // asymmetry); more unknown metres are always charged.
    unknown: profile.creditUnknownReduction ? deltaUnknown : Math.max(0, deltaUnknown),
    unbackedUnknown: unbacked,
    unpaved: (candidate.unpavedWeightedM ?? 0) - (reference.unpavedWeightedM ?? 0),
    time: (candidate.durationS - reference.durationS) / 60,
    distance: (candidate.distanceM - reference.distanceM) / 1000,
    switching: isReference ? 0 : 1,
  };
  const parts = {
    confirmedPave: w.confirmedPave * deltas.confirmedPave,
    probablePave: w.probablePave * deltas.probablePave,
    unknown: w.unknown * deltas.unknown,
    unbackedUnknown: w.unbackedUnknown * deltas.unbackedUnknown,
    unpaved: w.unpaved * deltas.unpaved,
    time: w.time * deltas.time,
    distance: w.distance * deltas.distance,
    switching: profile.switchingCostEq * deltas.switching,
  };
  let cost = 0;
  for (const key of CRITERIA) cost += parts[key];
  return { deltas, parts, cost };
}

function rankingOrder(a, b) {
  return a.cost - b.cost || a.candidate.durationS - b.candidate.durationS
    || knownPave(a.candidate) - knownPave(b.candidate) || a.candidate.unknownM - b.candidate.unknownM
    || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0);
}

function resolveProfile(profile, mode) {
  if (typeof profile === "string") return getProfile(profile, mode);
  validateProfile(profile);
  if (profile.mode !== mode) throw new RangeError("Il profilo appartiene a un'altra modalità di trasporto");
  return profile;
}

function validateBudget(maxExtraMinutes) {
  if (maxExtraMinutes === null || maxExtraMinutes === undefined) return null;
  if (typeof maxExtraMinutes !== "number" || !Number.isFinite(maxExtraMinutes)
    || maxExtraMinutes < 0 || maxExtraMinutes > MAX_EXTRA_MINUTES_LIMIT) {
    throw new RangeError(`maxExtraMinutes deve essere null o un numero tra 0 e ${MAX_EXTRA_MINUTES_LIMIT}`);
  }
  return maxExtraMinutes;
}

/**
 * Rank candidate routes.
 * @param {object[]} candidates normalised candidates (CANDIDATE_FIELDS)
 * @param {{mode: string, profile: string|object, maxExtraMinutes?: number|null,
 *          equivalent?: (a: object, b: object) => boolean}} options
 */
export function rankRoutes(candidates, options) {
  if (!options || typeof options !== "object") throw new TypeError("options mancanti");
  const { mode } = options;
  assertMode(mode);
  const profile = resolveProfile(options.profile, mode);
  const maxExtraMinutes = validateBudget(options.maxExtraMinutes);
  const equivalent = options.equivalent ?? defaultEquivalent;
  if (typeof equivalent !== "function") throw new TypeError("equivalent deve essere una funzione");
  validateCandidates(candidates);

  const excluded = [];
  const legal = [];
  for (const candidate of candidates) {
    const issue = legalityIssue(candidate, mode);
    if (issue) excluded.push({ id: candidate.id, stage: "legality", reason: issue });
    else legal.push(candidate);
  }
  const sortedLegal = [...legal].sort(referenceOrder);
  const reference = sortedLegal[0];
  const base = {
    version: RANKER_VERSION,
    mode,
    profile: { id: profile.id, label: profile.label, weights: { ...profile.weights }, detourLimit: { ...profile.detourLimit },
      switchingCostEq: profile.switchingCostEq, minKnownPaveReductionM: profile.minKnownPaveReductionM,
      creditUnknownReduction: profile.creditUnknownReduction },
    maxExtraMinutes,
  };
  if (!reference) {
    return { ...base, referenceId: null, winnerId: null, winnerIsReference: false, ranking: [],
      excluded: sortExcluded(excluded), explanation: "Nessun percorso legale disponibile per questa modalità." };
  }

  const admissible = [reference];
  for (const candidate of sortedLegal.slice(1)) {
    let stage = null;
    let reason = null;
    const extraS = candidate.durationS - reference.durationS;
    const saved = knownPave(reference) - knownPave(candidate);
    if (equivalent(candidate, reference) || equivalent(reference, candidate)) {
      stage = "duplicate"; reason = "stesso corridoio del percorso più rapido";
    } else if (maxExtraMinutes !== null && candidate.durationS > reference.durationS + maxExtraMinutes * 60) {
      stage = "budget"; reason = `+${fmtMin(extraS)} min oltre il limite di +${fmtNum(maxExtraMinutes)} min`;
    } else if (candidate.durationS > reference.durationS * profile.detourLimit.factor + profile.detourLimit.seconds) {
      stage = "detour_limit"; reason = `+${fmtMin(extraS)} min oltre il limite di deviazione del profilo`;
    } else if (saved < profile.minKnownPaveReductionM) {
      stage = "evidence_guard";
      reason = saved > 0
        ? `riduce il pavé noto di soli ${fmtM(saved)} m (minimo ${fmtM(profile.minKnownPaveReductionM)} m)`
        : "non riduce il pavé noto";
    }
    if (stage) excluded.push({ id: candidate.id, stage, reason });
    else admissible.push(candidate);
  }

  const frontier = [];
  for (const candidate of admissible) {
    const dominator = admissible
      .filter((other) => other !== candidate && dominates(other, candidate))
      .sort(referenceOrder)[0];
    if (dominator) excluded.push({ id: candidate.id, stage: "dominated", reason: `dominato da ${dominator.id}` });
    else frontier.push(candidate);
  }

  const ranking = frontier
    .map((candidate) => ({ candidate, ...contributions(candidate, reference, profile) }))
    .sort(rankingOrder)
    .map((entry, index) => ({
      rank: index + 1,
      id: entry.candidate.id,
      isReference: entry.candidate === reference,
      cost: entry.cost,
      contributions: entry.parts,
      deltas: entry.deltas,
      metrics: pickMetrics(entry.candidate),
    }));
  const winner = ranking[0];
  const explanation = explain({ ranking, winner, reference, profile, excluded,
    alternativesCount: sortedLegal.length - 1 });
  return {
    ...base,
    referenceId: reference.id,
    winnerId: winner.id,
    winnerIsReference: winner.isReference,
    ranking,
    excluded: sortExcluded(excluded),
    explanation,
  };
}

function sortExcluded(list) {
  const order = ["legality", "duplicate", "budget", "detour_limit", "evidence_guard", "dominated"];
  return [...list].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function pickMetrics(c) {
  return {
    durationS: c.durationS, distanceM: c.distanceM, confirmedPaveM: c.confirmedPaveM, probablePaveM: c.probablePaveM,
    unknownM: c.unknownM, smoothM: c.smoothM ?? null, unpavedWeightedM: c.unpavedWeightedM ?? 0,
  };
}

const nf0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtM(value) { return nf0.format(Math.round(value)); }
function fmtMin(seconds) { return nf1.format(seconds / 60); }
function fmtNum(value) { return nf1.format(value); }
function fmtKm(metres) { return nf1.format(metres / 1000); }
function signed(value, formatter) { return `${value >= 0 ? "+" : "−"}${formatter(Math.abs(value))}`; }

function tradeLine(entry, reference) {
  const m = entry.metrics;
  const confirmedSaved = reference.confirmedPaveM - m.confirmedPaveM;
  const probableSaved = reference.probablePaveM - m.probablePaveM;
  const pieces = [];
  if (confirmedSaved > 0) pieces.push(`evita ${fmtM(confirmedSaved)} m di pavé confermato`);
  else if (confirmedSaved < 0) pieces.push(`aggiunge ${fmtM(-confirmedSaved)} m di pavé confermato`);
  if (probableSaved > 0) pieces.push(`${fmtM(probableSaved)} m di pavé probabile`);
  else if (probableSaved < 0) pieces.push(`aggiunge ${fmtM(-probableSaved)} m di pavé probabile`);
  const surface = pieces.length ? pieces.join(" e ") : "non cambia il pavé noto";
  const extra = `${signed(m.durationS - reference.durationS, fmtMin)} min e ${signed(m.distanceM - reference.distanceM, fmtKm)} km`;
  const unknownDelta = m.unknownM - reference.unknownM;
  const unknownText = unknownDelta === 0 ? "i tratti senza dati restano invariati"
    : unknownDelta > 0 ? `i tratti senza dati aumentano di ${fmtM(unknownDelta)} m (contati come rischio, mai come asfalto)`
      : `i tratti senza dati calano di ${fmtM(-unknownDelta)} m`;
  return { surface, extra, unknownText };
}

function profileRate(profile) {
  if (profile.weights.confirmedPave === 0) return "il pavé non pesa";
  return `1 minuto vale ${fmtM(profile.weights.time / profile.weights.confirmedPave)} m di pavé confermato`;
}

function explain({ ranking, winner, reference, profile, excluded, alternativesCount }) {
  const label = `«${profile.label}»`;
  if (!winner.isReference) {
    const t = tradeLine(winner, reference);
    const unbacked = winner.contributions.unbackedUnknown > 0
      ? ` Supplemento prudenziale: ${fmtM(winner.deltas.unbackedUnknown)} m sconosciuti sostituiscono pavé senza asfalto confermato.`
      : "";
    return `Scelgo ${winner.id} invece del più rapido (${reference.id}): ${t.surface}, con ${t.extra}; ${t.unknownText}.`
      + ` Saldo ${signed(winner.cost, fmtM)} m-eq di pavé con il profilo ${label} (${profileRate(profile)}).${unbacked}`;
  }
  if (alternativesCount === 0) {
    return "Un solo percorso legale disponibile: nessun confronto possibile, resta il più rapido.";
  }
  if (ranking.length === 1) {
    const counts = {};
    for (const item of excluded) if (item.stage !== "legality") counts[item.stage] = (counts[item.stage] ?? 0) + 1;
    const names = { duplicate: "nello stesso corridoio", budget: "oltre il limite di tempo", detour_limit: "oltre il limite di deviazione",
      evidence_guard: "senza riduzione sufficiente del pavé noto", dominated: "peggiori su ogni criterio" };
    const detail = Object.entries(counts).map(([stage, n]) => `${n} ${names[stage]}`).join(", ");
    return `Mantengo il percorso più rapido (${reference.id}): nessuna alternativa supera i vincoli (${detail || "nessuna"}).`;
  }
  const best = ranking[1];
  const t = tradeLine(best, reference);
  return `Mantengo il percorso più rapido (${reference.id}): la migliore alternativa (${best.id}) ${t.surface}, con ${t.extra};`
    + ` ${t.unknownText}. Con il profilo ${label} (${profileRate(profile)}) il saldo è ${signed(best.cost, fmtM)} m-eq, quindi non conviene.`;
}

/** Recompute a cost from a breakdown — used by tests and the benchmark audit. */
export function sumContributions(parts) {
  let total = 0;
  for (const key of CRITERIA) total += parts[key];
  return total;
}
