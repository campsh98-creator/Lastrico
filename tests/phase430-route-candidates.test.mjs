import assert from "node:assert/strict";
import test from "node:test";
import { routesShareCorridor } from "../lib/route-candidates.ts";

/**
 * Phase 4.30: the segment grid and memoisation must give exactly the answer of the original
 * brute-force scan. This is that scan, kept verbatim as the reference.
 */
function distanceToSegment(point, a, b, toleranceMeters) {
  if (toleranceMeters !== undefined) {
    const padLat = toleranceMeters / 110_540;
    const minY = a[1] < b[1] ? a[1] : b[1];
    const maxY = a[1] > b[1] ? a[1] : b[1];
    if (point[1] < minY - padLat || point[1] > maxY + padLat) return Infinity;
    const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const padLon = toleranceMeters / Math.max(1, scale);
    const minX = a[0] < b[0] ? a[0] : b[0];
    const maxX = a[0] > b[0] ? a[0] : b[0];
    if (point[0] < minX - padLon || point[0] > maxX + padLon) return Infinity;
  }
  const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * scale, dy = (b[1] - a[1]) * 110_540;
  const px = (point[0] - a[0]) * scale, py = (point[1] - a[1]) * 110_540;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - ratio * dx, py - ratio * dy);
}
const pointDistance = (a, b) => distanceToSegment(a, b, b);
const routeLength = (c) => c.slice(1).reduce((s, p, i) => s + pointDistance(p, c[i]), 0);
function referenceDivergent(route, other, tolerance) {
  let divergent = 0;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1], b = route[index], length = pointDistance(a, b);
    if (!length) continue;
    const samples = Math.max(1, Math.ceil(length / 25));
    for (let sample = 0; sample < samples; sample += 1) {
      const ratio = (sample + 0.5) / samples;
      const point = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
      let near = false;
      for (let k = 1; k < other.length && !near; k += 1) near = distanceToSegment(point, other[k - 1], other[k], tolerance) <= tolerance;
      if (!near) divergent += length / samples;
    }
  }
  return divergent;
}
function referenceShare(a, b, tolerance) {
  if (a.length < 2 || b.length < 2) return false;
  if (distanceToSegment(a[0], b[0], b[0]) >= tolerance || distanceToSegment(a.at(-1), b.at(-1), b.at(-1)) >= tolerance) return false;
  const allowance = Math.max(60, 0.03 * Math.min(routeLength(a), routeLength(b)));
  return referenceDivergent(a, b, tolerance) <= allowance && referenceDivergent(b, a, tolerance) <= allowance;
}

function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const metersPerLon = 111_320 * Math.cos(45.47 * Math.PI / 180);
const at = (x, y) => [9.18 + x / metersPerLon, 45.47 + y / 110_540];

/** A random walk route, and variants that share it, diverge from it, or run parallel to it. */
function walk(random, points, start = [0, 0]) {
  const out = [at(...start)];
  let [x, y] = start, heading = random() * Math.PI * 2;
  for (let i = 1; i < points; i += 1) {
    heading += (random() - 0.5) * 1.2;
    const step = 15 + random() * 70;
    x += Math.cos(heading) * step; y += Math.sin(heading) * step;
    out.push(at(x, y));
  }
  return out;
}
function variant(random, route, kind) {
  const jitter = (c, m) => [c[0] + (random() - 0.5) * m / metersPerLon, c[1] + (random() - 0.5) * m / 110_540];
  if (kind === "same") return route.map((c) => [...c]);
  if (kind === "noisy") return route.map((c) => jitter(c, 6));
  if (kind === "parallel") return route.map((c) => [c[0], c[1] + 35 / 110_540]);
  if (kind === "detour") {
    const i = Math.floor(route.length / 3), j = Math.floor(route.length * 2 / 3);
    return [...route.slice(0, i), ...route.slice(i, j).map((c) => [c[0] + 120 / metersPerLon, c[1]]), ...route.slice(j)];
  }
  return route.slice(0, Math.max(2, Math.floor(route.length * 0.7)));
}

test("corridor sharing with the grid equals the brute-force reference on 600 random route pairs", () => {
  const random = prng(430);
  let agreed = 0, shared = 0;
  for (let trial = 0; trial < 120; trial += 1) {
    const base = walk(random, 20 + Math.floor(random() * 120));
    for (const kind of ["same", "noisy", "parallel", "detour", "subset"]) {
      const other = variant(random, base, kind);
      for (const tolerance of [18, 25, 40]) {
        const expected = referenceShare(base, other, tolerance);
        const actual = routesShareCorridor({ coordinates: base }, { coordinates: other }, tolerance);
        assert.equal(actual, expected, `trial ${trial} ${kind} tolerance ${tolerance}`);
        // Asked again (memoised) and in the other direction.
        assert.equal(routesShareCorridor({ coordinates: base }, { coordinates: other }, tolerance), expected);
        assert.equal(routesShareCorridor({ coordinates: other }, { coordinates: base }, tolerance), referenceShare(other, base, tolerance));
        agreed += 1;
        if (expected) shared += 1;
      }
    }
  }
  assert.equal(agreed, 1800);
  assert.ok(shared > 200 && shared < 1600, `both outcomes are exercised (${shared} shared)`);
});

test("long north-south routes with large longitude spans still agree with the reference", () => {
  const random = prng(7);
  for (let trial = 0; trial < 20; trial += 1) {
    const base = Array.from({ length: 60 }, (_, i) => at((random() - 0.5) * 40, i * 90));
    const other = base.map((c) => [c[0] + (random() - 0.5) * 30 / metersPerLon, c[1]]);
    assert.equal(routesShareCorridor({ coordinates: base }, { coordinates: other }, 25), referenceShare(base, other, 25));
  }
});
