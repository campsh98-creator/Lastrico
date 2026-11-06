#!/usr/bin/env node
// Local static server for the Road Intelligence Dashboard (internal developer tool). Binds to 127.0.0.1 only
// and serves ONLY tools/road-dashboard/dist/. GET/HEAD only, no directory listing, no path traversal, strict CSP.
// It is never deployed: nothing in app/, lib/, components/, worker/ or public/ references this folder.
//
//   node tools/road-dashboard/serve.mjs            → http://127.0.0.1:8810/
//   PORT=0 node tools/road-dashboard/serve.mjs      (random free port, printed on start)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 8810;
export const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
  "font-src 'none'", "object-src 'none'", "media-src 'none'", "frame-src 'none'", "worker-src 'none'",
  "manifest-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

export function resolveRequestPath(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]); } catch { return null; }
  if (p.includes("\0")) return null;
  if (p.endsWith("/")) p += "index.html";
  const full = resolve(root, `.${normalize(`/${p}`)}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function createDashboardServer(root = DIST) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    const headers = {
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...headers, Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const file = resolveRequestPath(base, req.url ?? "/");
    const type = file ? TYPES[extname(file)] : undefined;
    try {
      if (!file || !type) throw new Error("not served");
      const st = await stat(file);
      if (!st.isFile()) throw new Error("not a file");
      const body = await readFile(file);
      const download = /[/\\]exports[/\\][^/\\]+\.(csv|json)$/.test(file) ? { "Content-Disposition": `attachment; filename="${basename(file)}"` } : {};
      res.writeHead(200, { ...headers, ...download, "Content-Type": type, "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
}

export function startServer({ port = DEFAULT_PORT, root = DIST } = {}) {
  const server = createDashboardServer(root);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolvePromise(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT);
  const server = await startServer({ port });
  const { port: actual } = server.address();
  console.log(`Road Intelligence Dashboard: http://${HOST}:${actual}/ (serving ${DIST}; Ctrl+C to stop)`);
}
