import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { inflateTile, inflateTileText } from "../lib/rome-tile-codec.ts";

const tilesDir = new URL("../data/surfaces/rome-tiles/", import.meta.url);
const packedDir = new URL("../data/surfaces/rome-tiles-packed/", import.meta.url);
const meta = JSON.parse(await readFile(new URL("metadata.json", tilesDir), "utf8"));
const keys = meta.tileKeys ?? Object.keys(meta.tiles ?? {});
const sums = JSON.parse(await readFile(new URL("SHA256SUMS.json", packedDir), "utf8")).tiles;
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

test("every packed Rome tile inflates, with the runtime decoder, to the exact bytes of its original JSON tile", async () => {
  assert.ok(keys.length > 300, "Rome lists its full tile set");
  const packedFiles = (await readdir(packedDir)).filter((name) => name.endsWith(".bin")).sort();
  assert.deepEqual(packedFiles, keys.map((key) => `${key}.bin`).sort(), "one packed tile per metadata tile, nothing else");
  assert.deepEqual(Object.keys(sums).sort(), [...keys].sort(), "one checksum per tile");
  for (const key of keys) {
    const text = await inflateTileText(await readFile(new URL(`${key}.bin`, packedDir)));
    assert.equal(sha256(text), sums[key], `tile ${key} differs from the compiled original`);
    // The JSON tiles are a reproducible intermediate: when a build has produced them, they must agree too.
    const jsonPath = new URL(`${key}.json`, tilesDir);
    if (existsSync(jsonPath)) assert.equal(text, await readFile(jsonPath, "utf8"), `tile ${key} changed in packing`);
  }
  const { default: payload } = await inflateTile(await readFile(new URL(`${keys[0]}.bin`, packedDir)));
  assert.ok(Array.isArray(payload.tuples) && payload.tuples.length > 0);
});

test("the Rome runtime index loads only packed tiles, never the JSON tiles", async () => {
  const index = await readFile(new URL("../lib/rome-tile-index.ts", import.meta.url), "utf8");
  const imports = [...index.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(imports.length, keys.length);
  assert.ok(imports.every((path) => /^\.\.\/data\/surfaces\/rome-tiles-packed\/\d+_\d+\.bin$/.test(path)));
  assert.doesNotMatch(index, /rome-tiles\/[^"]*\.json/);
});
