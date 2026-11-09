import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROME_SOURCE_PATTERN, ROUTES_HANDLER, ROUTES_HANDLER_ROME_BLOCKS, findRomeInBuild, removeRomeBlocksFromRoutesHandler,
} from "../scripts/milan-release.mjs";

/** Phase 4.33: the Milan and Roccella release leaves Rome out; the pilot deploy refuses a build with Rome. */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// On main, Rome is present and the release must be able to take it out; in the Milan and Roccella
// release copy (scripts/prepare-milan-release.mjs) it must already be gone.
const romeOnThisTree = existsSync(new URL("../lib/rome-road-store.ts", import.meta.url));

test("in the Milan and Roccella release copy the routes handler has no Rome-only block", { skip: romeOnThisTree }, async () => {
  const source = await read(ROUTES_HANDLER);
  for (const block of ROUTES_HANDLER_ROME_BLOCKS) assert.equal(source.split(block.find).length - 1, 0, block.name);
  assert.doesNotMatch(source, /area\.id === "rome"|Roma: /);
});

test("the routes handler's Rome-only blocks are found exactly once and come out cleanly", { skip: !romeOnThisTree }, async () => {
  const source = await read(ROUTES_HANDLER);
  for (const block of ROUTES_HANDLER_ROME_BLOCKS) assert.equal(source.split(block.find).length - 1, 1, block.name);
  const milan = removeRomeBlocksFromRoutesHandler(source);
  assert.doesNotMatch(milan, /area\.id === "rome"|Roma: /);
  assert.match(milan, /const selection = selectOptimizedRoute\(scored, fast, mode, avoidance, maximumExtraMinutes, policy,/);
  assert.match(milan, /zero pavé noto non significa fondo liscio",\n/);
  assert.throws(() => removeRomeBlocksFromRoutesHandler(milan), /found 0 times/, "a moved block is refused, not skipped");
});

test("the build check finds Rome's data modules and area id, and passes a Milan build", () => {
  const dist = mkdtempSync(join(tmpdir(), "lastrico-dist-"));
  try {
    mkdirSync(join(dist, "server", "assets"), { recursive: true });
    writeFileSync(join(dist, "server", "index.js"), 'const areas={milan:{id:"milan"},roccella:{id:"roccella"}};const tz="Europe/Rome";');
    writeFileSync(join(dist, "server", "assets", "917_4549-abc.js"), '{"name":"Vicolo 1 Roma"}');
    mkdirSync(join(dist, "client", "assets"), { recursive: true });
    writeFileSync(join(dist, "client", "index.html"), '<select><option value="milan">Milano</option></select>');
    writeFileSync(join(dist, "client", "assets", "page-a.js"), "const tz=`Europe/Rome`;");
    assert.deepEqual(findRomeInBuild(dist), [], "Milan and Roccella; a timezone and a street name are not Rome");
    writeFileSync(join(dist, "server", "assets", "1240_4180-x.bin"), "");
    writeFileSync(join(dist, "server", "rome-chunk.js"), 'export const area={id:"rome"};');
    // The minifier writes the browser bundle's strings in backticks.
    writeFileSync(join(dist, "client", "assets", "page-b.js"), "x.jsx(`option`,{value:`rome`,children:`Roma`})");
    writeFileSync(join(dist, "client", "index.html"), '<option value="rome">Roma</option>');
    assert.deepEqual(findRomeInBuild(dist).sort(), [
      '"rome" literal in client/assets/page-b.js',
      '"rome" literal in client/index.html',
      '"rome" literal in server/rome-chunk.js',
      "data module server/assets/1240_4180-x.bin",
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("the pilot deploy takes the homepage snapshot, then runs the Rome check, before anything is uploaded", async () => {
  const deploy = await read("scripts/deploy-pilot.mjs");
  const build = deploy.indexOf('run("npm", ["run", "build"])');
  const snapshot = deploy.indexOf("snapshotHomepage(rootPath)");
  const check = deploy.indexOf("findRomeInBuild(distPath)");
  assert.ok(build > 0 && build < snapshot && snapshot < check, "the snapshot is part of what the Rome check sees");
  assert.ok(check < deploy.indexOf('wrangler("deploy", "--dry-run")'), "checked right after the build");
  assert.ok(ROME_SOURCE_PATTERN.test('import("./rome-road-store.ts")') && !ROME_SOURCE_PATTERN.test("Europe/Rome"));
});
