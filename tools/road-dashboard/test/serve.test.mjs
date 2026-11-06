// Local server: 127.0.0.1 only, serves only dist/, strict headers, no traversal.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { CSP, HOST, resolveRequestPath, startServer } from "../serve.mjs";
import { TOOL_DIR } from "../build.mjs";

const ROOT = join(TOOL_DIR, ".test-serve");
let server; let port;

function get(path, method = "GET") {
  return new Promise((resolve, reject) => {
    // Raw path on purpose: fetch() would normalise "../" before sending.
    const req = request({ host: HOST, port, path, method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "dist", "data"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(ROOT, "dist", "data", "x.json"), "{}");
  mkdirSync(join(ROOT, "dist", "exports"), { recursive: true });
  writeFileSync(join(ROOT, "dist", "exports", "x.csv"), "a,b\r\n1,2\r\n");
  writeFileSync(join(ROOT, "secret.txt"), "outside dist");
  server = await startServer({ port: 0, root: join(ROOT, "dist") });
  port = server.address().port;
});
after(() => { server?.close(); rmSync(ROOT, { recursive: true, force: true }); });

test("binds to loopback only", () => {
  assert.equal(server.address().address, "127.0.0.1");
});

test("serves dist files with strict CSP and security headers", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-security-policy"], CSP);
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /connect-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  const j = await get("/data/x.json");
  assert.equal(j.status, 200);
  assert.match(j.headers["content-type"], /application\/json/);
});

test("rejects traversal, unknown types and non-GET methods", async () => {
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/data/../../secret.txt", "/..%2fsecret.txt"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /outside dist/);
  }
  assert.equal(resolveRequestPath(join(ROOT, "dist"), "/../secret.txt"), join(ROOT, "dist", "secret.txt"));
  assert.equal((await get("/missing.json")).status, 404);
  assert.equal((await get("/", "POST")).status, 405);
  assert.equal((await get("/", "HEAD")).status, 200);
});

test("serves research exports as CSV downloads with the same strict headers", async () => {
  const r = await get("/exports/x.csv");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /^text\/csv/);
  assert.equal(r.headers["content-disposition"], 'attachment; filename="x.csv"');
  assert.equal(r.headers["content-security-policy"], CSP);
  assert.equal(r.body, "a,b\r\n1,2\r\n");
  const page = await get("/");
  assert.equal(page.headers["content-disposition"], undefined, "pages are not forced to download");
});
