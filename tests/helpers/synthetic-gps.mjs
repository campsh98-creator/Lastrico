/**
 * Phase 4.29 — reproducible synthetic GPS traces along a real route geometry.
 * Deterministic (seeded) noise, bias and delivery faults model what a phone reports in Milan:
 * a cold start in an urban canyon, a parallel-street bias, an outage, out-of-order and duplicate
 * samples, a stop at a traffic light, slow and fast update rates. These are SYNTHETIC traces,
 * never a substitute for a physical-device test.
 */

const EARTH = 6371000;
const rad = (x) => x * Math.PI / 180;
export function distance(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function offset([lon, lat], meters, degrees) {
  const d = meters / EARTH, b = rad(degrees), p = rad(lat);
  const q = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const l = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(q));
  return [l * 180 / Math.PI, q * 180 / Math.PI];
}
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(random) {
  const u = Math.max(1e-12, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Position and course on the route `metersAlong` from its start. */
export function pointAlong(coordinates, cumulative, metersAlong) {
  const total = cumulative[cumulative.length - 1];
  const m = Math.max(0, Math.min(total, metersAlong));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < m) i += 1;
  const a = coordinates[i - 1], b = coordinates[i];
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = (m - cumulative[i - 1]) / span;
  return { coordinate: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], course: bearing(a, b) };
}
export function cumulativeMeters(coordinates) {
  const out = [0];
  for (let i = 1; i < coordinates.length; i += 1) out.push(out[i - 1] + distance(coordinates[i - 1], coordinates[i]));
  return out;
}

/**
 * Builds a trace. `phases` describe consecutive intervals:
 *   { seconds, speed, interval = 1, accuracy, error, lateralBias = 0, gap = false }
 * `error` is the true 1-sigma error (it may exceed the reported `accuracy`, as in urban canyons);
 * `lateralBias` shifts every fix sideways by that many metres (a parallel street).
 */
export function buildTrace({ coordinates, startMeters = 0, startTime = 1_800_000_000_000, seed = 429, phases, faults = {} }) {
  const random = prng(seed);
  const cumulative = cumulativeMeters(coordinates);
  const samples = [];
  let t = 0, along = startMeters;
  for (const phase of phases) {
    const interval = phase.interval ?? 1;
    for (let elapsed = 0; elapsed < phase.seconds; elapsed += interval) {
      t += interval;
      along += phase.speed * interval;
      if (phase.gap) continue;
      const truth = pointAlong(coordinates, cumulative, along);
      const noisy = offset(offset(truth.coordinate, gaussian(random) * phase.error, 0), gaussian(random) * phase.error, 90);
      const coordinate = phase.lateralBias ? offset(noisy, phase.lateralBias, truth.course + 90) : noisy;
      const moving = phase.speed > 0.5;
      samples.push({
        fix: {
          coordinate,
          accuracy: phase.accuracy,
          timestamp: startTime + Math.round(t * 1000),
          heading: moving && phase.reportHeading !== false ? (truth.course + gaussian(random) * 6 + 360) % 360 : null,
          speed: phase.reportSpeed === false ? null : Math.max(0, phase.speed + gaussian(random) * 0.4),
        },
        receivedAt: startTime + Math.round(t * 1000) + 150,
        truth: truth.coordinate,
        truthMeters: Math.min(along, cumulative[cumulative.length - 1]),
        truthCourse: truth.course,
        moving,
      });
    }
  }
  // Delivery faults: a repeated sample, and a late sample arriving after a newer one.
  const delivered = [];
  samples.forEach((sample, index) => {
    delivered.push(sample);
    if (faults.duplicateEvery && index % faults.duplicateEvery === faults.duplicateEvery - 1) delivered.push({ ...sample, receivedAt: sample.receivedAt + 40 });
  });
  if (faults.lateEvery) {
    for (let index = faults.lateEvery; index < delivered.length - 1; index += faults.lateEvery) {
      [delivered[index], delivered[index + 1]] = [delivered[index + 1], delivered[index]];
      delivered[index].receivedAt = delivered[index + 1].receivedAt - 20;
    }
  }
  return { samples: delivered, cumulative, totalMeters: cumulative[cumulative.length - 1] };
}

/** The scenarios measured before and after Phase 4.29. Speeds in m/s; car ≈ 29 km/h. */
export function phase429Scenarios(mode = "car") {
  const v = mode === "bicycle" ? 4.5 : 8;
  return {
    "cold-start-urban-canyon": {
      phases: [
        { seconds: 2, speed: 0, accuracy: 165, error: 120 },
        { seconds: 2, speed: 0, accuracy: 96, error: 75, lateralBias: 45 },
        { seconds: 4, speed: 0, accuracy: 48, error: 45, lateralBias: 40 },
        { seconds: 12, speed: v, accuracy: 32, error: 35, lateralBias: 30 },
        { seconds: 40, speed: v, accuracy: 9, error: 5 },
      ],
    },
    // Tower reflections: fixes claim ±22 m but sit on a street 80 m away for the first seconds.
    "cold-start-reflected-street": {
      phases: [
        { seconds: 3, speed: 0, accuracy: 70, error: 50, lateralBias: 80 },
        { seconds: 9, speed: v, accuracy: 22, error: 8, lateralBias: 80 },
        { seconds: 40, speed: v, accuracy: 9, error: 5 },
      ],
    },
    "parallel-street-bias": {
      startMeters: 600,
      phases: [
        { seconds: 15, speed: v, accuracy: 8, error: 4 },
        { seconds: 14, speed: v, accuracy: 15, error: 8, lateralBias: 32 },
        { seconds: 20, speed: v, accuracy: 8, error: 4 },
      ],
    },
    "outage-and-recovery": {
      startMeters: 1200,
      phases: [
        { seconds: 15, speed: v, accuracy: 8, error: 4 },
        { seconds: 14, speed: v, gap: true },
        { seconds: 3, speed: v, accuracy: 40, error: 30 },
        { seconds: 20, speed: v, accuracy: 8, error: 4 },
      ],
    },
    "out-of-order-and-duplicates": {
      startMeters: 2000,
      faults: { duplicateEvery: 5, lateEvery: 7 },
      phases: [{ seconds: 45, speed: v, accuracy: 9, error: 5 }],
    },
    "traffic-light-stop": {
      startMeters: 2600,
      phases: [
        { seconds: 10, speed: v, accuracy: 8, error: 4 },
        { seconds: 30, speed: 0, accuracy: 12, error: 6 },
        { seconds: 15, speed: v, accuracy: 8, error: 4 },
      ],
    },
    "slow-updates-3s": {
      startMeters: 3200,
      phases: [{ seconds: 60, speed: v, interval: 3, accuracy: 10, error: 5 }],
    },
    "fast-updates-0.5s": {
      startMeters: 3800,
      phases: [{ seconds: 30, speed: v, interval: 0.5, accuracy: 8, error: 4 }],
    },
  };
}
