# Lastrico — Phase 4.27 Execution Prompt: Rome package below the Cloudflare limit

## 1. Checkpoint (2026-11-07)

- Branch `fix/mobile-navigation-stability` at `66bdccd`. The pilot serves `bf3e13d5-51be-41a8-95d9-e72462c69053`, which is Milan and Roccella without Rome.
- Rome (Phase 4.23) is uncommitted in the working tree.
- With Rome, the Worker upload is 67.73 MiB. Cloudflare's current limit is a single 64 MiB check on the uncompressed upload, on both plans. The compressed-size limits were removed on 2026-09-04.
- Measured:
  - Rome's 378 tiles are 50.01 MiB of JSON. With gzip -9 they are 8.96 MiB.
  - Rome's `metadata.json` is 3.95 MiB.
  - Without Rome the upload is 13.18 MiB.
- With Rome in the tree, `npx tsc --noEmit` runs out of memory at the default heap.

## 2. Approach

- Pack every Rome tile as a gzip Data module (`data/surfaces/rome-tiles-packed/<key>.bin`). Each one holds the exact bytes of the JSON tile.
- `lib/rome-tile-index.ts` loads the packed tile and inflates it with `DecompressionStream` only when a Rome route needs it.
- The JSON tiles stay as they are. They remain the reproducible build output and the Node test path.
- Generation is done by a Rome-specific script, `scripts/osm/pack-rome-tiles.mjs`, which `build-rome-pilot.mjs` also calls. The shared tile generator is not changed.

## 3. Limits

- The content is lossless: no tile, tag, coordinate or classification changes. Rome is not removed, and its area is not reduced.
- Milan and Roccella code paths and data are not touched. Shared files only get Rome-gated lines or a type declaration for binary modules.
- No commit, push or deployment. The live pilot stays at `bf3e13d5`.

## 4. Acceptance criteria

- The Wrangler dry-run upload is below 64 MiB with a clear margin, and the size is recorded.
- Every packed tile inflates to the exact bytes of its JSON tile. A test checks all of them with the runtime decoder.
- The Phase 4.23 validation journeys give the same Rome surface metrics as before:
  - in Node (replay);
  - on the local Worker, which uses the packed path, matching Node for the same journeys.
- `npx tsc --noEmit` at the default heap if possible, `npm run lint` and `npm test` all pass.
- An Italian report under `outputs/` states whether Rome can now be released, and what remains (iPhone, release authorization).
