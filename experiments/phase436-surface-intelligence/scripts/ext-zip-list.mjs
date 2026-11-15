/**
 * List the entries of a remote ZIP without downloading it: HTTP Range on the tail (End Of Central Directory + central directory).
 * usage: node ext-zip-list.mjs <url> <cacheName> [--out=<json>]
 * Only the central directory (a few hundred KB at most) is transferred; entry data is NOT fetched.
 */
import { request, EVID } from "./ext-http.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
const [url, cacheName] = process.argv.slice(2);
const head = await request(url, { method: "HEAD" });
const size = +head.headers["content-length"];
const tailLen = 65536 + 22;
const tail = await request(url, { cacheName: `${cacheName}.tail`, headers: { Range: `bytes=${size - tailLen}-${size - 1}` } });
let b = tail.bytes; let eocd = -1;
for (let i = b.length - 22; i >= 0; i -= 1) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
if (eocd < 0) throw new Error("EOCD not found");
let entries = b.readUInt16LE(eocd + 10), cdSize = b.readUInt32LE(eocd + 12), cdOff = b.readUInt32LE(eocd + 16);
if (cdOff === 0xffffffff || entries === 0xffff) { // zip64
  const loc = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd); const z64 = Number(b.readBigUInt64LE(loc + 8));
  const r = await request(url, { cacheName: `${cacheName}.z64`, headers: { Range: `bytes=${z64}-${z64 + 55}` } });
  entries = Number(r.bytes.readBigUInt64LE(32)); cdSize = Number(r.bytes.readBigUInt64LE(40)); cdOff = Number(r.bytes.readBigUInt64LE(48));
}
const cd = await request(url, { cacheName: `${cacheName}.cd`, headers: { Range: `bytes=${cdOff}-${cdOff + cdSize - 1}` } });
const buf = cd.bytes; const list = []; let p = 0;
for (let i = 0; i < entries; i += 1) {
  if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad CD signature at " + p);
  const method = buf.readUInt16LE(p + 10), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
  let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24); const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32); let off = buf.readUInt32LE(p + 42);
  const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
  if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) { let q = p + 46 + nl; const end = q + xl; while (q < end) { const id = buf.readUInt16LE(q), len = buf.readUInt16LE(q + 2); if (id === 1) { let r = q + 4; if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(r)); r += 8; } if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(r)); r += 8; } if (off === 0xffffffff) { off = Number(buf.readBigUInt64LE(r)); } } q += 4 + len; } }
  const dt = `${1980 + (date >> 9)}-${String((date >> 5) & 15).padStart(2, "0")}-${String(date & 31).padStart(2, "0")} ${String(time >> 11).padStart(2, "0")}:${String((time >> 5) & 63).padStart(2, "0")}`;
  list.push({ name, method, compressed: csize, uncompressed: usize, offset: off, modified: dt });
  p += 46 + nl + xl + cl;
}
console.log(`zip size ${size} B; entries ${entries}; central directory ${cdSize} B @ ${cdOff}`);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (out) await writeFile(join(EVID, out), JSON.stringify({ url, size, entries, list }, null, 0));
const groups = {};
for (const e of list) { const ext = e.name.split(".").pop().toLowerCase(); const base = e.name.replace(/\.[^.]+$/, ""); (groups[base] ??= { exts: {}, usize: 0, csize: 0 }); groups[base].exts[ext] = e.uncompressed; groups[base].usize += e.uncompressed; groups[base].csize += e.compressed; }
for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].csize - a[1].csize)) console.log(`${(g.csize / 1e6).toFixed(2).padStart(8)} MB zipped | ${(g.usize / 1e6).toFixed(2).padStart(8)} MB raw | ${k} [${Object.keys(g.exts).join(",")}]`);
