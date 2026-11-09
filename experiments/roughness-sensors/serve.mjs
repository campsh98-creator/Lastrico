/**
 * Local static server for the developer prototype. Binds to 127.0.0.1 only and serves exactly
 * two directories: prototype/ (at "/") and src/ (at "/src/"). GET/HEAD only.
 *
 *   node experiments/roughness-sensors/serve.mjs          # http://127.0.0.1:8820/
 *
 * A phone cannot reach this address, and iOS only grants motion sensors to HTTPS pages: testing
 * on a real device needs an HTTPS origin, which is deliberately not provided here.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOTS = [
  { prefix: "/src/", directory: path.join(here, "src") },
  { prefix: "/", directory: path.join(here, "prototype") },
];
export const DEFAULT_PORT = 8820;
export const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "accelerometer=(self), gyroscope=(self), geolocation=(self), magnetometer=(), camera=(), microphone=()",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** Maps a URL path to a file inside one of the allowed roots, or null. */
export function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  if (decoded === "/") decoded = "/index.html";
  for (const root of ROOTS) {
    if (!decoded.startsWith(root.prefix)) continue;
    const relative = decoded.slice(root.prefix.length);
    if (!relative || relative.split("/").some((part) => part === ".." || part.startsWith("."))) return null;
    const resolved = path.resolve(root.directory, relative);
    if (!resolved.startsWith(root.directory + path.sep)) return null;
    if (!TYPES[path.extname(resolved)]) return null;
    return resolved;
  }
  return null;
}

export function createServer() {
  return http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(405, "Method not allowed");
      return;
    }
    const file = resolvePath(request.url ?? "/");
    if (!file) {
      send(404, "Not found");
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      response.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[path.extname(file)], "Content-Length": info.size });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    } catch {
      send(404, "Not found");
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = createServer();
  server.listen(port, HOST, () => {
    const address = server.address();
    console.log(`Roughness prototype (developer only): http://${HOST}:${address.port}/  — Ctrl+C to stop`);
  });
}
