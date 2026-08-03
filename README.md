# Lastrico

![Lastrico logo concept](public/brand/lastrico-logo-concept-v1.png)

Lastrico is an experimental, open-source, road-surface-aware navigation PWA. It compares
routes for cars, motorcycles, and bicycles using known road-surface data so people can make
more informed choices and reduce estimated exposure to rough or uneven streets.

**Created by [Domenico Campanella Scali](https://github.com/campsh98-creator).**

**Current beta:** [lastrico-milano.cscda39.chatgpt.site](https://lastrico-milano.cscda39.chatgpt.site)

> The current tested beta coverage is limited to Milan. Milan is the first coverage area, not
> part of the product name or a limit of the long-term architecture.

> **Safety notice:** Lastrico does not guarantee route safety, prevent accidents, or replace
> road signs, traffic rules, rider judgement, or certified navigation. Surface data may be
> incomplete or outdated. Zero known exposure does not mean a hazard-free route.

## Long-term vision

Lastrico aims to become an Italy-wide road-intelligence layer that compares more than
estimated arrival time. Future route choices may consider verified hazards, surface quality,
road class, closures, lighting evidence, weather, reliability, comfort, vehicle suitability,
data confidence, and explicit user preferences.

A future conversational interface could extend the same model to requests such as “prefer
major, well-lit roads and accept 30 extra minutes” while keeping the interpreted preferences
visible and bounded. Legal constraints, candidate generation, and ranking would remain
deterministic and testable.

Italy-wide hazard coverage, native applications, Apple CarPlay, Android Auto, live data, and
general hazard, traffic, or weather prompting are **not implemented today**. See the
[concise business plan](docs/BUSINESS_PLAN.md), [roadmap](ROADMAP.md), and
[brand concept](docs/BRAND_CONCEPT.md).

## Supported travel modes

Lastrico exposes three real routing modes rather than relabelling one car route:

- **Car:** Valhalla auto routing with a temporary public OSRM car fallback.
- **Motorcycle:** Valhalla's experimental motorcycle profile; access rules depend on
  OpenStreetMap data.
- **Bicycle:** Valhalla bicycle routing; it never silently substitutes a car route.

Provider availability, legal access data, surface coverage, and route quality vary by mode.
Users remain responsible for weather, closures, vehicle suitability, traffic rules, and
immediate road conditions.

## What works today

- free-form start and destination within the current Milan beta area;
- address search and direct point selection on the map;
- GPS position as the starting point;
- comparison between the fastest route and a lower rough-surface-exposure alternative;
- three surface-avoidance preferences;
- an experimental local prompt interpreter for bounded Italian and English requests about
  cobblestone avoidance and maximum extra travel time;
- manual recalculation and experimental GPS rerouting;
- foreground GPS navigation, kept separate from automatic route simulation;
- a complete turn list with the current manoeuvre highlighted;
- optional persistent voice guidance, disabled by default;
- estimated known rough-surface exposure, travel time, and distance;
- highlighted surface segments;
- persistent community reports reviewed before publication;
- CSV export containing verified contributions only;
- installation on iPhone as a web app.

The current beta interface is in Italian. Repository documentation and collaboration happen
in English; interface localisation is tracked separately.

The prompt interpreter is a deterministic, rule-based beta feature, not an AI or language
model. Applying an understood request changes the routing preferences used for recalculation.
Prompt text stays in the browser and is not sent to a third party. The interpreter does not
yet understand general road hazards, traffic, weather, lighting, or unrestricted natural
language.

## Try the beta on iPhone

1. Open the beta in Safari.
2. Tap **Share**.
3. Select **Add to Home Screen**.
4. Enable **Open as Web App**.
5. Grant location access only when starting a GPS test.

The PWA does not appear on the CarPlay display. A real CarPlay integration would require a
native iPhone app, production-grade turn-by-turn navigation, and Apple's CarPlay Navigation
entitlement.

## Architecture

| Area | Technology |
| --- | --- |
| Interface | React 19, Next.js/vinext, TypeScript |
| Map | MapLibre GL JS with an OpenFreeMap vector style |
| Map data | OpenStreetMap and OpenFreeMap |
| Beta routing | Public Valhalla; OSRM fallback for cars only |
| Road surfaces | Bundled OSM-derived dataset and `surface` tags |
| Address search | Nominatim |
| Community reports | Cloudflare D1 and Drizzle ORM |
| Delivery | PWA and Cloudflare Worker through Sites |

```text
iPhone / browser
       │
       ▼
Lastrico PWA ──► Nominatim geocoding
       │
       ├──────► Valhalla / OSRM alternatives
       ├──────► bundled OSM surface data
       └──────► moderated D1 reports
```

See [architecture](docs/architecture.md), [development](docs/development.md),
[governance](GOVERNANCE.md), and the [roadmap](ROADMAP.md) for more detail.

## Local development

Requirements:

- Node.js 22.13 or later;
- npm.

```bash
npm ci
npm run dev
```

The local app is available at `http://localhost:3000`.

Run all required checks:

```bash
npm run lint
npm test
```

After changing the database schema, regenerate migrations with:

```bash
npm run db:generate
```

The local D1 database must use the migration in `drizzle/`. The application's logical binding
is named `DB`.

## Free beta limitations

The public Nominatim, Valhalla, OSRM, and OpenFreeMap services are suitable only for a small
beta with moderate request volume. They are not free, unlimited commercial infrastructure.
Travel times do not include live traffic.

New community reports are stored as `pending`. They are not exposed through the public API or
CSV and do not affect routing until they have been verified. Moderation notes are not
published.

Lastrico does not store a continuous GPS location history. GPS navigation requires HTTPS,
precise-location permission, a data connection, and the app open in the foreground. iOS may
suspend a PWA when the screen is locked or another app is opened.

## Contributing

Contributions are welcome in code, routing, road-surface data, accessibility, documentation,
testing, and localisation. Start with [CONTRIBUTING.md](CONTRIBUTING.md), check existing
[issues](https://github.com/campsh98-creator/Lastrico/issues), use the
[guided issue templates](https://github.com/campsh98-creator/Lastrico/issues/new/choose),
and look for `good first issue` or `help wanted`.

Useful contribution areas include:

- correcting missing or inaccurate road-surface data;
- improving mode-specific routing without hiding provider limitations;
- testing mobile navigation and accessibility;
- documenting reproducible bugs without personal travel data;
- extending verified geographic coverage without coupling the product identity to one city.

Before opening a pull request, run `npm run lint` and `npm test`, test relevant mobile
viewports, and describe both the evidence and remaining limitations. OpenStreetMap-derived
data contributions must retain the required attribution and comply with the ODbL.

Never publish home addresses, live or identifiable location histories, licence plates,
credentials, or production data in an issue or pull request. Report vulnerabilities through
the private process described in [SECURITY.md](SECURITY.md).

## Licence

The code is released under the [MIT License](LICENSE). OpenStreetMap-derived data remains
subject to its applicable licence and attribution requirements.
