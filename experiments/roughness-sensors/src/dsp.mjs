/**
 * Small, dependency-free signal-processing helpers (pure functions, Float64Array based).
 */

/** RBJ audio-EQ-cookbook biquad coefficients, normalised so a0 = 1. */
export function designBiquad(type, cutoffHz, sampleRateHz, q = Math.SQRT1_2) {
  const nyquist = sampleRateHz / 2;
  if (!(cutoffHz > 0 && cutoffHz < nyquist)) {
    throw new RangeError(`Cutoff ${cutoffHz} Hz must be inside (0, ${nyquist}) Hz`);
  }
  const w0 = (2 * Math.PI * cutoffHz) / sampleRateHz;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0;
  let b1;
  let b2;
  if (type === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (type === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else if (type === "bandpass") {
    // Constant 0 dB peak gain.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    throw new TypeError(`Unknown biquad type ${type}`);
  }
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Direct form II transposed. Writes into `out` (may alias `input`). */
export function applyBiquad(coeffs, input, out = new Float64Array(input.length)) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  let z1 = 0;
  let z2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x = input[index];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[index] = y;
  }
  return out;
}

/** Stateful biquad for sample-by-sample simulation. */
export function createBiquadState(coeffs) {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

function reversed(array) {
  const out = new Float64Array(array.length);
  for (let index = 0; index < array.length; index += 1) out[index] = array[array.length - 1 - index];
  return out;
}

/**
 * Zero-phase filtering (forward then backward through every section) with odd-reflection
 * padding to tame edge transients. The magnitude response is squared.
 */
export function filtfilt(sections, input, padLength = 0) {
  const n = input.length;
  if (n === 0) return new Float64Array(0);
  const pad = Math.max(0, Math.min(padLength, n - 1));
  const extended = new Float64Array(n + 2 * pad);
  const first = input[0];
  const last = input[n - 1];
  for (let index = 0; index < pad; index += 1) extended[index] = 2 * first - input[pad - index];
  extended.set(input, pad);
  for (let index = 0; index < pad; index += 1) extended[pad + n + index] = 2 * last - input[n - 2 - index];
  let signal = extended;
  for (const section of sections) signal = applyBiquad(section, signal);
  signal = reversed(signal);
  for (const section of sections) signal = applyBiquad(section, signal);
  signal = reversed(signal);
  return signal.slice(pad, pad + n);
}

/** Band-pass as a 2nd-order high-pass followed by a 2nd-order low-pass (Butterworth Q). */
export function bandpassSections(lowHz, highHz, sampleRateHz) {
  const sections = [];
  if (lowHz > 0) sections.push(designBiquad("highpass", lowHz, sampleRateHz));
  if (highHz < sampleRateHz / 2) sections.push(designBiquad("lowpass", highHz, sampleRateHz));
  return sections;
}

export function nextPowerOfTwo(value) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

/** In-place iterative radix-2 complex FFT. Length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new RangeError("FFT length must be a power of two");
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

const hannCache = new Map();
export function hann(length) {
  if (!hannCache.has(length)) {
    const window = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
    }
    hannCache.set(length, window);
  }
  return hannCache.get(length);
}

/**
 * One-sided power spectrum of `signal[start, start+length)` with a Hann window, mean removed.
 * Returns power per bin (bin k at k * fs / length Hz); the sum approximates the window's variance.
 */
export function powerSpectrum(signal, start, length) {
  const window = hann(length);
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  let mean = 0;
  for (let index = 0; index < length; index += 1) mean += signal[start + index];
  mean /= length;
  let windowPower = 0;
  for (let index = 0; index < length; index += 1) {
    re[index] = (signal[start + index] - mean) * window[index];
    windowPower += window[index] * window[index];
  }
  fft(re, im);
  const bins = length / 2 + 1;
  const power = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) {
    const magnitude = re[k] * re[k] + im[k] * im[k];
    power[k] = ((k === 0 || k === length / 2) ? 1 : 2) * magnitude / (windowPower * length);
  }
  return power;
}

export function rms(values, start = 0, end = values.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] * values[index];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/** Linear-interpolated percentile (p in [0, 100]) of finite values. */
export function percentile(values, p) {
  const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const position = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export const median = (values) => percentile(values, 50);

export function mad(values) {
  const center = median(values);
  return median(Array.from(values, (value) => Math.abs(value - center)));
}

export function mean(values) {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : NaN;
}

/** Index of the last element <= target in a sorted numeric array, or -1. */
export function lowerIndex(sorted, target) {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
