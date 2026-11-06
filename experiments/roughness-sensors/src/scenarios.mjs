/**
 * Catalogue of SYNTHETIC test trips. Each entry is a generator spec plus the behaviour the
 * analysis is expected to show. These are model scenarios, not recordings of real roads.
 */

/** Asphalt / sett alternation with enough asphalt for a trip baseline. */
export function mixedSections({ speedMs, pitchM = 0.15, settSpeedMs = speedMs, rough = "sett", scale = 1 }) {
  const asphalt = (lengthM) => ({ surface: "asphalt", lengthM: lengthM * scale, speedMs });
  const other = (lengthM) => ({ surface: rough, lengthM: lengthM * scale, speedMs: settSpeedMs, ...(rough === "sett" ? { pitchM } : {}) });
  return [asphalt(300), other(240), asphalt(240), other(240), asphalt(240), other(180), asphalt(180)];
}

function eventSections() {
  const fast = (lengthM, events = []) => ({ surface: "asphalt", lengthM, speedMs: 10, events });
  const slow = (lengthM, events = []) => ({ surface: "asphalt", lengthM, speedMs: 4, events });
  return [
    fast(260),
    fast(120, [{ atM: 60, kind: "pothole" }]),
    slow(50, [{ atM: 25, kind: "speed-bump" }]),
    fast(200, [{ atM: 100, kind: "kerb" }]),
    fast(150, [{ atM: 40, kind: "pothole", severity: 1.5 }]),
    slow(50, [{ atM: 25, kind: "speed-bump", lengthM: 3.5, heightM: 0.08 }]),
    fast(260, [{ atM: 130, kind: "pothole", severity: 0.8 }]),
    fast(200),
  ];
}

/**
 * expect:
 *  - "classify": segments are scored against truth (confusion matrix).
 *  - "abstain": most segments must be "uncertain" with one of `reasons`.
 *  - "no-smooth": the analysis must never call the (rough) road smooth.
 */
