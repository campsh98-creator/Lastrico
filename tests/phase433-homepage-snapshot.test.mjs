import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homepageSnapshotProblems } from "../scripts/homepage-snapshot.mjs";

/** Phase 4.33: `/` is served as a static snapshot of the server render, so the Worker does not run for it. */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const page = (asset = "/assets/page-abc.js") => [
  '<!DOCTYPE html><html lang="it"><head>',
  `<link rel="modulepreload" href="${asset}" crossorigin=""/>`,
  '</head><body><main class="app-shell" data-testid="app-shell"></main>',
  "<script>self.__VINEXT_RSC_CHUNKS__=[]</script><script>self.__VINEXT_RSC_DONE__=true</script></body></html>",
].join("");
const answer = (body, status = 200, contentType = "text/html; charset=utf-8") => ({ status, contentType, body });

test("a deterministic render whose assets are in the build can be served as a static file", () => {
  const client = mkdtempSync(join(tmpdir(), "lastrico-client-"));
  try {
    mkdirSync(join(client, "assets"));
    writeFileSync(join(client, "assets", "page-abc.js"), "");
    assert.deepEqual(homepageSnapshotProblems(answer(page()), answer(page()), client), []);

    assert.match(homepageSnapshotProblems(answer(page()), answer(page().replace("app-shell\"", "app-shell\" data-at=\"1\"")), client).join(), /two renders differ/);
    assert.match(homepageSnapshotProblems(answer(page("/assets/gone.js")), answer(page("/assets/gone.js")), client).join(), /gone\.js is not in the build/);
    assert.match(homepageSnapshotProblems(answer(page(), 500), answer(page()), client).join(), /HTTP 500/);
    assert.match(homepageSnapshotProblems(answer(page(), 200, "application/json"), answer(page()), client).join(), /not HTML/);
    const noPayload = page().replace(/<script>self\.__VINEXT_RSC_CHUNKS__.*<\/script>/, "");
    assert.match(homepageSnapshotProblems(answer(noPayload), answer(noPayload), client).join(), /inline RSC payload is missing/);
  } finally {
    rmSync(client, { recursive: true, force: true });
  }
});

test("the homepage render has no per-request input, so one snapshot is right for every visitor", async () => {
  const [page, layout] = await Promise.all([read("app/page.tsx"), read("app/layout.tsx")]);
  for (const [name, source] of [["page", page], ["layout", layout]]) {
    assert.doesNotMatch(source, /from "next\/headers"|\bcookies\(\)|\bheaders\(\)|searchParams\s*[:}]|export const (dynamic|revalidate)\b/, name);
  }
  assert.match(page, /^"use client";/, "rendered in the browser after hydration");
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\("area"\)/, "the area link is read in the browser");
});

test("the snapshot is served for / by the asset layer, before the Worker", async () => {
  const [snapshot, gitignore] = await Promise.all([read("scripts/homepage-snapshot.mjs"), read(".gitignore")]);
  assert.match(snapshot, /HOMEPAGE_SNAPSHOT = join\("client", "index\.html"\)/);
  assert.match(snapshot, /rmSync\(snapshotPath, \{ force: true \}\)/, "an older snapshot never answers the render");
  assert.match(gitignore, /^\/?dist\/?$/m, "the snapshot is a build output, never committed");
});
