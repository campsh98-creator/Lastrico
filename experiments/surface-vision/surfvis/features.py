"""Cheap, deterministic texture and colour features (numpy only).

Feature families (computed per region: ``full`` focal crop and ``near`` = its
bottom half, which is closest to the camera and shows the largest texture scale):

* GLCM (grey-level co-occurrence) contrast / homogeneity / energy / correlation /
  entropy, averaged over 4 directions, plus contrast anisotropy, at 2 distances.
* Uniform LBP-like histograms (8 neighbours, radius 1 and 2; 10 bins each).
* Gradient statistics (Sobel magnitude moments, edge density at 3 thresholds),
  magnitude-weighted orientation histogram (8 bins), orientation entropy,
  structure-tensor coherence and an orthogonal "grid" score.
* FFT periodicity: radial band energy shares, mid-band peak-to-median ratio,
  angular concentration and orthogonal angular pair score.
* Multi-scale difference-of-box energies.
* Colour statistics (RGB / HSV moments, saturation-weighted hue, colourfulness,
  chromaticity) — also used alone by the colour-only baseline.

All functions are pure and deterministic. Synthetic tests check shapes,
determinism and formula correctness only; they say nothing about real accuracy.
"""

from __future__ import annotations

import numpy as np

GLCM_LEVELS = 16
GLCM_DISTANCES = (1, 3)
GLCM_ANGLES = ((0, 1), (-1, 1), (-1, 0), (-1, -1))  # 0°, 45°, 90°, 135° (dy, dx)
LBP_RADII = (1, 2)
EDGE_THRESHOLDS = (0.25, 0.5, 1.0)
ORIENT_BINS = 8
FFT_BAND_EDGES = (0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.5)
FFT_MID_BAND = (0.03, 0.25)
FFT_SECTORS = 12
DOB_SIZES = ((1, 3), (3, 7), (7, 15))
EPS = 1e-12


# --------------------------------------------------------------------------- utils

def to_grey(rgb: np.ndarray) -> np.ndarray:
    """ITU-R BT.601 luma in [0, 1]."""
    x = rgb.astype(np.float64) / 255.0
    return 0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2]


def standardise(g: np.ndarray) -> np.ndarray:
    s = g.std()
    if s < 1e-6:
        return np.zeros_like(g)
    return (g - g.mean()) / s


def quantise_equal_population(g: np.ndarray, levels: int = GLCM_LEVELS) -> np.ndarray:
    """Per-image quantile quantisation -> ints in [0, levels). Exposure-robust."""
    if g.max() - g.min() < 1e-9:
        return np.zeros(g.shape, dtype=np.int64)
    edges = np.quantile(g, np.linspace(0, 1, levels + 1)[1:-1])
    return np.searchsorted(edges, g, side="right").astype(np.int64)


def _pairs(a: np.ndarray, dy: int, dx: int):
    """Return aligned views (a[r, c], a[r+dy, c+dx]) over all valid positions."""
    h, w = a.shape
    r0, r1 = max(0, -dy), h - max(0, dy)
    c0, c1 = max(0, -dx), w - max(0, dx)
    return a[r0:r1, c0:c1], a[r0 + dy:r1 + dy, c0 + dx:c1 + dx]


