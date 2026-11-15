/**
 * Phase 4.36 / Agent 6 (smartphone sensing feasibility) - shared helpers for the sens-*.mjs simulations.
 * ISOLATED, OFFLINE, DETERMINISTIC: Node built-ins only, no network, no device sensors, no real data.
 * Everything computed with these helpers is a SIMULATION or an analytic derivation, never a measurement.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export { createRng, hashString } from "../../roughness-sensors/src/prng.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const OUT = join(ROOT, "outputs/phase436-surface-intelligence/evidence/smartphone-sensor-feasibility");
export const ASOF = "2026-11-14";
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** JSON with sorted object keys so identical content gives identical bytes. */
export function stable(value, indent = 1) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value), null, indent) + "\n";
}

/** Write a result file into the evidence folder and return its SHA-256. */
export function writeEvidence(name, value) {
  mkdirSync(OUT, { recursive: true });
  const text = typeof value === "string" ? value : stable(value);
  writeFileSync(join(OUT, name), text);
  return sha256(text);
}

export const KMH = 1 / 3.6;
export const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

// Standard normal pdf / cdf (Abramowitz-Stegun 7.1.26 via erf; |error| < 1.5e-7)
export function erf(x) {
  const s = Math.sign(x); const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
export const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
/** Inverse normal cdf (Acklam rational approximation, |relative error| < 1.2e-9). */
export function PhiInv(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425; const hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5; const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export const quantile = (sorted, p) => {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p; const lo = Math.floor(idx); const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};
