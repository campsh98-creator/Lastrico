/** Minimal dBASE III/IV (.dbf) reader — Node built-ins only. Yields records as arrays aligned with fields. */
import { readFileSync } from "node:fs";

export function readDbf(path) {
  const b = readFileSync(path);
  const nRec = b.readUInt32LE(4);
  const hdrLen = b.readUInt16LE(8);
  const recLen = b.readUInt16LE(10);
  const ldid = b[29]; // language driver id (0x57 = ANSI/cp1252, 0x03 = cp1252, 0x00 = unspecified)
  const fields = [];
  let off = 1;
  for (let p = 32; b[p] !== 0x0d && p < hdrLen; p += 32) {
    const name = b.subarray(p, p + 11).toString("latin1").split("\0")[0];
    fields.push({ name, type: String.fromCharCode(b[p + 11]), length: b[p + 16], decimals: b[p + 17], offset: off });
    off += b[p + 16];
  }
  const decode = (buf) => (ldid === 0x4d || ldid === 0x4e || ldid === 0x4f ? buf.toString("utf8") : buf.toString("latin1"));
  function* records() {
    for (let i = 0; i < nRec; i += 1) {
      const base = hdrLen + i * recLen;
      if (b[base] === 0x2a) continue; // deleted
      yield fields.map((f) => decode(b.subarray(base + f.offset, base + f.offset + f.length)).trim());
    }
  }
  return { nRec, fields, records, ldid, recLen, hdrLen, size: b.length };
}
