import type { TilePayload } from "./spatial-road-store";

/**
 * Rome tiles ship as gzip Data modules (`data/surfaces/rome-tiles-packed/*.bin`) so the Worker
 * upload stays below Cloudflare's 64 MiB limit. Each one holds the exact bytes of its JSON tile.
 */
export async function inflateTileText(packed: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = packed instanceof Uint8Array ? packed : new Uint8Array(packed);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function inflateTile(packed: ArrayBuffer | Uint8Array): Promise<{ default: TilePayload }> {
  return { default: JSON.parse(await inflateTileText(packed)) as TilePayload };
}
