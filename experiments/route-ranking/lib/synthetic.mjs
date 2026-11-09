/**
 * SYNTHETIC candidate generators (seeded, deterministic). Used only by property tests and the
 * clearly labelled synthetic cross-check in benchmark.mjs; never mixed with genuine routes.
 */
/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
export function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROFILE_FOR_MODE = { car: "auto", motorcycle: "motorcycle", bicycle: "bicycle" };

export function candidate(id, fields = {}, mode = "car") {
  return {
    id,
    provider: "valhalla-fossgis",
    profile: PROFILE_FOR_MODE[mode],
    durationS: 600,
    distanceM: 3000,
    confirmedPaveM: 0,
    probablePaveM: 0,
    unknownM: 0,
    smoothM: 3000,
    unpavedWeightedM: 0,
    ...fields,
  };
}

/** Random but physically plausible pool: total length = pave + smooth + unknown. */
export function randomPool(random, mode = "car", size = 2 + Math.floor(random() * 6)) {
  const pool = [];
  const baseDuration = 300 + random() * 900;
  const baseDistance = baseDuration * (mode === "bicycle" ? 4.2 : 6.5);
  for (let i = 0; i < size; i += 1) {
    const stretch = i === 0 ? 1 : 1 + random() * 0.6;
    const distanceM = Math.round(baseDistance * stretch);
    const confirmedPaveM = Math.round(random() < 0.3 ? 0 : random() * distanceM * 0.35);
    const probablePaveM = Math.round(random() * (distanceM - confirmedPaveM) * 0.25);
    const unknownM = Math.round(random() * (distanceM - confirmedPaveM - probablePaveM) * 0.4);
    pool.push(candidate(`c${i + 1}`, {
      durationS: Math.round(baseDuration * stretch * (0.9 + random() * 0.2)),
      distanceM,
      confirmedPaveM,
      probablePaveM,
      unknownM,
      smoothM: distanceM - confirmedPaveM - probablePaveM - unknownM,
      unpavedWeightedM: random() < 0.1 ? Math.round(random() * 100) : 0,
    }, mode));
    const last = pool.at(-1);
    last.riskM = last.confirmedPaveM + 0.65 * last.probablePaveM + last.unpavedWeightedM;
    last.totalM = last.distanceM;
  }
  return pool;
}

