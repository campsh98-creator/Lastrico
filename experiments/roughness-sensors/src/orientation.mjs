/**
 * Orientation-independent vertical vibration.
 *
 * The phone can sit at any angle (mount, cup holder, hand). We estimate the gravity direction in
 * the phone frame with a zero-phase low-pass filter and project the acceleration onto it. The
 * result does not depend on how the phone is held, nor on the sign convention of the platform
 * (WebKit on iOS reports accelerationIncludingGravity with the opposite sign of the W3C example),
 * because the projection axis is estimated from the same signal.
 */
import { designBiquad, filtfilt } from "./dsp.mjs";

const DEFAULTS = {
  /** Cut-off when only accelerationIncludingGravity exists (gravity must be separated by filtering). */
  gravityCutoffHz: 0.3,
  /** Cut-off when linear acceleration exists (aig - lin is already the platform's gravity estimate). */
  fusedGravityCutoffHz: 1.0,
};

/**
 * @returns {{ gx: Float64Array, gy: Float64Array, gz: Float64Array, magnitude: Float64Array, source: string }}
 *   unit gravity direction per sample (phone frame) and its magnitude in m/s^2.
 */
export function estimateGravity(run, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const { n, fs, aig, lin } = run;
  const source = lin ? "fused" : "low-pass";
  const cutoff = Math.min((lin ? options.fusedGravityCutoffHz : options.gravityCutoffHz), fs / 4);
  const sections = [designBiquad("lowpass", cutoff, fs)];
  const pad = Math.min(n - 1, Math.round(fs * 3));
  const raw = [0, 1, 2].map((axis) => {
    if (!lin) return aig[axis];
    const difference = new Float64Array(n);
    for (let k = 0; k < n; k += 1) difference[k] = aig[axis][k] - lin[axis][k];
    return difference;
  });
  const [fx, fy, fz] = raw.map((channel) => filtfilt(sections, channel, pad));
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const gz = new Float64Array(n);
  const magnitude = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const length = Math.hypot(fx[k], fy[k], fz[k]) || 1;
    gx[k] = fx[k] / length;
    gy[k] = fy[k] / length;
    gz[k] = fz[k] / length;
    magnitude[k] = length;
  }
  return { gx, gy, gz, magnitude, source };
}

/** Vertical (gravity-axis) dynamic acceleration in m/s^2, plus the horizontal magnitude. */
export function projectVertical(run, gravity) {
  const { n, aig, lin } = run;
  const vertical = new Float64Array(n);
  const horizontal = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const ux = gravity.gx[k];
    const uy = gravity.gy[k];
    const uz = gravity.gz[k];
    let ax;
    let ay;
    let az;
    if (lin) {
      ax = lin[0][k];
      ay = lin[1][k];
      az = lin[2][k];
    } else {
      // Remove the low-pass gravity vector itself.
      ax = aig[0][k] - ux * gravity.magnitude[k];
      ay = aig[1][k] - uy * gravity.magnitude[k];
      az = aig[2][k] - uz * gravity.magnitude[k];
    }
    const along = ax * ux + ay * uy + az * uz;
    vertical[k] = along;
    horizontal[k] = Math.hypot(ax - along * ux, ay - along * uy, az - along * uz);
  }
  return { vertical, horizontal };
}

/** Angle in degrees between the gravity directions at two sample indices. */
export function gravityAngleDeg(gravity, i, j) {
  const dot = gravity.gx[i] * gravity.gx[j] + gravity.gy[i] * gravity.gy[j] + gravity.gz[i] * gravity.gz[j];
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** |rotationRate| in deg/s per sample, or null when the device reported no gyroscope. */
export function rotationMagnitude(run) {
  if (!run.rot) return null;
  const out = new Float64Array(run.n);
  for (let k = 0; k < run.n; k += 1) out[k] = Math.hypot(run.rot[0][k], run.rot[1][k], run.rot[2][k]);
  return out;
}
