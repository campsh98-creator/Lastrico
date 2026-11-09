# README images: how they were made

All images in this folder are screenshots of the real Lastrico app. Nothing in them was drawn,
retouched or mocked up.

**What is real**
- The app is the local production build, a Cloudflare Worker run with `wrangler dev`, captured on
  9 November 2026 from branch `fix/mobile-navigation-stability`.
- Routes, timings, pavé figures and street names come from Lastrico's own `/api/routes` answer to
  real FOSSGIS Valhalla responses. They are recorded and replayed so the images can be reproduced
  (`tests/e2e/fixtures/phase431-porta-vittoria-car.json`, departure Monday 12:00).
- Surface data, traffic signals and ZTL rules come from OpenStreetMap, as bundled in `data/`.
- The base map is © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.

**What is simulated**
- The GPS position in the navigation screens is fed along the recorded route through the app's
  own geolocation handler in headless Chrome.
- None of the images comes from a physical iPhone.

**Composition**
- `hero.jpg` places three unmodified phone screenshots side by side on a plain background.
- The other images are single screenshots, resized and saved as JPEG.

**Reproduce**

```bash
npm run build
npx wrangler d1 execute site-creator-d1 --local --file drizzle/0000_stormy_quasar.sql --config dist/server/wrangler.json
npx wrangler dev --config dist/server/wrangler.json --port 8799 --local
```

In a second terminal:

```bash
node scripts/capture-showcase-screenshots.mjs /tmp/lastrico-showcase
```

```bash
node scripts/build-readme-assets.mjs /tmp/lastrico-showcase docs/assets/readme
```
