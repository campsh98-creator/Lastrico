/**
 * Seeded pseudo-random numbers for deterministic synthetic data.
 * mulberry32 core + Box-Muller normals. Same seed => same sequence on the same JS engine.
 */

/** FNV-1a 32-bit hash of a string, used to derive child seeds from labels. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  let spare = null;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function normal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  }

  return {
    next,
    normal,
    uniform: (low, high) => low + (high - low) * next(),
    int: (low, highInclusive) => low + Math.floor(next() * (highInclusive - low + 1)),
    chance: (probability) => next() < probability,
    /** Independent child stream, so adding draws in one place does not shift another. */
    fork: (label) => createRng((hashString(String(label)) ^ Math.imul(Number(seed) >>> 0, 2654435761)) >>> 0),
  };
}
