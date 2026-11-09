// Lastrico Road Intelligence Dashboard — vanilla JS, canvas, no external resources.
// All labels coming from data are inserted with textContent (never innerHTML).
"use strict";

(() => {
  // Display order of the five categories (decoding uses the production order in the build, not here).
  const CATS = ["confirmed_smooth", "confirmed_rough", "probable_rough", "unpaved_loose", "unknown"];
  const DRAW_ORDER = ["confirmed_smooth", "unpaved_loose", "unknown", "probable_rough", "confirmed_rough"];
  const STYLE = {
    confirmed_rough: { width: 3, dash: [] },
    probable_rough: { width: 2.5, dash: [6, 3] },
    confirmed_smooth: { width: 1, dash: [] },
    unpaved_loose: { width: 1.5, dash: [] },
    unknown: { width: 1.5, dash: [4, 3] },
  };
  const LAYERS = [
    { id: "confirmed_smooth", on: true }, { id: "confirmed_rough", on: true }, { id: "probable_rough", on: true },
    { id: "unpaved_loose", on: true }, { id: "unknown", on: true },
    { id: "tiles", on: false, label: "Tile 0,01° (quota sconosciuta)" },
    { id: "cells", on: false, label: "Celle 250 m (colore)" },
    { id: "hotspots", on: true, label: "Hotspot di incertezza" },
    { id: "experimental", on: false, label: "Previsione sperimentale — non verificata", experimental: true },
  ];
  const M_LAT = 110540;
  const nf0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const km = (m) => nf1.format(m / 1000);
  const pct = (x) => (x === null || x === undefined ? "—" : `${nf1.format(100 * x)}%`);

  const state = {
    area: "milan", verified: null, research: null, manifest: null, geom: {}, exp: null, expPromise: null,
    layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.on])), cellMetric: "unknownShare",
    view: null, selectedHotspot: null, dpr: 1, w: 0, h: 0, pending: false,
  };
  const $ = (id) => document.getElementById(id);
  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const COLORS = Object.fromEntries(CATS.map((c) => [c, color(`--cat-${c}`)]));
  const SEQ = ["--seq-100", "--seq-200", "--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"].map(color);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  function table(headers, rows, numeric = []) {
    const thead = el("thead", {}, el("tr", {}, headers.map((h, i) => el("th", { class: numeric.includes(i) ? "n" : null, scope: "col", text: h }))));
    const tbody = el("tbody", {}, rows.map((r) => el("tr", {}, r.map((cell, i) => el("td", { class: numeric.includes(i) ? "n" : null }, cell)))));
    return el("div", { class: "table-scroll" }, el("table", {}, [thead, tbody]));
  }
  async function getJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  // ---------- geometry ----------
  function areaProj(area) {
    const p = state.verified.areas[area].grid.projection;
    return { lon0: p.lon0, lat0: p.lat0, kx: p.kx, ky: M_LAT };
  }
  function decodeLayer(lines, proj, withP) {
    let n = 0;
    for (const l of lines) n += (l.length - (withP ? 1 : 0)) / 2;
    const xy = new Float32Array(n * 2);
    const offsets = new Int32Array(lines.length + 1);
    const bbox = new Float32Array(lines.length * 4);
    const p = withP ? new Float32Array(lines.length) : null;
    let k = 0;
    lines.forEach((l, li) => {
      offsets[li] = k / 2;
      let qx = 0; let qy = 0; let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      const start = withP ? 1 : 0;
      if (withP) p[li] = l[0] / 1000;
      for (let i = start; i + 1 < l.length; i += 2) {
        if (i === start) { qx = l[i]; qy = l[i + 1]; } else { qx += l[i]; qy += l[i + 1]; }
        const x = (qx / 1e5) * proj.kx; const y = (qy / 1e5) * proj.ky;
        xy[k++] = x; xy[k++] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      bbox[li * 4] = minX; bbox[li * 4 + 1] = minY; bbox[li * 4 + 2] = maxX; bbox[li * 4 + 3] = maxY;
    });
    offsets[lines.length] = k / 2;
    return { xy, offsets, bbox, p, count: lines.length };
  }
  async function loadGeometry(area) {
    if (state.geom[area]) return state.geom[area];
    const g = await getJson(`data/geometry-${area}.json`);
    const proj = areaProj(area);
    const layers = {};
    for (const c of CATS) layers[c] = decodeLayer(g.layers[c] ?? [], proj, false);
    state.geom[area] = { layers, polylines: g.polylines, points: g.points };
    return state.geom[area];
  }
  function loadExperimental() {
    if (!state.expPromise) {
      state.expPromise = getJson("data/experimental-predictions.json").then((e) => {
        const out = { raw: e, areas: {} };
        for (const [area, a] of Object.entries(e.areas)) {
          const proj = areaProj(area);
          const cells = new Map(a.grid.rows.map((r) => [`${r[0]}:${r[1]}`, r]));
          out.areas[area] = { stats: a, cells, lines: decodeLayer(a.geometry.polylines, proj, true) };
        }
        state.exp = out;
        return out;
      });
    }
    return state.expPromise;
  }

  // ---------- view ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    state.dpr = window.devicePixelRatio || 1;
    state.w = r.width; state.h = r.height;
    canvas.width = Math.round(r.width * state.dpr);
    canvas.height = Math.round(r.height * state.dpr);
    if (!state.verified || !state.geom[state.area]) return;
    if (!state.view || state.autoFit) fitArea(); else requestDraw();
  }
  function fitArea() {
    const a = state.verified.areas[state.area];
    const proj = areaProj(state.area);
    const b = a.datasetBounds;
    const x0 = (b.west - proj.lon0) * proj.kx; const x1 = (b.east - proj.lon0) * proj.kx;
    const y0 = (b.south - proj.lat0) * proj.ky; const y1 = (b.north - proj.lat0) * proj.ky;
    const scale = Math.min(state.w / ((x1 - x0) * 1.05), state.h / ((y1 - y0) * 1.05));
    state.view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
    state.autoFit = true;
    requestDraw();
  }
  const toScreen = (x, y) => [(x - state.view.cx) * state.view.scale + state.w / 2, (state.view.cy - y) * state.view.scale + state.h / 2];
  const toWorld = (sx, sy) => [(sx - state.w / 2) / state.view.scale + state.view.cx, state.view.cy - (sy - state.h / 2) / state.view.scale];
  function zoomAt(factor, sx = state.w / 2, sy = state.h / 2) {
    state.autoFit = false;
    $("tooltip").hidden = true;
    const [wx, wy] = toWorld(sx, sy);
    state.view.scale = Math.max(0.005, Math.min(40, state.view.scale * factor));
    const [nx, ny] = toWorld(sx, sy);
    state.view.cx += wx - nx; state.view.cy += wy - ny;
    requestDraw();
  }
  function requestDraw() {
    if (state.pending) return;
    state.pending = true;
    requestAnimationFrame(() => { state.pending = false; draw(); });
  }

  // ---------- drawing ----------
  function cellColor(row) {
    const g = state.verified.areas[state.area].grid;
    let v;
    if (state.cellMetric === "score") {
      const max = state.verified.areas[state.area].hotspots.list[0]?.score || 1;
      v = row[g.fields.indexOf("score")] / max;
    } else {
      const total = row[g.fields.indexOf("total")];
      v = total > 0 ? row[g.fields.indexOf("unknown")] / total : 0;
    }
    if (v <= 0) return null;
    return SEQ[Math.min(6, Math.floor(v * 7))];
  }
  function strokeLayer(layer, viewBox, styleFn) {
    const { xy, offsets, bbox, count } = layer;
    const s = state.view.scale; const cx = state.view.cx; const cy = state.view.cy; const hw = state.w / 2; const hh = state.h / 2;
    ctx.beginPath();
    for (let li = 0; li < count; li += 1) {
      if (bbox[li * 4 + 2] < viewBox[0] || bbox[li * 4] > viewBox[2] || bbox[li * 4 + 3] < viewBox[1] || bbox[li * 4 + 1] > viewBox[3]) continue;
      if (styleFn) { ctx.stroke(); styleFn(li); ctx.beginPath(); }
      const a = offsets[li]; const b = offsets[li + 1];
      for (let i = a; i < b; i += 1) {
        const x = (xy[i * 2] - cx) * s + hw; const y = (cy - xy[i * 2 + 1]) * s + hh;
        if (i === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  function draw() {
    if (!state.view || !state.verified) return;
    const geom = state.geom[state.area];
    const a = state.verified.areas[state.area];
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.fillStyle = color("--surface-1");
    ctx.fillRect(0, 0, state.w, state.h);
    const [vx0, vy1] = toWorld(0, 0); const [vx1, vy0] = toWorld(state.w, state.h);
    const viewBox = [vx0, vy0, vx1, vy1];
    const size = a.grid.cellSizeMeters;
    const px = size * state.view.scale;

    if (state.layers.cells) {
      ctx.globalAlpha = 0.55;
      for (const row of a.grid.rows) {
        const c = cellColor(row);
        if (!c) continue;
        const [sx, sy] = toScreen(row[0] * size, (row[1] + 1) * size);
        ctx.fillStyle = c;
        ctx.fillRect(sx, sy, px, px);
      }
      ctx.globalAlpha = 1;
    }
    if (state.layers.tiles) {
      // Production 0.01° tiles, filled by the share of their length with unknown surface (same ramp as cells).
      const proj = areaProj(state.area);
      for (const t of a.byTile) {
        const [tx, ty] = t.tile.split("_").map(Number);
        const [sx0, sy0] = toScreen((tx / 100 - proj.lon0) * proj.kx, ((ty + 1) / 100 - proj.lat0) * proj.ky);
        const [sx1, sy1] = toScreen(((tx + 1) / 100 - proj.lon0) * proj.kx, (ty / 100 - proj.lat0) * proj.ky);
        const share = t.total > 0 ? t.unknown / t.total : 0;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = share > 0 ? SEQ[Math.min(6, Math.floor(share * 7))] : color("--surface-1");
        ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = SEQ[5]; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }
    if (geom) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const cat of DRAW_ORDER) {
        if (!state.layers[cat]) continue;
        ctx.strokeStyle = COLORS[cat]; ctx.lineWidth = STYLE[cat].width; ctx.setLineDash(STYLE[cat].dash);
        strokeLayer(geom.layers[cat], viewBox);
      }
      ctx.setLineDash([]);
    }
    if (state.layers.experimental && state.exp) {
      const e = state.exp.areas[state.area];
      // White casing first so the dotted experimental marks never blend into the dashed "unknown" evidence layer.
      ctx.strokeStyle = "rgba(252, 252, 251, 0.9)"; ctx.lineWidth = 6; ctx.setLineDash([]); ctx.lineCap = "round";
      strokeLayer(e.lines, viewBox);
      ctx.strokeStyle = color("--exp"); ctx.lineWidth = 3.5; ctx.setLineDash([0.1, 5]); ctx.lineCap = "round";
      strokeLayer(e.lines, viewBox, (li) => { ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, e.lines.p[li] / 0.35); });
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    if (state.layers.hotspots) {
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const h of a.hotspots.list) {
        const [sx, sy] = toScreen(h.cell.ix * size, (h.cell.iy + 1) * size);
        const sel = state.selectedHotspot === h.rank;
        ctx.lineWidth = sel ? 3.5 : 2; ctx.strokeStyle = color("--hotspot");
        ctx.strokeRect(sx, sy, px, px);
        const label = String(h.rank);
        const lw = Math.max(16, ctx.measureText(label).width + 8);
        ctx.fillStyle = color("--hotspot");
        ctx.fillRect(sx, sy - 14, lw, 14);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, sx + lw / 2, sy - 7);
      }
    }
    // scale bar
    const target = state.w / 6 / state.view.scale;
    const pow = 10 ** Math.floor(Math.log10(target));
    const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() || pow;
    const sc = $("scale");
    sc.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    sc.style.width = `${Math.round(nice * state.view.scale)}px`;
  }

  // ---------- tooltip ----------
  function cellAt(sx, sy) {
    const a = state.verified.areas[state.area];
    const [x, y] = toWorld(sx, sy);
    const ix = Math.floor(x / a.grid.cellSizeMeters); const iy = Math.floor(y / a.grid.cellSizeMeters);
    return { ix, iy, row: state.cellIndex.get(`${ix}:${iy}`) };
  }
  function showTooltip(sx, sy) {
    const tip = $("tooltip");
    const { ix, iy, row } = cellAt(sx, sy);
    if (!row) { tip.hidden = true; return; }
    const a = state.verified.areas[state.area];
    const f = (name) => row[a.grid.fields.indexOf(name)];
    const proj = areaProj(state.area);
    const size = a.grid.cellSizeMeters;
    const clon = proj.lon0 + ((ix + 0.5) * size) / proj.kx; const clat = proj.lat0 + ((iy + 0.5) * size) / proj.ky;
    tip.replaceChildren();
    tip.append(el("h3", { text: `Cella 250 m (${ix}, ${iy}) · ${clat.toFixed(5)}, ${clon.toFixed(5)}` }));
    const total = f("total");
    for (const c of CATS) {
      const v = f(c);
      tip.append(el("div", { class: "row" }, [el("span", { class: `key ${c}` }), el("span", { text: state.verified.semantics.categories[c].label }), el("strong", { text: `${nf0.format(v)} m · ${pct(total ? v / total : 0)}` })]));
    }
    tip.append(el("div", { class: "sep" }));
    tip.append(el("div", {}, [el("strong", { text: `${nf0.format(total)} m` }), " totale · nota ", el("strong", { text: pct(total ? 1 - f("unknown") / total : null) })]));
    const rank = f("rank");
    tip.append(el("div", {}, [
      "Incertezza H ", el("strong", { text: nf1.format(f("score")) }), rank ? ` (posizione ${rank})` : " (nessuna)",
    ]));
    tip.append(el("div", { class: "note", text: `U ${nf0.format(f("unknownWeighted"))} · A ${nf2.format(f("adjacency"))} (pavé 3×3 ${nf0.format(f("pave3x3"))} m) · Q ${nf0.format(f("probableWeighted"))}` }));
    const [wx, wy] = toWorld(sx, sy);
    const lonAt = proj.lon0 + wx / proj.kx; const latAt = proj.lat0 + wy / proj.ky;
    const tileKey = `${Math.floor(lonAt * 100)}_${Math.floor(latAt * 100)}`;
    const tileRow = state.tileIndex.get(tileKey);
    if (tileRow) tip.append(el("div", { class: "note", text: `Tile 0,01° ${tileKey}: ${km(tileRow.total)} km, nota ${pct(tileRow.knownShare)}` }));
    const names = a.grid.unknownStreetNames[`${ix}:${iy}`];
    if (names) tip.append(el("div", { class: "note", text: `Sconosciute: ${names.join(", ")}` }));
    if (state.layers.experimental && state.exp) {
      const er = state.exp.areas[state.area].cells.get(`${ix}:${iy}`);
      const block = el("div", { class: "exp-block" }, [el("h3", { text: "Previsione sperimentale — non verificata" })]);
      if (er) block.append(el("div", { text: `${nf0.format(er[2])} m sconosciuti con previsione · p media pesata ${nf2.format(er[3])} · ${er[4]} way` }));
      else block.append(el("div", { text: "Nessuna previsione in questa cella." }));
      block.append(el("div", { class: "note", text: "Non è evidenza; esclusa da totali e punteggio." }));
      tip.append(block);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    tip.style.left = `${Math.min(sx + 14, state.w - tw - 6)}px`;
    tip.style.top = `${Math.min(sy + 14, state.h - th - 6)}px`;
  }

  // ---------- panels ----------
  function renderLayers() {
    const list = $("layer-list");
    list.replaceChildren();
    for (const l of LAYERS) {
      const label = l.label ?? state.verified.semantics.categories[l.id].label;
      const keyClass = l.id === "cells" ? null : l.id === "hotspots" ? "hotspot" : l.id === "tiles" ? "tiles" : l.id;
      const input = el("input", { type: "checkbox", id: `layer-${l.id}` });
      input.checked = state.layers[l.id];
      input.addEventListener("change", () => toggleLayer(l.id, input.checked));
      list.append(el("label", { class: `layer-item${l.experimental ? " experimental" : ""}`, for: `layer-${l.id}` }, [
        input, keyClass ? el("span", { class: `key ${keyClass}` }) : el("span", { text: "▦" }), el("span", { text: label }),
      ]));
    }
    const ramp = $("cell-ramp");
    ramp.replaceChildren(...SEQ.map((c) => { const s = el("span"); s.style.background = c; return s; }),
      el("small", {}, [el("span", { text: state.cellMetric === "score" ? "H basso" : "0%" }), el("span", { text: state.cellMetric === "score" ? "H max (rank 1)" : "100% sconosciuto" })]));
  }
  async function toggleLayer(id, on) {
    state.layers[id] = on;
    if (id === "experimental") {
      $("exp-banner").hidden = !on;
      $("exp-panel").hidden = !on;
      if (on) { await loadExperimental(); renderExperimentalPanel(); }
    }
    requestDraw();
  }
  function renderLegend() {
    const sem = state.verified.semantics;
    const dl = el("dl");
    for (const c of CATS) {
      dl.append(el("dt", {}, [el("span", { class: `key ${c}` }), sem.categories[c].label]));
      dl.append(el("dd", { text: sem.categories[c].definition }));
    }
    dl.append(el("dt", {}, [el("span", { class: "key hotspot" }), "Hotspot di incertezza (riquadro numerato)"]));
    dl.append(el("dd", { text: state.verified.hotspotDefinition.framing }));
    dl.append(el("dt", {}, [el("span", { class: "key tiles" }), "Tile 0,01° di produzione"]));
    dl.append(el("dd", { text: "Le tile del runtime di Lastrico (chiave floor(lon×100)_floor(lat×100)). Colore: quota di lunghezza sconosciuta, stessa scala delle celle. Spente di default." }));
    dl.append(el("dt", {}, ["▦ Celle 250 m"]));
    dl.append(el("dd", { text: `${state.verified.projection} Colore: quota di lunghezza sconosciuta o punteggio H, in 7 classi.` }));
    const exp = el("div", { class: "exp" }, [
      el("dt", {}, [el("span", { class: "key experimental" }), "Previsione sperimentale — non verificata"]),
      el("dd", { text: "Way senza evidenza di superficie con probabilità di pavé stimata dal modello della Fase 4.17 (NO-GO). Puntini viola su bordo bianco, disegnati sopra tratti che restano «sconosciuti». Opacità ∝ p (massimo osservato ≈ 0,34). Spento di default; mai sommato ai totali." }),
    ]);
    dl.append(exp);
    $("legend").replaceChildren(el("p", { class: "note", text: sem.confirmedMeans }), dl, el("p", { class: "note", text: state.verified.semantics.length }));
  }
  function renderArea() {
    const a = state.verified.areas[state.area];
    const t = a.totals;
    $("area-title").textContent = a.label;
    const ds = state.area === "milan" ? state.verified.provenance.datasets.milanCompact : state.verified.provenance.datasets.roccellaPilot;
    $("area-desc").textContent = `Manifest: ${ds.description ?? ""} · ${a.segments.toLocaleString("it-IT")} segmenti · versione ${ds.datasetVersion ?? "?"}`;
    $("caveats").replaceChildren(...a.coverage.caveats.filter((c) => c.severity === "warning").map((c) => el("div", { class: "caveat", role: "note", "data-caveat": c.id }, [el("strong", { text: `Attenzione: ${c.title}` }), c.text])));
    const p = state.verified.provenance;
    const okChecks = p.checks.filter((c) => c.status === "ok").length;
    const areaArchives = p.archives.filter((x) => x.area === state.area);
    $("prov-summary").replaceChildren("Provenienza: ", el("strong", { text: `${okChecks}/${p.checks.length} checksum dichiarati corrispondono` }), ` · ${areaArchives.length} archivi OSM per quest'area, ${areaArchives.filter((x) => x.status === "ok").length} verificati · tile runtime identiche ${p.runtimeChunks.find((c) => c.area === state.area)?.identicalTiles ?? "?"}/${a.coverage.runtimeTiles} · dettagli nel pannello «Provenienza e checksum».`);
    const kpi = (label, value, key) => el("div", { class: "kpi" }, [el("div", { class: "v", text: value }), el("div", { class: "l" }, [key ? el("span", { class: `key ${key}` }) : null, label])]);
    $("kpis").replaceChildren(
      kpi("km rete totale", km(t.total)), kpi("superficie nota", pct(t.knownShare)),
      ...CATS.map((c) => kpi(`km ${state.verified.semantics.categories[c].short}`, km(t[c]), c)),
      kpi("nota, rete principale", pct(a.mainNetwork.knownShare)),
    );
    const bar = el("div", { class: "partition", role: "img", "aria-label": "Ripartizione della lunghezza per categoria" });
    for (const c of CATS) {
      if (t[c] <= 0) continue;
      const s = el("span", { title: `${state.verified.semantics.categories[c].label}: ${km(t[c])} km` });
      s.style.flex = `${t[c]} 1 0`; s.style.background = COLORS[c];
      bar.append(s);
    }
    const labels = el("div", { class: "partition-labels" }, CATS.map((c) => el("span", {}, [el("span", { class: `key ${c}` }), ` ${state.verified.semantics.categories[c].label} ${pct(t[c] / t.total)}`])));
    $("partition").replaceWith(Object.assign(el("div", { id: "partition" }, [bar, labels])));

    const sum = CATS.reduce((s, c) => s + t[c], 0);
    const evidence = state.verified.semantics.evidenceLevels;
    $("table-category").replaceChildren(table(["Categoria", "Evidenza", "km", "%", "Definizione"], [
      ...CATS.map((c) => [el("span", {}, [el("span", { class: `key ${c}` }), ` ${state.verified.semantics.categories[c].label}`]), el("span", { class: "ev", text: evidence[state.verified.semantics.categories[c].evidence] }), km(t[c]), pct(t[c] / t.total), state.verified.semantics.categories[c].definition]),
      [el("strong", { text: "Somma categorie / totale" }), "", km(sum), pct(sum / t.total), `Partizione completa: differenza ${nf1.format(sum - t.total)} m. Sconosciuto con valore generico (paved/other): ${km(a.unknownBreakdown.generic_value)} km.`],
    ], [2, 3]));
    renderCoverage(a);
    renderSummary(a);

    $("hotspot-formula").textContent = `${state.verified.hotspotDefinition.formula} ${state.verified.hotspotDefinition.classWeightMeaning}`;
    const hrows = a.hotspots.list.map((h) => {
      const btn = el("button", { type: "button", text: "Mostra", "aria-label": `Mostra hotspot ${h.rank} sulla mappa`, onclick: () => focusHotspot(h) });
      const tr = el("tr", { class: `hot-row${state.selectedHotspot === h.rank ? " selected" : ""}` }, [
        el("td", { class: "n", text: String(h.rank) }),
        el("td", {}, [`${h.center.lat.toFixed(5)}, ${h.center.lon.toFixed(5)}`, el("br"), btn]),
        el("td", { class: "n" }, [nf0.format(h.score), el("br"), pct(h.shareOfAreaScore)]),
        el("td", {}, [el("ul", {}, h.reasons.map((r) => el("li", { text: r }))), h.topUnknownStreets.length ? el("div", { class: "note", text: `Strade: ${h.topUnknownStreets.map((s) => s.name).join(", ")}` }) : null]),
      ]);
      return tr;
    });
    const ht = el("table", {}, [el("thead", {}, el("tr", {}, ["#", "Centro (lat, lon)", "H · quota", "Perché"].map((h, i) => el("th", { class: i === 0 || i === 2 ? "n" : null, text: h })))), el("tbody", {}, hrows)]);
    $("table-hotspots").replaceChildren(el("p", { class: "note", text: `${a.hotspots.cellsWithScore} celle con H > 0 · H totale area ${nf0.format(a.hotspots.totalScore)} · prime ${a.hotspots.list.length}.` }), el("div", { class: "table-scroll" }, ht));

    const maxUnknown = Math.max(...a.byClass.map((r) => r.unknown));
    $("table-class").replaceChildren(table(["Classe", "km", "% nota", "km sconosc.", "sconosc. percorribile", "", "peso H"], a.byClass.map((r) => {
      const bar = el("div", { class: "bar" }); bar.style.width = `${Math.round(100 * r.unknown / (maxUnknown || 1))}%`;
      return [r.highwayClass, km(r.total), pct(r.knownShare), km(r.unknown), km(r.unknownRoutable), bar, nf1.format(r.routingWeight)];
    }), [1, 2, 3, 4, 6]));

    $("table-source").replaceChildren(table(["Fonte", "segmenti", "km", "% nota", "% nota rete princ.", "km sconosc."], a.bySource.map((r) => [r.label, nf0.format(r.segments), km(r.total), pct(r.knownShare), pct(r.mainNetwork.knownShare), km(r.unknown)]), [1, 2, 3, 4, 5]));
    const modeLabels = { car: "Accessibile in auto", bicycle: "Accessibile in bici", any_mode: "Almeno una modalità", no_mode: "Nessuna modalità (es. marciapiedi)" };
    $("table-mode").replaceChildren(table(["Sottorete", "km", "% nota", "km pavé verif.", "km sconosc."], [
      ...Object.entries(a.byMode).map(([k, v]) => [modeLabels[k] ?? k, km(v.total), pct(v.knownShare), km(v.confirmed_rough), km(v.unknown)]),
      ["Rete principale (motorway…living_street)", km(a.mainNetwork.total), pct(a.mainNetwork.knownShare), km(a.mainNetwork.confirmed_rough), km(a.mainNetwork.unknown)],
    ], [1, 2, 3, 4]));
    $("source-note").textContent = state.area === "milan" ? state.verified.provenance.datasets.milanCompact.compileFilterNote : "Unico archivio: le quattro risposte API del pilota Roccella.";

    const tiles = a.byTile.slice().sort((p, q) => q.unknown - p.unknown);
    $("table-tile").replaceChildren(table(["Tile", "km", "% nota", "km pavé verif.", "km probabile", "km sconosc."], tiles.map((r) => [r.tile, km(r.total), pct(r.knownShare), km(r.confirmed_rough), km(r.probable_rough), km(r.unknown)]), [1, 2, 3, 4, 5]));
    state.cellIndex = new Map(a.grid.rows.map((r) => [`${r[0]}:${r[1]}`, r]));
    state.tileIndex = new Map(a.byTile.map((r) => [r.tile, r]));
    if (state.layers.experimental && state.exp) renderExperimentalPanel();
  }
  function renderCoverage(a) {
    const c = a.coverage;
    const bandRows = (bands) => bands.map((b) => [b.label, nf0.format(b.units), km(b.meters), km(b.unknownMeters), pct(a.totals.total > 0 ? b.meters / a.totals.total : null)]);
    const info = c.caveats.filter((x) => x.severity !== "warning");
    $("coverage").replaceChildren(
      el("p", {}, [
        el("strong", { text: `${c.runtimeTiles} tile runtime di produzione (0,01°)` }),
        ` · ${c.tilesWithLength} con lunghezza stradale · ${nf0.format(c.cells)} celle da ${c.cellSizeMeters} m · estensione ${nf1.format(c.extentKm.eastWest)} × ${nf1.format(c.extentKm.northSouth)} km (bbox ${a.datasetBounds.west}, ${a.datasetBounds.south} – ${a.datasetBounds.east}, ${a.datasetBounds.north}).`,
      ]),
      el("h3", { text: "Tile per quota di lunghezza nota" }),
      table(["Fascia", "tile", "km", "km sconosc.", "% della rete"], bandRows(c.tileBands), [1, 2, 3, 4]),
      el("h3", { text: "Celle 250 m per quota di lunghezza nota" }),
      table(["Fascia", "celle", "km", "km sconosc.", "% della rete"], bandRows(c.cellBands), [1, 2, 3, 4]),
      el("p", { class: "note", text: "Accendi «Tile 0,01°» o «Celle 250 m» nei livelli per vedere la copertura sulla mappa." }),
      ...c.caveats.filter((x) => x.severity === "warning").map((x) => el("div", { class: "caveat", role: "note" }, [el("strong", { text: x.title }), x.text])),
      ...info.map((x) => el("div", { class: "caveat info", role: "note" }, [el("strong", { text: x.title }), x.text])),
    );
  }
  function renderSummary(a) {
    $("summary").replaceChildren(
      el("p", { class: "note", text: `Sintesi di ricerca per ${a.label}, generata dai numeri qui sopra (solo tag OSM).` }),
      el("ul", { class: "findings" }, a.summary.findings.map((f) => el("li", { text: f }))),
    );
    const sizes = new Map((state.manifest?.files ?? []).map((f) => [f.file, f.bytes]));
    document.querySelectorAll("#exports a").forEach((link) => {
      const bytes = sizes.get(link.getAttribute("href"));
      link.title = bytes ? `${nf1.format(bytes / 1024)} kB` : "";
    });
  }
  function renderMethod() {
    const d = state.verified.hotspotDefinition;
    const weights = Object.entries(d.classWeights).sort((p, q) => (q[1] - p[1]) || (p[0] < q[0] ? -1 : 1));
    $("hotspot-method-body").replaceChildren(
      el("ol", {}, d.steps.map((s) => el("li", { text: s }))),
      el("p", { class: "note", text: `Parametri: saturazione adiacenza ${d.params.adjacencySaturationMeters} m, fattore pavé probabile ${nf1.format(d.params.probableFactor)}, vicinato ${d.params.neighbourhood}.` }),
      table(["Classe stradale", "Peso (scelto a mano)"], weights.map(([k, v]) => [k, nf1.format(v)]), [1]),
      el("p", { class: "note" }, [el("strong", { text: "Limiti: " }), d.limitations, " ", d.classWeightMeaning]),
    );
  }
  function renderProvenance() {
    const p = state.verified.provenance;
    const counts = Object.entries(p.checkCounts).map(([k, v]) => `${k}: ${v}`).join(" · ");
    const allOk = Object.keys(p.checkCounts).every((k) => k === "ok");
    const archives = table(["Archivio", "Acquisito", "SHA-256 (decompresso)", "Stato"], p.archives.map((a) => [
      el("span", {}, [a.file, el("br"), el("span", { class: "note", text: a.description ?? (a.bbox ? `bbox ${a.bbox.join(", ")}` : "") })]),
      a.retrievedAt ?? "—", el("span", { class: "hash", text: (a.rawSha256 ?? "").slice(0, 16) + "…" }),
      el("span", { class: a.status === "ok" ? "ok" : "bad", text: a.status === "ok" ? "verificato" : a.status }),
    ]), []);
    const checks = table(["Gruppo", "File", "Campo", "Stato"], p.checks.filter((c) => c.group !== "raw-archive").map((c) => [c.group, c.file, c.field, el("span", { class: c.status === "ok" ? "ok" : "bad", text: c.status })]));
    const chunks = table(["Area", "Tile runtime identiche", "Metadati coerenti", "Stato"], p.runtimeChunks.map((c) => [c.area, `${c.identicalTiles}/${c.tilesInCompact}`, c.metadataConsistent ? "sì" : "no", el("span", { class: c.status === "ok" ? "ok" : "bad", text: c.status })]), [1]);
    const rec = [];
    const r = p.reconciliation;
    const recRow = (label, x) => [label, x.withinOneMetrePerCategory ? el("span", { class: "ok", text: "entro 1 m per categoria" }) : el("span", { class: "bad", text: "scostamento" }), x.rows.map((row) => `${row.category} ${row.diffMeters === null ? "n/d" : nf1.format(row.diffMeters)} m`).join(" · ")];
    rec.push(recRow("Milano: calcolato vs manifest compact", r.milan.vsCompactManifest));
    rec.push(recRow("Milano: sottoinsieme pilota vs manifest milan-central", r.milan.pilotSubset.vsMilanCentralManifest));
    rec.push(recRow("Roccella: calcolato vs manifest", r.roccella.vsDatasetManifest));
    $("provenance").replaceChildren(
      el("p", {}, [el("span", { class: `badge ${allOk ? "ok" : "bad"}`, text: allOk ? "tutti i checksum dichiarati corrispondono" : "ci sono scostamenti" }), ` ${counts}`]),
      el("p", { class: "note", text: `Licenza: ${p.licence.name}, ${p.licence.attribution}. Le date sono tempi di acquisizione delle risposte (non snapshot atomici né date di rilievo).` }),
      archives, el("h3", { text: "Dataset derivati e compatti" }), checks, el("h3", { text: "Tile runtime vs compact" }), chunks,
      el("h3", { text: "Riconciliazione dei totali" }), table(["Confronto", "Esito", "Differenze"], rec),
    );
    const total = state.manifest ? state.manifest.totalBytes : 0;
    $("fingerprint").textContent = state.manifest ? `Build: ${state.manifest.files.length} file, ${nf2.format(total / 1048576)} MB · verified.json ${state.manifest.files.find((f) => f.file === "data/verified.json")?.sha256.slice(0, 12)}` : "";
  }
  function renderResearch() {
    const r = state.research;
    if (!r || !r.available) { $("research").textContent = "Risultati della Fase 4.17 non disponibili."; return; }
    const rows = r.outOfSampleWayWeighted.map((m) => [m.model, nf2.format(m.precision), nf2.format(m.recall), nf2.format(m.f1), m.averagePrecision === null ? "—" : nf2.format(m.averagePrecision), nf2.format(m.brier ?? 0)]);
    const sens = r.calibrationThresholdSensitivity.map((m) => [m.model, nf2.format(m.precision), nf2.format(m.recall), nf2.format(m.f1)]);
    $("research").replaceChildren(
      el("p", { class: "note", text: `Risultato di ricerca esterno a questa dashboard (file ${r.file}, SHA-256 ${r.sha256.slice(0, 12)}…). Raccomandazione: ${r.recommendation}` }),
      el("h3", { text: "Fuori campione geografico, soglia 0,5 (pesato per way)" }),
      table(["Modello", "Precisione", "Recall", "F1", "AP", "Brier"], rows, [1, 2, 3, 4, 5]),
      el("h3", { text: "Sensibilità: soglia scelta in calibrazione" }),
      table(["Modello", "Precisione", "Recall", "F1"], sens, [1, 2, 3]),
      el("p", { class: "note", text: `Roccella: ${r.roccellaExternal?.n ?? "?"} etichette valutabili, ${r.roccellaExternal?.positives ?? "?"} positivi pavé (recall/F1 non stimabili). Previsioni su way sconosciute: ${r.unknownPredictions?.ways ?? "?"} way, verità non disponibile, nessuna con p alta.` }),
      el("ul", {}, r.limitations.map((l) => el("li", { text: l }))),
    );
  }
  function renderExperimentalPanel() {
    if (!state.exp) return;
    const e = state.exp.areas[state.area].stats;
    const raw = state.exp.raw;
    const verifiedUnknown = state.verified.areas[state.area].totals.unknown;
    $("exp-stats").replaceChildren(
      el("p", { class: "note", text: raw.disclaimer }),
      table(["Indicatore (sperimentale)", "Valore"], [
        ["Way con previsione nel file 4.17", nf0.format(e.ways)],
        ["… presenti nei dati runtime", nf0.format(e.matchedWays)],
        ["… assenti dai dati runtime (fuori tile o filtrate)", nf0.format(e.unmatchedWays)],
        ["Metri sconosciuti coperti da previsione", `${km(e.predictedUnknownMeters)} km (su ${km(verifiedUnknown)} km di lunghezza sconosciuta nei dati verificati; i totali non cambiano)`],
        ["Segmenti noti incontrati e ignorati", nf0.format(e.knownSegmentsSkipped)],
        ["p media / massima", `${nf2.format(e.meanP ?? 0)} / ${nf2.format(e.maxP)}`],
        ["Way con p ≥ 0,5", nf0.format(e.waysWithPAtLeast05)],
        ["Way fuori distribuzione di training (città diversa)", nf0.format(e.outOfDistributionWays)],
      ], [1]),
      el("h3", { text: "Distribuzione di p (metri sconosciuti)" }),
      table(["Intervallo p", "way", "km"], e.pBins.map((b) => [`${nf1.format(b.from)}–${nf1.format(b.to)}`, nf0.format(b.ways), km(b.meters)]), [1, 2]),
      el("p", { class: "note", text: `Fonte: ${raw.source.file} (SHA-256 ${raw.source.sha256.slice(0, 12)}…), Fase ${raw.source.phase}, verdetto ${raw.source.verdict}.` }),
    );
  }
  function focusHotspot(h) {
    const a = state.verified.areas[state.area];
    const size = a.grid.cellSizeMeters;
    state.selectedHotspot = h.rank;
    state.autoFit = false;
    $("tooltip").hidden = true;
    state.view.cx = (h.cell.ix + 0.5) * size; state.view.cy = (h.cell.iy + 0.5) * size;
    state.view.scale = Math.min(state.w, state.h) / (size * 6);
    document.querySelectorAll(".hot-row").forEach((r, i) => r.classList.toggle("selected", a.hotspots.list[i]?.rank === h.rank));
    requestDraw();
    canvas.focus({ preventScroll: true });
  }
  async function switchArea(area) {
    state.area = area;
    state.selectedHotspot = null;
    document.querySelectorAll(".area-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.area === area)));
    $("loading").hidden = false;
    await loadGeometry(area);
    $("loading").hidden = true;
    state.view = null;
    renderArea();
    fitArea();
  }

  // ---------- interaction ----------
  let drag = null;
  canvas.addEventListener("pointerdown", (ev) => { state.autoFit = false; drag = { x: ev.clientX, y: ev.clientY, cx: state.view.cx, cy: state.view.cy }; canvas.setPointerCapture(ev.pointerId); canvas.classList.add("dragging"); $("tooltip").hidden = true; });
  canvas.addEventListener("pointermove", (ev) => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      state.view.cx = drag.cx - (ev.clientX - drag.x) / state.view.scale;
      state.view.cy = drag.cy + (ev.clientY - drag.y) / state.view.scale;
      requestDraw();
    } else if (state.verified) showTooltip(ev.clientX - r.left, ev.clientY - r.top);
  });
  const endDrag = () => { drag = null; canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { $("tooltip").hidden = true; });
  canvas.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
  canvas.addEventListener("keydown", (ev) => {
    const step = 80 / state.view.scale;
    if (ev.key === "+" || ev.key === "=") zoomAt(1.4);
    else if (ev.key === "-") zoomAt(1 / 1.4);
    else if (ev.key === "ArrowLeft") state.view.cx -= step;
    else if (ev.key === "ArrowRight") state.view.cx += step;
    else if (ev.key === "ArrowUp") state.view.cy += step;
    else if (ev.key === "ArrowDown") state.view.cy -= step;
    else if (ev.key === "0") fitArea();
    else return;
    if (ev.key !== "0") state.autoFit = false;
    ev.preventDefault();
    requestDraw();
  });
  $("zoom-in").addEventListener("click", () => zoomAt(1.5));
  $("zoom-out").addEventListener("click", () => zoomAt(1 / 1.5));
  $("zoom-reset").addEventListener("click", () => fitArea());
  $("cell-metric").addEventListener("change", (ev) => { state.cellMetric = ev.target.value; renderLayers(); requestDraw(); });
  document.querySelectorAll(".area-switch button").forEach((b) => b.addEventListener("click", () => switchArea(b.dataset.area)));
  new ResizeObserver(() => resize()).observe(canvas);

  // ---------- boot ----------
  (async () => {
    try {
      const [verified, research, manifest] = await Promise.all([getJson("data/verified.json"), getJson("data/research-phase417.json"), getJson("data/manifest.json")]);
      state.verified = verified; state.research = research; state.manifest = manifest;
      renderLayers(); renderLegend(); renderProvenance(); renderResearch(); renderMethod();
      await loadGeometry(state.area);
      $("loading").hidden = true;
      renderArea();
      resize();
      fitArea();
      draw();
      document.body.dataset.ready = "1";
      document.body.dataset.loadMs = String(Math.round(performance.now()));
    } catch (err) {
      $("loading").textContent = `Errore nel caricamento dei dati locali: ${err.message}`;
      document.body.dataset.ready = "error";
    }
  })();
})();
