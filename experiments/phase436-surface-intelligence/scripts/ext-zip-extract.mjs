/**
 * Extract chosen entries from a remote ZIP using HTTP Range (no whole-archive download). Uses the listing written by ext-zip-list.mjs.
 * usage: node ext-zip-extract.mjs <url> <listing.json> <outDir> <regex> [--max-mb=40]
 * Each entry is fetched with one Range request (compressed bytes only), inflated, written to outDir, and its SHA-256 recorded in outDir/_manifest.json.
 */
import { request, sha256, EVID } from "./ext-http.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { inflateRawSync } from "node:zlib";
const [url, listingFile, outDir, pattern] = process.argv.slice(2);
const maxMb = +(process.argv.find((a) => a.startsWith("--max-mb="))?.slice(9) ?? 40);
const listing = JSON.parse(await readFile(join(EVID, listingFile), "utf8"));
const rx = new RegExp(pattern, "i");
const pick = listing.list.filter((e) => rx.test(e.name) && e.uncompressed > 0);
const total = pick.reduce((s, e) => s + e.compressed, 0);
console.log(`selected ${pick.length} entries, ${(total / 1e6).toFixed(2)} MB compressed`);
if (total > maxMb * 1e6) throw new Error(`selection exceeds --max-mb=${maxMb}`);
await mkdir(outDir, { recursive: true });
const manifestPath = join(outDir, "_manifest.json");
let manifest = []; try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
for (const e of pick) {
  const want = join(outDir, basename(e.name));
  if (manifest.some((m) => m.name === e.name)) { console.log("have", e.name); continue; }
  const r = await request(url, { cacheName: `zipentry/${basename(url)}/${e.name.replace(/[^A-Za-z0-9._-]+/g, "_")}.raw`, headers: { Range: `bytes=${e.offset}-${e.offset + 30 + 512 + e.name.length + e.compressed - 1}` } });
  const b = r.bytes; if (b.readUInt32LE(0) !== 0x04034b50) throw new Error("bad local header for " + e.name);
  const nl = b.readUInt16LE(26), xl = b.readUInt16LE(28); const start = 30 + nl + xl;
  const data = b.subarray(start, start + e.compressed);
  const raw = e.method === 8 ? inflateRawSync(data) : data;
  if (raw.length !== e.uncompressed) throw new Error(`size mismatch for ${e.name}: ${raw.length} vs ${e.uncompressed}`);
  await writeFile(want, raw);
  manifest.push({ name: e.name, file: want.split(String.fromCharCode(92)).join("/"), compressed: e.compressed, uncompressed: e.uncompressed, sha256: sha256(raw), rangeBytesFetched: b.length, zipModified: e.modified });
  console.log(`ok ${e.name} -> ${raw.length} B (range ${b.length} B)`);
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
