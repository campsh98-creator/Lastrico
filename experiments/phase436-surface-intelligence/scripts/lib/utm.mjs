/** Node-only Transverse Mercator (UTM zone 32N, GRS80/WGS84 ellipsoid; EPSG:7791 RDN2008/UTM32N, EPSG:32632 share these parameters) — Krueger series. */
const a = 6378137, f = 1 / 298.257222101; // GRS80 (WGS84 differs by < 0.1 mm in the ellipsoid)
const n = f / (2 - f), k0 = 0.9996, E0 = 500000, N0 = 0, lon0 = (9 * Math.PI) / 180;
const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
const alpha = [n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
const beta = [n / 2 - (2 / 3) * n ** 2 + (37 / 96) * n ** 3, n ** 2 / 48 + n ** 3 / 15, (17 / 480) * n ** 3];
const e = Math.sqrt(f * (2 - f));
export function toUtm32(lon, lat) {
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180 - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let X = eta, Y = xi;
  for (let j = 1; j <= 3; j += 1) { X += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); Y += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return [E0 + k0 * A * X, N0 + k0 * A * Y];
}
export function fromUtm32(E, N) {
  const xi = (N - N0) / (k0 * A), eta = (E - E0) / (k0 * A);
  let xi2 = xi, eta2 = eta;
  for (let j = 1; j <= 3; j += 1) { xi2 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta2 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
  let phi = chi;
  for (let it = 0; it < 6; it += 1) phi = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + e * Math.atanh(e * Math.sin(phi))));
  const lam = Math.atan2(Math.sinh(eta2), Math.cos(xi2));
  return [((lon0 + lam) * 180) / Math.PI, (phi * 180) / Math.PI];
}
