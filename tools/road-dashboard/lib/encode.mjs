// Compact, deterministic display geometry: segments of the same OSM way and category are chained into
// polylines, quantised to 1e-5 degree (~0.8–1.1 m) relative to the area origin, and delta-encoded.
// Display only: every metric is computed from full-precision source coordinates, never from this encoding.

export const QUANT = 1e5;

/**
 * Chain directed segments into polylines. segs: [{a: [lon, lat], b: [lon, lat]}] in a stable order.
 * Returns arrays of points. Unchainable pieces become their own polylines; nothing is dropped.
 */
export function chainSegments(segs) {
  const k = (p) => `${p[0]},${p[1]}`;
  const byStart = new Map();
  const endCount = new Map();
  segs.forEach((s, i) => {
    const ka = k(s.a);
    const list = byStart.get(ka);
    if (list) list.push(i); else byStart.set(ka, [i]);
    const kb = k(s.b);
    endCount.set(kb, (endCount.get(kb) ?? 0) + 1);
  });
  const visited = new Uint8Array(segs.length);
  const lines = [];
  const walk = (start) => {
    visited[start] = 1;
    const line = [segs[start].a, segs[start].b];
    let cur = k(segs[start].b);
    for (;;) {
      const nexts = byStart.get(cur);
      let next = -1;
      if (nexts) for (const j of nexts) if (!visited[j]) { next = j; break; }
      if (next < 0) break;
      visited[next] = 1;
      line.push(segs[next].b);
      cur = k(segs[next].b);
    }
    lines.push(line);
  };
  for (let i = 0; i < segs.length; i += 1) if (!visited[i] && !endCount.get(k(segs[i].a))) walk(i);
  for (let i = 0; i < segs.length; i += 1) if (!visited[i]) walk(i);
  return lines;
}

/** [x0, y0, dx1, dy1, ...] integers in 1e-5 degree units relative to (lon0, lat0). */
export function encodeLine(points, lon0, lat0, prefix = []) {
  const out = prefix.slice();
  let px = 0;
  let py = 0;
  points.forEach((p, i) => {
    const x = Math.round((p[0] - lon0) * QUANT);
    const y = Math.round((p[1] - lat0) * QUANT);
    if (i === 0) { out.push(x, y); } else { out.push(x - px, y - py); }
    px = x;
    py = y;
  });
  return out;
}

export function decodeLine(encoded, lon0, lat0, offset = 0) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (let i = offset; i + 1 < encoded.length; i += 2) {
    if (i === offset) { x = encoded[i]; y = encoded[i + 1]; } else { x += encoded[i]; y += encoded[i + 1]; }
    pts.push([lon0 + x / QUANT, lat0 + y / QUANT]);
  }
  return pts;
}