def box_blur(g: np.ndarray, size: int) -> np.ndarray:
    """Mean filter with odd ``size`` and edge replication (integral image)."""
    if size <= 1:
        return g.astype(np.float64, copy=True)
    r = size // 2
    p = np.pad(g.astype(np.float64), r, mode="edge")
    c = np.cumsum(np.cumsum(p, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    h, w = g.shape
    s = c[size:size + h, size:size + w] - c[0:h, size:size + w] - c[size:size + h, 0:w] + c[0:h, 0:w]
    return s / float(size * size)


# --------------------------------------------------------------------------- GLCM

def glcm_counts(q: np.ndarray, dy: int, dx: int, levels: int) -> np.ndarray:
    """Non-symmetric co-occurrence counts P[i, j] = #(q[r,c]=i and q[r+dy,c+dx]=j)."""
    a, b = _pairs(q, dy, dx)
    idx = a.ravel() * levels + b.ravel()
    return np.bincount(idx, minlength=levels * levels).reshape(levels, levels).astype(np.float64)


def glcm_props(counts: np.ndarray) -> dict:
    """Haralick-style properties of a *symmetrised, normalised* GLCM."""
    p = counts + counts.T
    total = p.sum()
    if total <= 0:
        return dict(contrast=0.0, homogeneity=0.0, energy=0.0, correlation=0.0, entropy=0.0)
    p = p / total
    n = p.shape[0]
    i, j = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    contrast = float(np.sum(p * (i - j) ** 2))
    homogeneity = float(np.sum(p / (1.0 + (i - j) ** 2)))
    energy = float(np.sqrt(np.sum(p ** 2)))
    mu = float(np.sum(i * p))
    var = float(np.sum(p * (i - mu) ** 2))
    correlation = 0.0 if var < 1e-12 else float(np.sum(p * (i - mu) * (j - mu)) / var)
    nz = p[p > 0]
    entropy = float(-np.sum(nz * np.log2(nz)))
    return dict(contrast=contrast, homogeneity=homogeneity, energy=energy,
                correlation=correlation, entropy=entropy)


def glcm_features(g: np.ndarray):
    q = quantise_equal_population(g, GLCM_LEVELS)
    vals, names = [], []
    for d in GLCM_DISTANCES:
        per_angle = [glcm_props(glcm_counts(q, dy * d, dx * d, GLCM_LEVELS)) for dy, dx in GLCM_ANGLES]
        for key in ("contrast", "homogeneity", "energy", "correlation", "entropy"):
            vals.append(float(np.mean([pa[key] for pa in per_angle])))
            names.append(f"glcm_d{d}_{key}")
        contrasts = [pa["contrast"] for pa in per_angle]
        vals.append(float((max(contrasts) - min(contrasts)) / (np.mean(contrasts) + EPS)))
        names.append(f"glcm_d{d}_contrast_anisotropy")
    return vals, names


# --------------------------------------------------------------------------- LBP

def _uniform_lut() -> np.ndarray:
    lut = np.empty(256, dtype=np.int64)
    for code in range(256):
        bits = [(code >> k) & 1 for k in range(8)]
        transitions = sum(bits[k] != bits[(k + 1) % 8] for k in range(8))
        lut[code] = sum(bits) if transitions <= 2 else 9
    return lut


UNIFORM_LUT = _uniform_lut()


def lbp_codes(g: np.ndarray, radius: int) -> np.ndarray:
    """8-neighbour LBP codes with integer-rounded circular offsets."""
    r = radius
    h, w = g.shape
    center = g[r:h - r, r:w - r]
    code = np.zeros(center.shape, dtype=np.int64)
    for k in range(8):
        ang = 2.0 * np.pi * k / 8.0
        dy = int(round(-r * np.sin(ang)))
        dx = int(round(r * np.cos(ang)))
        nb = g[r + dy:h - r + dy, r + dx:w - r + dx]
        code |= (nb >= center).astype(np.int64) << k
    return code


def lbp_histogram(g: np.ndarray, radius: int) -> np.ndarray:
    labels = UNIFORM_LUT[lbp_codes(g, radius)]
    hist = np.bincount(labels.ravel(), minlength=10).astype(np.float64)
    return hist / max(hist.sum(), 1.0)


def lbp_features(g: np.ndarray):
    vals, names = [], []
    for r in LBP_RADII:
        h = lbp_histogram(g, r)
        vals.extend(h.tolist())
        names.extend([f"lbp_r{r}_u{b}" for b in range(10)])
    return vals, names


# --------------------------------------------------------------------------- gradients

def sobel(g: np.ndarray):
    gx = ((g[:-2, 2:] + 2 * g[1:-1, 2:] + g[2:, 2:]) - (g[:-2, :-2] + 2 * g[1:-1, :-2] + g[2:, :-2])) / 8.0
    gy = ((g[2:, :-2] + 2 * g[2:, 1:-1] + g[2:, 2:]) - (g[:-2, :-2] + 2 * g[:-2, 1:-1] + g[:-2, 2:])) / 8.0
    return gx, gy


def orientation_histogram(gx: np.ndarray, gy: np.ndarray, bins: int = ORIENT_BINS) -> np.ndarray:
    mag = np.hypot(gx, gy)
    # bins are centred on 0°, 22.5°, ... so axis-aligned edges do not straddle a bin boundary
    theta = np.mod(np.arctan2(gy, gx) + np.pi / (2 * bins), np.pi)
    idx = np.minimum((theta / np.pi * bins).astype(np.int64), bins - 1)
    hist = np.bincount(idx.ravel(), weights=mag.ravel(), minlength=bins)
    s = hist.sum()
    return hist / s if s > EPS else np.full(bins, 1.0 / bins)


def gradient_features(g: np.ndarray):
    z = standardise(g)
    gx, gy = sobel(z)
    mag = np.hypot(gx, gy)
    vals = [float(mag.mean()), float(mag.std()), float(np.percentile(mag, 50)), float(np.percentile(mag, 90))]
    names = ["grad_mag_mean", "grad_mag_std", "grad_mag_p50", "grad_mag_p90"]
    for t in EDGE_THRESHOLDS:
        vals.append(float(np.mean(mag > t)))
        names.append(f"edge_density_t{t}")
    hist = orientation_histogram(gx, gy)
    vals.extend(hist.tolist())
    names.extend([f"orient_b{b}" for b in range(ORIENT_BINS)])
    nz = hist[hist > 0]
    vals.append(float(-np.sum(nz * np.log(nz)) / np.log(ORIENT_BINS)))
    names.append("orient_entropy")
    jxx, jyy, jxy = float(np.sum(gx * gx)), float(np.sum(gy * gy)), float(np.sum(gx * gy))
    tr = jxx + jyy
    disc = np.sqrt(max((jxx - jyy) ** 2 + 4 * jxy ** 2, 0.0))
    vals.append(float(disc / tr) if tr > EPS else 0.0)
    names.append("structure_coherence")
    half = ORIENT_BINS // 2
    vals.append(float(max(hist[k] + hist[(k + half) % ORIENT_BINS] for k in range(half))))
    names.append("orient_grid_score")
    return vals, names


# --------------------------------------------------------------------------- FFT

def power_spectrum(g: np.ndarray):
    z = standardise(g)
    h, w = z.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    spec = np.abs(np.fft.fftshift(np.fft.fft2(z * win))) ** 2
    fy = np.fft.fftshift(np.fft.fftfreq(h))
    fx = np.fft.fftshift(np.fft.fftfreq(w))
    fyy, fxx = np.meshgrid(fy, fx, indexing="ij")
    radius = np.hypot(fyy, fxx)
    angle = np.mod(np.arctan2(fyy, fxx), np.pi)
    return spec, radius, angle


def fft_features(g: np.ndarray):
    spec, radius, angle = power_spectrum(g)
    valid = (radius > 0) & (radius <= 0.5)
    total = float(spec[valid].sum())
    vals, names = [], []
    for lo, hi in zip(FFT_BAND_EDGES[:-1], FFT_BAND_EDGES[1:]):
        m = (radius > lo) & (radius <= hi)
        vals.append(float(spec[m].sum() / total) if total > EPS else 0.0)
        names.append(f"fft_band_{lo}_{hi}")
    mid = (radius > FFT_MID_BAND[0]) & (radius <= FFT_MID_BAND[1])
    mid_vals = spec[mid]
    if mid_vals.size and float(np.median(mid_vals)) > EPS:
        vals.append(float(np.log10(mid_vals.max() / np.median(mid_vals))))
    else:
        vals.append(0.0)
    names.append("fft_mid_peak_log_ratio")
    centred = np.mod(angle[mid] + np.pi / (2 * FFT_SECTORS), np.pi)  # sectors centred on 0°, 15°, ...
    sector_idx = np.minimum((centred / np.pi * FFT_SECTORS).astype(np.int64), FFT_SECTORS - 1)
    sectors = np.bincount(sector_idx, weights=mid_vals, minlength=FFT_SECTORS)
    ssum = sectors.sum()
    sectors = sectors / ssum if ssum > EPS else np.full(FFT_SECTORS, 1.0 / FFT_SECTORS)
    vals.append(float(sectors.max() * FFT_SECTORS))
    names.append("fft_angular_concentration")
    half = FFT_SECTORS // 2
    vals.append(float(max(sectors[k] + sectors[(k + half) % FFT_SECTORS] for k in range(half))))
    names.append("fft_orthogonal_pair")
    nz = sectors[sectors > 0]
    vals.append(float(-np.sum(nz * np.log(nz)) / np.log(FFT_SECTORS)))
    names.append("fft_angular_entropy")
    return vals, names


# --------------------------------------------------------------------------- multi-scale

def dob_features(g: np.ndarray):
    z = standardise(g)
    vals, names = [], []
    for a, b in DOB_SIZES:
        vals.append(float(np.mean(np.abs(box_blur(z, a) - box_blur(z, b)))))
        names.append(f"dob_{a}_{b}")
    return vals, names


# --------------------------------------------------------------------------- colour

def rgb_to_hsv(x: np.ndarray):
    """Vectorised RGB(0..1) -> H(0..1), S, V."""
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx = x.max(axis=-1)
    mn = x.min(axis=-1)
    d = mx - mn
    s = np.where(mx > EPS, d / np.maximum(mx, EPS), 0.0)
    nz = d > EPS
    rc = np.where(nz, (mx - r) / np.maximum(d, EPS), 0.0)
    gc = np.where(nz, (mx - g) / np.maximum(d, EPS), 0.0)
    bc = np.where(nz, (mx - b) / np.maximum(d, EPS), 0.0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(nz, np.mod(h / 6.0, 1.0), 0.0)
    return h, s, mx


def colour_features(rgb: np.ndarray):
    x = rgb.astype(np.float64) / 255.0
    vals, names = [], []
    for c, nm in enumerate("rgb"):
        vals.append(float(x[..., c].mean()))
        names.append(f"col_{nm}_mean")
    for c, nm in enumerate("rgb"):
        vals.append(float(x[..., c].std()))
        names.append(f"col_{nm}_std")
    h, s, v = rgb_to_hsv(x)
    vals += [float(s.mean()), float(s.std()), float(v.mean()), float(v.std())]
    names += ["col_s_mean", "col_s_std", "col_v_mean", "col_v_std"]
    wsum = float(s.sum())
    if wsum > EPS:
        vals += [float(np.sum(s * np.cos(2 * np.pi * h)) / wsum), float(np.sum(s * np.sin(2 * np.pi * h)) / wsum)]
    else:
        vals += [0.0, 0.0]
    names += ["col_hue_cos_w", "col_hue_sin_w"]
    rg = x[..., 0] - x[..., 1]
    yb = 0.5 * (x[..., 0] + x[..., 1]) - x[..., 2]
    colourfulness = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    vals.append(float(colourfulness))
    names.append("col_colourfulness")
    tot = x.sum(axis=-1) + EPS
    vals += [float((x[..., 0] / tot).mean()), float((x[..., 1] / tot).mean())]
    names += ["col_chroma_r", "col_chroma_g"]
    return vals, names


# --------------------------------------------------------------------------- assembly

def _regions(rgb: np.ndarray):
    h = rgb.shape[0]
    return (("full", rgb), ("near", rgb[h // 2:, :, :]))


def extract(rgb: np.ndarray):
    """Return ``(values float64[n], names list[str], colour_mask bool[n])``."""
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
        raise ValueError("expected HxWx3 uint8 RGB array")
    if rgb.shape[0] < 32 or rgb.shape[1] < 32:
        raise ValueError("image region too small for features")
    vals, names, is_colour = [], [], []
    for region, sub in _regions(rgb):
        g = to_grey(sub)
        for fn in (glcm_features, lbp_features, gradient_features, fft_features, dob_features):
            v, n = fn(g)
            vals += v
            names += [f"{region}_{x}" for x in n]
            is_colour += [False] * len(v)
        v, n = colour_features(sub)
        vals += v
        names += [f"{region}_{x}" for x in n]
        is_colour += [True] * len(v)
    out = np.asarray(vals, dtype=np.float64)
    if not np.all(np.isfinite(out)):
        bad = [names[i] for i in np.flatnonzero(~np.isfinite(out))]
        raise FloatingPointError(f"non-finite features: {bad}")
    return out, names, np.asarray(is_colour, dtype=bool)


def feature_names():
    dummy = np.zeros((64, 64, 3), dtype=np.uint8)
    dummy[::2, ::3] = 200
    _, names, mask = extract(dummy)
    return names, mask
