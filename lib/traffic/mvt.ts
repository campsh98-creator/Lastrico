/**
 * Minimal Mapbox Vector Tile (protobuf) reader, enough for TomTom's traffic flow and incident tiles.
 * No dependency: a tile is a few kilobytes and the Worker only needs lines, points and string, number and
 * boolean properties. Anything it cannot read makes the whole tile fail (`MvtError`), never a partial guess.
 */
export class MvtError extends Error {
  override name = "MvtError";
}

export type TilePoint = [number, number];
export type MvtValue = string | number | boolean;
export type MvtFeature = {
  /** 1 point, 2 line string, 3 polygon. */
  type: 1 | 2 | 3;
  /** Points: one entry per point; lines and polygons: one entry per part. Tile coordinates, 0..extent plus a margin. */
  parts: TilePoint[][];
  properties: Record<string, MvtValue>;
};
export type MvtLayer = { name: string; extent: number; features: MvtFeature[] };
export type MvtTile = { layers: Record<string, MvtLayer> };

class Reader {
  position = 0;
  readonly bytes: Uint8Array;
  readonly end: number;
  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
  }

  get done() {
    return this.position >= this.end;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    while (this.position < this.end) {
      const byte = this.bytes[this.position++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
      if (shift > 63) break;
    }
    throw new MvtError("truncated varint");
  }

  bytesField(): Uint8Array {
    const length = this.varint();
    if (this.position + length > this.end) throw new MvtError("field past the end of the tile");
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.position += 8;
    else if (wire === 2) this.bytesField();
    else if (wire === 5) this.position += 4;
    else throw new MvtError(`unsupported wire type ${wire}`);
    if (this.position > this.end) throw new MvtError("field past the end of the tile");
  }
}

const decoder = new TextDecoder();

function readValue(bytes: Uint8Array): MvtValue {
  const reader = new Reader(bytes);
  let value: MvtValue | undefined;
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) value = decoder.decode(reader.bytesField());
    else if (field === 2 && wire === 5) { value = new DataView(bytes.buffer, bytes.byteOffset + reader.position, 4).getFloat32(0, true); reader.position += 4; }
    else if (field === 3 && wire === 1) { value = new DataView(bytes.buffer, bytes.byteOffset + reader.position, 8).getFloat64(0, true); reader.position += 8; }
    else if ((field === 4 || field === 5) && wire === 0) value = reader.varint();
    else if (field === 6 && wire === 0) { const n = reader.varint(); value = n % 2 ? -(n + 1) / 2 : n / 2; }
    else if (field === 7 && wire === 0) value = reader.varint() !== 0;
    else reader.skip(wire);
  }
  if (value === undefined) throw new MvtError("empty value");
  return value;
}

function packedVarints(bytes: Uint8Array): number[] {
  const reader = new Reader(bytes);
  const out: number[] = [];
  while (!reader.done) out.push(reader.varint());
  return out;
}

function decodeGeometry(type: number, commands: number[]): TilePoint[][] {
  const parts: TilePoint[][] = [];
  let current: TilePoint[] = [];
  let x = 0;
  let y = 0;
  let index = 0;
  const zigzag = (n: number) => (n % 2 ? -(n + 1) / 2 : n / 2);
  while (index < commands.length) {
    const header = commands[index++];
    const id = header % 8;
    const count = Math.floor(header / 8);
    if (id === 1 || id === 2) {
      for (let i = 0; i < count; i += 1) {
        const dx = commands[index++];
        const dy = commands[index++];
        if (dx === undefined || dy === undefined) throw new MvtError("geometry truncated");
        x += zigzag(dx);
        y += zigzag(dy);
        if (id === 1) {
          if (type !== 1 && current.length) parts.push(current);
          if (type === 1) { parts.push([[x, y]]); current = []; } else current = [[x, y]];
        } else current.push([x, y]);
      }
    } else if (id === 7) {
      if (current.length) { current.push(current[0]); parts.push(current); current = []; }
    } else throw new MvtError(`unknown geometry command ${id}`);
  }
  if (type !== 1 && current.length) parts.push(current);
  return parts;
}

function readLayer(bytes: Uint8Array): MvtLayer {
  const reader = new Reader(bytes);
  let name = "";
  let extent = 4096;
  const keys: string[] = [];
  const values: MvtValue[] = [];
  const rawFeatures: Uint8Array[] = [];
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) name = decoder.decode(reader.bytesField());
    else if (field === 2 && wire === 2) rawFeatures.push(reader.bytesField());
    else if (field === 3 && wire === 2) keys.push(decoder.decode(reader.bytesField()));
    else if (field === 4 && wire === 2) values.push(readValue(reader.bytesField()));
    else if (field === 5 && wire === 0) extent = reader.varint();
    else reader.skip(wire);
  }
  const features: MvtFeature[] = rawFeatures.map((raw) => {
    const feature = new Reader(raw);
    let type = 0;
    let tags: number[] = [];
    let geometry: number[] = [];
    while (!feature.done) {
      const tag = feature.varint();
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (field === 2 && wire === 2) tags = packedVarints(feature.bytesField());
      else if (field === 3 && wire === 0) type = feature.varint();
      else if (field === 4 && wire === 2) geometry = packedVarints(feature.bytesField());
      else feature.skip(wire);
    }
    if (type < 1 || type > 3) throw new MvtError(`unsupported geometry type ${type}`);
    const properties: Record<string, MvtValue> = {};
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const key = keys[tags[i]];
      const value = values[tags[i + 1]];
      if (key === undefined || value === undefined) throw new MvtError("tag outside the key or value table");
      properties[key] = value;
    }
    return { type: type as 1 | 2 | 3, parts: decodeGeometry(type, geometry), properties };
  });
  return { name, extent, features };
}

export function decodeMvt(bytes: Uint8Array): MvtTile {
  const reader = new Reader(bytes);
  const layers: Record<string, MvtLayer> = {};
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 3 && wire === 2) {
      const layer = readLayer(reader.bytesField());
      layers[layer.name] = layer;
    } else reader.skip(wire);
  }
  return { layers };
}
