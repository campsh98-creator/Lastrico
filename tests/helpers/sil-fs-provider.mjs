import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Node-only SIL layer provider for tests, the benchmark and the corridor script. It reads the files a build wrote
 * (`<dir>/manifest.json`, `<dir>/<layer>/<tile>.json`) and records every call, so a test can assert on lookups.
 * It is deliberately NOT in lib/: runtime code must stay free of Node modules to run in a Worker.
 * `mutate(layer, tile, parsed)` lets a test corrupt, drop or relabel a file on the way in.
 */
export function createFsLayerProvider(dir, { mutate = null, mutateManifest = null, failManifest = false, failTile = null } = {}) {
  const calls = { manifest: 0, tiles: [] };
  return {
    calls,
    async loadManifest() {
      calls.manifest++;
      if (failManifest) throw new Error("manifest unreadable");
      let raw;
      try { raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      return mutateManifest ? mutateManifest(raw) : raw;
    },
    async loadTile(layer, tileKey) {
      calls.tiles.push(`${layer}/${tileKey}`);
      if (failTile && failTile(layer, tileKey)) throw new Error("tile unreadable");
      let raw;
      try { raw = JSON.parse(await readFile(join(dir, layer, `${tileKey}.json`), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      return mutate ? mutate(layer, tileKey, raw) : raw;
    },
  };
}
