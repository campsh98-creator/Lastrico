import assert from "node:assert/strict";
import test from "node:test";
import {
  bandpassSections, designBiquad, fft, filtfilt, mad, median, nextPowerOfTwo, percentile, powerSpectrum, rms,
} from "../src/dsp.mjs";
import { createRng } from "../src/prng.mjs";

const sine = (hz, fs, n, amplitude = 1, phase = 0) => Float64Array.from({ length: n }, (_, k) => amplitude * Math.sin(2 * Math.PI * hz * (k / fs) + phase));

test("seeded PRNG is deterministic and roughly standard normal", () => {
  const a = createRng(42);
  const b = createRng(42);
  const sequenceA = Array.from({ length: 5 }, () => a.next());
  const sequenceB = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(sequenceA, sequenceB);
  assert.notDeepEqual(sequenceA, Array.from({ length: 5 }, createRng(43).next));
  const rng = createRng(7);
  const values = Array.from({ length: 20000 }, () => rng.normal());
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.03, `sd ${sd}`);
  assert.notEqual(createRng(1).fork("a").next(), createRng(1).fork("b").next());
});

test("FFT matches a direct DFT", () => {
  const rng = createRng(3);
  const n = 32;
  const signal = Array.from({ length: n }, () => rng.normal());
  const re = Float64Array.from(signal);
  const im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k < n; k += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t += 1) {
      sumRe += signal[t] * Math.cos((-2 * Math.PI * k * t) / n);
      sumIm += signal[t] * Math.sin((-2 * Math.PI * k * t) / n);
    }
    assert.ok(Math.abs(re[k] - sumRe) < 1e-9 && Math.abs(im[k] - sumIm) < 1e-9);
  }
  assert.throws(() => fft(new Float64Array(12), new Float64Array(12)), RangeError);
});

test("power spectrum peaks at the sine frequency and preserves variance", () => {
  const fs = 64;
  const signal = sine(8, fs, 64, 2);
  const power = powerSpectrum(signal, 0, 64);
  const peak = power.indexOf(Math.max(...power));
  assert.equal(peak, 8);
  const total = power.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - rms(signal) ** 2) / rms(signal) ** 2 < 0.05, `total ${total}`);
});

test("band-pass keeps in-band tones and rejects out-of-band ones, with zero phase", () => {
  const fs = 60;
  const n = 1200;
  const sections = bandpassSections(3, 25, fs);
  const pass = filtfilt(sections, sine(10, fs, n), 60);
  const low = filtfilt(sections, sine(0.3, fs, n), 60);
  assert.ok(rms(pass, 100, n - 100) > 0.65, `pass ${rms(pass, 100, n - 100)}`);
  assert.ok(rms(low, 100, n - 100) < 0.02, `low ${rms(low, 100, n - 100)}`);
  // Zero phase: the filtered tone stays aligned with the input.
  const input = sine(10, fs, n);
  let best = 0;
  let bestLag = 0;
  for (let lag = -3; lag <= 3; lag += 1) {
    let sum = 0;
    for (let k = 100; k < n - 100; k += 1) sum += input[k] * pass[k + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  assert.equal(bestLag, 0);
  assert.throws(() => designBiquad("lowpass", 40, 60), RangeError);
});

test("robust statistics", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(percentile([0, 10], 25), 2.5);
  assert.equal(mad([1, 1, 2, 2, 4, 6, 9]), 1);
  assert.equal(nextPowerOfTwo(60), 64);
  assert.ok(Number.isNaN(percentile([], 50)));
});
