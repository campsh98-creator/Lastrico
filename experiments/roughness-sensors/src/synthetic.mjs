/**
 * Deterministic SYNTHETIC trip generator. Everything produced here is invented data and is
 * labelled dataKind "synthetic"; it validates code behaviour under this model's assumptions,
 * never real-world road truth.
 *
 * Model (all parameters are illustrative placeholders, not measurements):
 *  - The vehicle moves along a straight line through sections (asphalt, sett, rough-asphalt),
 *    simulated at 1 kHz with speed ramps.
 *  - Road input: white "acceleration" noise scaled by sqrt(v) (random road), plus for setts one
 *    velocity kick per stone joint (pitch with 8% jitter, random height), plus isolated events
 *    (pothole = drop + hit, kerb/joint = single hit, speed bump = smooth heave v^2 h''(x)).
 *  - Vehicle/phone transfer: body resonance + wheel-hop resonance + direct low-pass path.
 *  - The phone frame is rotated arbitrarily (mount, hand with handling bursts, orientation
 *    changes); readings are point-sampled at jittered timestamps WITHOUT anti-alias filtering
 *    (worst case: WebKit on iOS polls the latest Core Motion sample with a 60 Hz timer).
 */
import { createBiquadState, designBiquad } from "./dsp.mjs";
import { createRng } from "./prng.mjs";
import { emptyTrace } from "./schema.mjs";

const SIM_HZ = 1000;
const G = 9.80665;
const V0 = 10;

/** Illustrative vehicle transfer parameters; gains calibrated so band RMS hits rough targets. */
export const VEHICLES = {
  car: {
    body: [1.3, 1.2, 1.0], wheel: [12, 2, 1.0], direct: [30, 0.7, 0.35], handLowpassHz: 15,
    roadNoise: 0.95, settKick: 0.034, bumpLowpassHz: 2.5, engine: true, maxAccel: 1.5, yawSd: 2,
  },
  motorcycle: {
    body: [1.8, 1.2, 1.0], wheel: [14, 2, 1.0], direct: [40, 0.7, 0.45], handLowpassHz: 15,
    roadNoise: 1.4, settKick: 0.05, bumpLowpassHz: 4, engine: true, maxAccel: 2.5, yawSd: 4,
  },
  bicycle: {
    body: [4, 1, 1.0], wheel: [30, 2.5, 1.0], direct: [80, 0.7, 0.5], handLowpassHz: 20,
    roadNoise: 2.6, settKick: 0.07, bumpLowpassHz: 12, engine: false, maxAccel: 0.8, yawSd: 5,
  },
};

export const SURFACES = {
  asphalt: { noise: 1.0, sett: false },
  "rough-asphalt": { noise: 4.0, sett: false },
  sett: { noise: 1.5, sett: true },
};

// ---------- small 3x3 rotation helpers (phone frame -> vehicle frame) ----------
const matMul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const transpose = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
const apply = (m, v) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

export function axisAngleMatrix(axis, angle) {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const [x, y, z] = axis.map((value) => value / length);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** Rotation vector (axis * angle, radians) of a rotation matrix. */
export function rotationVector(m) {
  const cos = Math.min(1, Math.max(-1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2));
  const angle = Math.acos(cos);
  const skew = [m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1]];
  if (angle < 1e-9) return skew.map((value) => value / 2);
  const factor = angle / (2 * Math.sin(angle));
  return skew.map((value) => value * factor);
}

/** Portrait, screen facing the driver, upright: phone x -> vehicle right, y -> up, z -> backward. */
const PORTRAIT_UPRIGHT = [
  [0, 0, -1],
  [-1, 0, 0],
  [0, 1, 0],
];

function orientationMatrix(tilt = {}) {
  const deg = Math.PI / 180;
  let m = PORTRAIT_UPRIGHT;
  m = matMul(m, axisAngleMatrix([0, 0, 1], (tilt.z ?? 0) * deg));
  m = matMul(m, axisAngleMatrix([1, 0, 0], (tilt.x ?? 0) * deg));
  m = matMul(m, axisAngleMatrix([0, 1, 0], (tilt.y ?? 0) * deg));
  return m;
}

const smoothstep = (value) => {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
};

