/** Extract plain text from a local .docx (zip + word/document.xml) with Node built-ins. usage: node docx-text.mjs file.docx */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
const b = readFileSync(process.argv[2]);
let eocd = b.length - 22; while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
const n = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16);
for (let i = 0; i < n; i += 1) {
  const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
  const name = b.subarray(p + 46, p + 46 + nl).toString("utf8");
  if (name === "word/document.xml") {
    const lnl = b.readUInt16LE(off + 26), lxl = b.readUInt16LE(off + 28);
    const data = b.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    const xml = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    console.log(xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n"));
  }
  p += 46 + nl + xl + cl;
}