export function coreScenarios() {
  const list = [];
  for (const speedMs of [8, 12]) {
    list.push({ group: "smooth-asphalt", expect: "classify", spec: { id: `car-asphalt-${speedMs}`, mode: "car", seed: 100 + speedMs, sections: [{ surface: "asphalt", lengthM: 1200, speedMs }] } });
  }
  for (const pitchM of [0.1, 0.15, 0.2]) {
    for (const speedMs of [4, 8, 12]) {
      list.push({ group: "sett-car", expect: "classify", spec: { id: `car-mixed-p${pitchM}-v${speedMs}`, mode: "car", seed: Math.round(pitchM * 1000) + speedMs, sections: mixedSections({ speedMs, pitchM }) } });
    }
    for (const speedMs of [3, 5]) {
      list.push({ group: "sett-bicycle", expect: "classify", spec: { id: `bike-mixed-p${pitchM}-v${speedMs}`, mode: "bicycle", seed: 500 + Math.round(pitchM * 1000) + speedMs, sections: mixedSections({ speedMs, pitchM, scale: 0.6 }) } });
    }
  }
  list.push({ group: "sett-car", expect: "classify", spec: { id: "car-mixed-slower-on-sett", mode: "car", seed: 41, sections: mixedSections({ speedMs: 13, settSpeedMs: 7 }) } });
  list.push({ group: "events-on-asphalt", expect: "classify", spec: { id: "car-asphalt-events", mode: "car", seed: 51, sections: eventSections() } });
  list.push({ group: "phone-in-hand", expect: "classify", spec: { id: "car-hand-mixed", mode: "car", seed: 61, sections: mixedSections({ speedMs: 9 }), phone: { placement: "hand", tilt: { x: -50 }, burstEveryS: 25 } } });
  list.push({ group: "orientation-change", expect: "classify", spec: { id: "car-orientation-change", mode: "car", seed: 71, sections: mixedSections({ speedMs: 9 }), phone: { changes: [{ atS: 40, durationS: 1.5, tilt: { z: 90, x: -10 } }, { atS: 110, durationS: 2, tilt: { x: -80, y: 30 } }] } } });
  list.push({ group: "irregular-sampling", expect: "classify", spec: { id: "car-ios-like-jitter-drops", mode: "car", seed: 81, sections: mixedSections({ speedMs: 9 }), sampling: { hz: 60, timestampJitterMs: 3, dropProbability: 0.05, duplicateProbability: 0.03 } } });
  list.push({ group: "irregular-sampling", expect: "classify", spec: { id: "car-30hz", mode: "car", seed: 82, sections: mixedSections({ speedMs: 9 }), sampling: { hz: 30, timestampJitterMs: 2 } } });
  list.push({ group: "irregular-sampling", expect: "classify", spec: { id: "car-60hz-gaps", mode: "car", seed: 83, sections: mixedSections({ speedMs: 9 }), sampling: { hz: 60, gaps: [{ atS: 30, durationS: 4 }, { atS: 95, durationS: 10 }] } } });
  list.push({ group: "gps-dropout", expect: "classify", spec: { id: "car-gps-dropouts", mode: "car", seed: 91, sections: mixedSections({ speedMs: 9 }), gps: { dropouts: [{ atS: 40, durationS: 20 }, { atS: 120, durationS: 15 }], nullSpeedProbability: 0.1, positions: true } } });
  list.push({ group: "low-speed", expect: "abstain", reasons: ["too-slow"], spec: { id: "car-walking-pace", mode: "car", seed: 101, sections: mixedSections({ speedMs: 1.5, scale: 0.25 }) } });
  list.push({ group: "no-gps", expect: "abstain", reasons: ["gps-missing"], spec: { id: "car-gps-off", mode: "car", seed: 102, sections: mixedSections({ speedMs: 9, scale: 0.5 }), gps: { enabled: false } } });
  list.push({ group: "clipping", expect: "classify", spec: { id: "bike-sett-clipping", mode: "bicycle", seed: 111, sections: mixedSections({ speedMs: 6, scale: 0.6 }), phone: { clipMs2: 19.6 } } });
  list.push({ group: "clipping", expect: "classify", spec: { id: "car-potholes-clipping", mode: "car", seed: 112, sections: eventSections(), phone: { clipMs2: 13 } } });
  list.push({
    group: "sett-majority", expect: "classify",
    spec: { id: "car-sett-majority", mode: "car", seed: 122, sections: [
      { surface: "asphalt", lengthM: 150, speedMs: 9 }, { surface: "sett", lengthM: 400, speedMs: 9, pitchM: 0.15 },
      { surface: "asphalt", lengthM: 120, speedMs: 9 }, { surface: "sett", lengthM: 400, speedMs: 9, pitchM: 0.12 },
    ] },
  });
  list.push({ group: "all-sett", expect: "no-smooth", spec: { id: "car-all-sett", mode: "car", seed: 121, sections: [{ surface: "sett", lengthM: 900, speedMs: 8, pitchM: 0.15 }] } });
  list.push({ group: "confounder-rough-asphalt", expect: "classify", spec: { id: "car-rough-asphalt-confounder", mode: "car", seed: 131, sections: mixedSections({ speedMs: 9, rough: "rough-asphalt" }) } });
  list.push({ group: "confounder-rough-asphalt", expect: "classify", spec: { id: "bike-rough-asphalt-slow", mode: "bicycle", seed: 132, sections: mixedSections({ speedMs: 2.5, rough: "rough-asphalt", scale: 0.4 }) } });
  list.push({ group: "platform-variants", expect: "classify", spec: { id: "car-ios-sign-inverted", mode: "car", seed: 141, sections: mixedSections({ speedMs: 9 }), phone: { gravitySign: -1 } } });
  list.push({ group: "platform-variants", expect: "classify", spec: { id: "car-no-gyro-no-linear", mode: "car", seed: 142, sections: mixedSections({ speedMs: 9 }), phone: { gyro: false, linear: false } } });
  list.push({ group: "platform-variants", expect: "classify", spec: { id: "car-quantized-0.1", mode: "car", seed: 143, sections: mixedSections({ speedMs: 9 }), sampling: { quantizeMs2: 0.1 } } });
  list.push({ group: "platform-variants", expect: "classify", spec: { id: "moto-mixed-untuned", mode: "motorcycle", seed: 151, sections: mixedSections({ speedMs: 9 }) } });
  list.push({ group: "sett-bicycle", expect: "classify", spec: { id: "bike-mixed-slow-periodic", mode: "bicycle", seed: 161, sections: mixedSections({ speedMs: 2.2, scale: 0.4 }) } });
  return list;
}

/** Base trip for robustness sweeps; `override` patches the spec. */
export function sweepSpec({ id, seed, mode = "car", speedMs = 8, pitchM = 0.15, sampling = {}, phone = {}, roadScale = {} }) {
  return { id, mode, seed, sections: mixedSections({ speedMs, pitchM, scale: mode === "bicycle" ? 0.6 : 1 }), sampling, phone, roadScale };
}

export const SWEEPS = {
  /** Sett excitation relative to the default model: the key unknown of the whole approach. */
  settSeverity: [0.1, 0.2, 0.3, 0.5, 1].map((value) => ({ value, patch: { roadScale: { settKick: value } } })),
  sensorNoiseMs2: [0.02, 0.1, 0.4, 0.8, 1.6].map((value) => ({ value, patch: { phone: { noiseMs2: value } } })),
  speedMs: [2, 3, 5, 8, 11, 14, 17, 22].map((value) => ({ value, patch: { speedMs: value } })),
  pitchM: [0.08, 0.12, 0.16, 0.2, 0.24].map((value) => ({ value, patch: { pitchM: value } })),
  samplingHz: [20, 30, 50, 60, 100].map((value) => ({ value, patch: { sampling: { hz: value } } })),
  timestampJitterMs: [0, 2, 5, 10].map((value) => ({ value, patch: { sampling: { timestampJitterMs: value } } })),
  quantizeMs2: [0, 0.1, 0.3].map((value) => ({ value, patch: { sampling: { quantizeMs2: value } } })),
};