function normaliseSpec(spec) {
  return {
    id: spec.id ?? "synthetic-trip",
    mode: spec.mode ?? "car",
    seed: spec.seed ?? 1,
    sections: spec.sections,
    /** Multipliers on the vehicle's road-input constants (severity sweeps). */
    roadScale: { settKick: 1, roadNoise: 1, ...(spec.roadScale ?? {}) },
    sampling: { hz: 60, sampleJitterMs: 0.4, timestampJitterMs: 1.5, dropProbability: 0, duplicateProbability: 0, gaps: [], quantizeMs2: 0, ...(spec.sampling ?? {}) },
    gps: { enabled: true, intervalMs: 1000, speedNoiseMs: 0.25, nullSpeedProbability: 0, dropouts: [], positions: false, ...(spec.gps ?? {}) },
    phone: {
      placement: "mount", tilt: { x: -15 }, changes: [], bursts: [], burstEveryS: null, gravitySign: 1, linear: true, gyro: true,
      clipMs2: null, noiseMs2: 0.02, gyroNoiseDegS: 0.3, ...(spec.phone ?? {}),
    },
  };
}

/**
 * @returns {{ trace: object, truth: { spans: object[], events: object[], durationMs: number } }}
 */
export function generateTrip(inputSpec) {
  const spec = normaliseSpec(inputSpec);
  if (!VEHICLES[spec.mode]) throw new TypeError(`Unknown mode ${spec.mode}`);
  const vehicle = {
    ...VEHICLES[spec.mode],
    settKick: VEHICLES[spec.mode].settKick * spec.roadScale.settKick,
    roadNoise: VEHICLES[spec.mode].roadNoise * spec.roadScale.roadNoise,
  };
  const rng = createRng(spec.seed);
  const roadRng = rng.fork("road");
  const sensorRng = rng.fork("sensor");
  const handRng = rng.fork("hand");
  const gpsRng = rng.fork("gps");
  const timingRng = rng.fork("timing");

  // Section geometry.
  const sections = [];
  let cursor = 0;
  for (const section of spec.sections) {
    sections.push({ ...section, startM: cursor, endM: cursor + section.lengthM });
    cursor += section.lengthM;
  }
  const totalM = cursor;
  const pendingEvents = [];
  for (const section of sections) {
    for (const event of section.events ?? []) pendingEvents.push({ ...event, xM: section.startM + event.atM });
  }
  pendingEvents.sort((a, b) => a.xM - b.xM);

  // ---------- 1 kHz vehicle simulation ----------
  const dt = 1 / SIM_HZ;
  const bodyFilter = createBiquadState(designBiquad("bandpass", vehicle.body[0], SIM_HZ, vehicle.body[1]));
  const wheelFilter = createBiquadState(designBiquad("bandpass", vehicle.wheel[0], SIM_HZ, vehicle.wheel[1]));
  const directFilter = createBiquadState(designBiquad("lowpass", vehicle.direct[0], SIM_HZ, vehicle.direct[1]));
  // A vehicle cannot sustain a vertical acceleration: remove the input's mean on the direct path.
  const directHighpass = createBiquadState(designBiquad("highpass", 1, SIM_HZ, 0.7));
  const heaveFilter = createBiquadState(designBiquad("lowpass", vehicle.bumpLowpassHz, SIM_HZ, 0.7));
  const longFilter = createBiquadState(designBiquad("lowpass", 2, SIM_HZ, 0.7));
  const handFilter = spec.phone.placement === "hand" ? createBiquadState(designBiquad("lowpass", vehicle.handLowpassHz, SIM_HZ, 0.7)) : null;

  const vertical = [];
  const longitudinal = [];
  const lateral = [];
  const yawRate = [];
  const speeds = [];
  const spans = [];
  const truthEvents = [];
  const kickQueue = new Float64Array(64);
  let queueHead = 0;
  let x = 0;
  let v = spec.sections[0].speedMs;
  let previousV = v;
  let sectionIndex = 0;
  let nextJoint = null;
  let yaw = 0;
  let eventCursor = 0;
  let heaveBump = null;
  let step = 0;
  const maxSteps = SIM_HZ * 60 * 60;

  const addKick = (deltaV, widthSamples) => {
    const width = Math.max(1, Math.min(32, widthSamples));
    const scale = (deltaV * Math.PI) / (2 * width * dt);
    for (let k = 0; k < width; k += 1) {
      kickQueue[(queueHead + k) % kickQueue.length] += scale * Math.sin((Math.PI * (k + 0.5)) / width);
    }
  };

  while (x < totalM && step < maxSteps) {
    while (sectionIndex < sections.length - 1 && x >= sections[sectionIndex].endM) sectionIndex += 1;
    const section = sections[sectionIndex];
    const surface = SURFACES[section.surface];
    if (!surface) throw new TypeError(`Unknown surface ${section.surface}`);
    const tMs = step;
    if (!spans.length || spans[spans.length - 1].sectionIndex !== sectionIndex) {
      if (spans.length) spans[spans.length - 1].endMs = tMs;
      spans.push({ sectionIndex, surface: section.surface, pitchM: section.pitchM ?? null, startMs: tMs, endMs: null, speedMs: section.speedMs });
    }

    // Speed ramp towards the section target.
    const target = section.speedMs;
    const maxDelta = vehicle.maxAccel * dt;
    v += Math.max(-maxDelta, Math.min(maxDelta, target - v));
    v = Math.max(0, v);

    // Road input.
    let input = surface.noise * vehicle.roadNoise * Math.sqrt(Math.max(v, 0.05) / V0) * roadRng.normal();
    if (surface.sett) {
      const pitch = section.pitchM ?? 0.15;
      if (nextJoint === null || nextJoint < section.startM) nextJoint = Math.max(x, section.startM) + pitch * roadRng.next();
      while (nextJoint <= x && nextJoint < section.endM) {
        const amplitude = vehicle.settKick * (Math.max(v, 0.05) / V0) ** 0.6 * Math.max(0.2, 1 + 0.35 * roadRng.normal());
        addKick(amplitude, Math.round((0.02 / Math.max(v, 0.3)) * SIM_HZ));
        nextJoint += pitch * (1 + 0.08 * roadRng.normal());
      }
    } else {
      nextJoint = null;
    }
    while (eventCursor < pendingEvents.length && pendingEvents[eventCursor].xM <= x) {
      const event = pendingEvents[eventCursor];
      if (!event.silent) truthEvents.push({ kind: event.kind, tMs, xM: event.xM, speedMs: v });
      const scale = (Math.max(v, 0.5) / V0) ** 0.6;
      if (event.kind === "pothole") {
        addKick(-0.35 * scale * (event.severity ?? 1), 6);
        pendingEvents.splice(eventCursor + 1, 0, { kind: "pothole-hit", xM: event.xM + 0.4, severity: event.severity ?? 1, silent: true });
      } else if (event.kind === "pothole-hit") {
        addKick(0.5 * scale * (event.severity ?? 1), 4);
      } else if (event.kind === "kerb") {
        addKick(0.45 * scale * (event.severity ?? 1), 4);
      } else if (event.kind === "speed-bump") {
        heaveBump = { startM: event.xM, lengthM: event.lengthM ?? 2.5, heightM: event.heightM ?? 0.07 };
      }
      eventCursor += 1;
    }
    input += kickQueue[queueHead];
    kickQueue[queueHead] = 0;
    queueHead = (queueHead + 1) % kickQueue.length;

    let heave = 0;
    if (heaveBump) {
      const s = (x - heaveBump.startM) / heaveBump.lengthM;
      if (s >= 0 && s <= 1) {
        // h(x) = H sin^2(pi s)  =>  d2h/dt2 = v^2 * H * 2 pi^2 / L^2 * cos(2 pi s)
        heave = v * v * heaveBump.heightM * ((2 * Math.PI * Math.PI) / (heaveBump.lengthM ** 2)) * Math.cos(2 * Math.PI * s);
      } else if (s > 1) {
        heaveBump = null;
      }
    }
    let aVert = vehicle.body[2] * bodyFilter(input) + vehicle.wheel[2] * wheelFilter(input)
      + vehicle.direct[2] * directFilter(directHighpass(input)) + 0.9 * heaveFilter(heave);
    if (vehicle.engine) {
      const engineHz = (2 * (1500 + 100 * v)) / 60;
      aVert += 0.05 * Math.sin(2 * Math.PI * engineHz * (step * dt));
    }
    if (handFilter) aVert = 0.6 * handFilter(aVert);
    yaw += (-yaw / 3) * dt + vehicle.yawSd * Math.sqrt((2 / 3) * dt) * roadRng.normal();
    const aLong = longFilter((v - previousV) / dt);
    vertical.push(aVert);
    longitudinal.push(aLong);
    lateral.push(v * yaw * (Math.PI / 180));
    yawRate.push(yaw);
    speeds.push(v);
    previousV = v;
    x += v * dt;
    step += 1;
  }
  const durationMs = step;
  if (spans.length) spans[spans.length - 1].endMs = durationMs;

  // ---------- phone orientation over time ----------
  const phone = spec.phone;
  const baseMatrix = orientationMatrix(phone.tilt);
  const changes = phone.changes.map((change) => {
    return { ...change, target: orientationMatrix(change.tilt) };
  });
  const bursts = [...phone.bursts];
  if (phone.placement === "hand" && phone.burstEveryS) {
    for (let t = phone.burstEveryS * (0.5 + handRng.next()); t < durationMs / 1000 - 3; t += phone.burstEveryS * (0.6 + 0.8 * handRng.next())) {
      bursts.push({ atS: t, durationS: 1.2 + handRng.next(), angleDeg: 50 + 60 * handRng.next(), axis: [handRng.normal(), handRng.normal(), handRng.normal()] });
    }
  }
  const tremor = phone.placement === "hand"
    ? [0, 1, 2].map(() => ({ amplitude: (1.5 + handRng.next() * 1.5) * (Math.PI / 180), hz: 0.3 + handRng.next() * 1.5, phase: handRng.next() * 2 * Math.PI }))
    : null;

  function orientationAt(tS) {
    let matrix = baseMatrix;
    for (const change of changes) {
      if (tS < change.atS) break;
      const progress = smoothstep((tS - change.atS) / change.durationS);
      const relative = matMul(transpose(matrix), change.target);
      const vector = rotationVector(relative);
      const angle = Math.hypot(...vector);
      matrix = angle > 1e-9 ? matMul(matrix, axisAngleMatrix(vector, angle * progress)) : matrix;
    }
    if (tremor) {
      const vector = tremor.map((item) => item.amplitude * Math.sin(2 * Math.PI * item.hz * tS + item.phase));
      matrix = matMul(matrix, axisAngleMatrix(vector, Math.hypot(...vector)));
    }
    for (const burst of bursts) {
      const progress = (tS - burst.atS) / burst.durationS;
      if (progress <= 0 || progress >= 1) continue;
      matrix = matMul(matrix, axisAngleMatrix(burst.axis ?? [1, 0, 0], (burst.angleDeg * Math.PI / 180) * Math.sin(Math.PI * progress) ** 2));
    }
    return matrix;
  }

  function handAccelerationAt(tS) {
    const out = [0, 0, 0];
    for (const burst of bursts) {
      const progress = (tS - burst.atS) / burst.durationS;
      if (progress <= 0 || progress >= 1) continue;
      const magnitude = 1.8 * Math.sin(2 * Math.PI * progress);
      out[0] += 0.4 * magnitude;
      out[1] += magnitude;
      out[2] += 0.6 * magnitude;
    }
    return out;
  }

  const interpolate = (array, tMs) => {
    const position = Math.min(array.length - 1, Math.max(0, tMs));
    const lower = Math.floor(position);
    const upper = Math.min(array.length - 1, lower + 1);
    const weight = position - lower;
    return array[lower] * (1 - weight) + array[upper] * weight;
  };

  // ---------- point sampling at device timestamps ----------
  const { sampling } = spec;
  const trace = emptyTrace({
    dataKind: "synthetic",
    mode: spec.mode,
    meta: {
      createdBy: "synthetic-generator",
      synthetic: { id: spec.id, seed: spec.seed, generatorVersion: 1, roadScale: spec.roadScale, sections: spec.sections.map(({ events, ...rest }) => ({ ...rest, events: events?.length ?? 0 })) },
      gpsMode: spec.gps.enabled ? (spec.gps.positions ? "speed-and-position" : "speed-only") : "off",
      reportedInterval: Number((1000 / sampling.hz).toFixed(3)),
      notice: "SYNTHETIC DATA — generated by a simplified model, not a road recording.",
    },
  });
  const periodMs = 1000 / sampling.hz;
  const deg = 180 / Math.PI;
  const quantize = (value) => (sampling.quantizeMs2 > 0 ? Math.round(value / sampling.quantizeMs2) * sampling.quantizeMs2 : value);
  const round = (value, digits) => Number(value.toFixed(digits));
  const inGap = (tMs) => sampling.gaps.some((gap) => tMs >= gap.atS * 1000 && tMs < (gap.atS + gap.durationS) * 1000);
  let previousRow = null;
  for (let i = 0; ; i += 1) {
    const sampleMs = i * periodMs + sampling.sampleJitterMs * timingRng.normal();
    if (sampleMs > durationMs - 1) break;
    if (sampleMs < 0 || inGap(sampleMs)) continue;
    if (timingRng.chance(sampling.dropProbability)) continue;
    const recordedMs = sampleMs + 1 + Math.abs(sampling.timestampJitterMs * timingRng.normal());
    if (previousRow && timingRng.chance(sampling.duplicateProbability)) {
      trace.motion.rows.push([round(recordedMs, 3), ...previousRow.slice(1)]);
      continue;
    }
    const tS = sampleMs / 1000;
    const matrix = orientationAt(tS);
    const inverse = transpose(matrix);
    const dynamic = [interpolate(longitudinal, sampleMs), interpolate(lateral, sampleMs), interpolate(vertical, sampleMs)];
    const hand = phone.placement === "hand" ? handAccelerationAt(tS) : [0, 0, 0];
    const linearPhone = apply(inverse, dynamic).map((value, axis) => value + hand[axis]);
    const forcePhone = apply(inverse, [dynamic[0], dynamic[1], dynamic[2] + G]).map((value, axis) => value + hand[axis]);
    const sign = phone.gravitySign;
    const aig = forcePhone.map((value) => {
      let reading = sign * value + phone.noiseMs2 * sensorRng.normal();
      if (phone.clipMs2) reading = Math.max(-phone.clipMs2, Math.min(phone.clipMs2, reading));
      return quantize(reading);
    });
    const lin = phone.linear ? linearPhone.map((value) => quantize(sign * value + phone.noiseMs2 * sensorRng.normal())) : [null, null, null];
    let rotation = [null, null, null];
    if (phone.gyro) {
      const delta = 0.002;
      const relative = matMul(inverse, orientationAt(tS + delta));
      const body = rotationVector(relative).map((value) => (value / delta) * deg);
      const vehicleYaw = apply(inverse, [0, 0, interpolate(yawRate, sampleMs)]);
      const omega = body.map((value, axis) => value + vehicleYaw[axis] + phone.gyroNoiseDegS * sensorRng.normal());
      // W3C order: alpha (about z), beta (about x), gamma (about y).
      rotation = [omega[2], omega[0], omega[1]];
    }
    const row = [
      round(recordedMs, 3),
      ...aig.map((value) => round(value, 4)),
      ...lin.map((value) => (value === null ? null : round(value, 4))),
      ...rotation.map((value) => (value === null ? null : round(value, 3))),
    ];
    trace.motion.rows.push(row);
    previousRow = row;
  }

  // ---------- GPS ----------
  if (spec.gps.enabled) {
    const inDropout = (tMs) => spec.gps.dropouts.some((drop) => tMs >= drop.atS * 1000 && tMs < (drop.atS + drop.durationS) * 1000);
    let travelled = 0;
    let lastIndex = 0;
    for (let tMs = 137; tMs < durationMs; tMs += spec.gps.intervalMs) {
      const fixMs = tMs + 30 * gpsRng.normal();
      const index = Math.max(0, Math.min(speeds.length - 1, Math.round(fixMs)));
      for (let k = lastIndex; k < index; k += 1) travelled += speeds[k] * dt;
      lastIndex = Math.max(lastIndex, index);
      if (inDropout(fixMs)) continue;
      const speed = gpsRng.chance(spec.gps.nullSpeedProbability) ? null : Math.max(0, speeds[index] + spec.gps.speedNoiseMs * gpsRng.normal());
      const accuracy = 4 + Math.abs(2 * gpsRng.normal());
      // Positions, if requested, are on a synthetic straight line from (0, 0) ("Null Island").
      const lat = spec.gps.positions ? round((3 * gpsRng.normal()) / 111320, 7) : null;
      const lon = spec.gps.positions ? round((travelled + 3 * gpsRng.normal()) / 111320, 7) : null;
      trace.gps.rows.push([round(fixMs, 1), lat, lon, round(accuracy, 1), speed === null ? null : round(speed, 2), 90]);
    }
  }
  trace.meta.durationMs = durationMs;
  trace.meta.distanceM = Number(totalM.toFixed(1));

  return {
    trace,
    truth: {
      dataKind: "synthetic",
      durationMs,
      spans: spans.map((span) => {
        const rest = { ...span };
        delete rest.sectionIndex;
        return rest;
      }),
      events: truthEvents,
      bursts: bursts.map((burst) => ({ atS: burst.atS, durationS: burst.durationS })),
      changes: changes.map((change) => ({ atS: change.atS, durationS: change.durationS })),
    },
  };
}
