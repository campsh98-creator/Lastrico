# Motia product vision

**Status:** management working document  
**Planning date:** 30 July 2026  
**External publication:** founder, legal, technical, data, and trademark review required

## Brand and product architecture

- **Parent company:** Motia
- **Parent tagline:** *Routes shaped around you.*
- **Technology platform:** Motia Routing Intelligence
- **Future engine/API:** Motia Routing Engine
- **First product:** Lastrico by Motia
- **Lastrico tagline:** *Smoother roads. Smarter routes.*

Motia is pronounced **“MÒ-tia”** in three syllables, approximately **“MOH-tee-uh”** in
English. It is a coined name. No linguistic origin, company registration, trademark
registration, or freedom to operate is claimed until specialist checks are complete.

## The product thesis

> **The future interface of navigation is the prompt.**

Existing navigation products process sophisticated information, but people are usually
offered a small number of rigid controls. A traveller may be willing to accept a defined
delay for smoother surfaces, simpler junctions, greater continuity on major roads, lower
toll cost, or a route better suited to a particular vehicle. Those trade-offs are difficult
to express through conventional switches.

Motia's long-term thesis is that people should be able to describe the journey they want in
plain language, review how the system interpreted that request, and compare explainable
legal alternatives. The prompt is the interface, not the routing authority.

Natural language must translate into a versioned, allow-listed preference object:

```json
{
  "travel_mode": "motorcycle",
  "max_extra_minutes": 5,
  "avoid_surfaces": {
    "cobblestone": "strong",
    "severely_damaged": "strong"
  },
  "prefer_major_road_continuity": "medium",
  "legal_access": "required"
}
```

The user sees and confirms that interpretation. A deterministic routing system then enforces
legal access, generates candidates, applies calibrated scoring, and explains material
trade-offs. Ambiguous or unsupported requests require clarification. A prompt can never
override traffic law, access restrictions, platform safety rules, or unavailable evidence.
Unknown road, lighting, surface, or hazard data remains unknown.

## Mission

Enable people and organisations to choose routes that better reflect their real needs by
translating complex preferences into transparent, reviewable, and customisable navigation
decisions.

## Vision

Build a new intelligence layer for mobility in which route selection can reflect what
matters to each traveller—not only visible ETA—while preserving legal constraints,
uncertainty, explainability, and accountable human oversight.

Motia is not tied to Milan, cobblestones, one city, or one transport mode. Lastrico is the
focused wedge through which the broader thesis can be tested.

## What exists now: Lastrico beta

The repository currently evidences an experimental React/Next.js PWA with:

- a MapLibre map using OpenFreeMap/OpenStreetMap data;
- public Nominatim address search constrained to Milan;
- public Valhalla routing and an OSRM car fallback;
- distinct car, motorcycle, and bicycle modes;
- route comparison using estimated exposure to known rough or irregular surfaces;
- foreground GPS, manoeuvres, rerouting experiments, and optional voice;
- a road-report submission flow and pending/verified/rejected data states;
- a bundled Milan road-surface dataset;
- automated tests and open-source project documentation.

This is technical evidence and a tested beta, not a production national navigator.
Production moderation operations, native apps, traffic, weather, nationwide hazards,
offline navigation, CarPlay, Android Auto, commercial service levels, and conversational
routing are not implemented.

## Product layers

### 1. Lastrico by Motia

Lastrico begins with a visible, testable problem: a user may prefer a modest detour to reduce
exposure to known uncomfortable surfaces. Milan cobblestones are the initial validation
case, not the final market boundary.

Lastrico should validate:

- whether users understand and choose a non-fastest alternative;
- whether estimated road-condition exposure changes route choice;
- whether GPS and rerouting remain reliable in real journeys;
- whether contributors can improve data without introducing unacceptable risk;
- whether the experience retains users and supports willingness to pay;
- whether fleets, municipalities, and mobility partners recognise value.

### 2. Motia Routing Intelligence

The planned platform combines:

- a versioned preference ontology;
- candidate-route generation;
- legal and mode-specific constraints;
- road-condition and hazard evidence;
- route-quality, uncertainty, and time trade-offs;
- contributor confidence and moderation;
- a generalised-cost model;
- route explanations and feedback loops;
- privacy, security, and provenance controls.

The differentiation is the combined operating system—not an LLM alone. Potential
defensibility comes from preference structure, data quality, geospatial pipelines,
calibrated scoring, observed user decisions, community operations, integrations, brand, and
execution.

### 3. Motia Routing Engine

The Motia Routing Engine is a conditional future API and engine layer. It may provide
preference interpretation, candidate ranking, hazard exposure, route explanations, or
white-label intelligence to fleets and mobility platforms. Its scope, provider model,
licensing, and commercial readiness must be validated before it is presented as a product.

## Experience principles

### Explain the trade-off

Every proposed route should communicate:

- ETA and distance;
- the preference it serves;
- expected trade-off against the fastest candidate;
- known condition or hazard exposure;
- proportion of the journey with unknown evidence;
- data age and confidence where useful;
- whether conditions changed after selection.

No route may be labelled “safe”, “safest”, “accident-free”, or guaranteed smooth.

### Preserve route intent

The selected route needs a versioned contract containing the candidate ID, selected geometry
or provider token, scoring version, hazard snapshot, and reroute reason. If a navigation
provider cannot preserve that intent, the app must tell the user and present the revised
trade-off. It must not silently show one route while navigating another.

### Design by travel mode

Car, motorcycle, and bicycle requests have different access rules, hazard meanings, routing
profiles, and tolerances. A car route must never be relabelled as a bicycle or motorcycle
route. CarPlay and Android Auto are car environments; motorcycle and bicycle experiences
remain phone-first unless an appropriate platform surface is available and approved.

### Work when evidence is incomplete

Absence of a report is not evidence of a smooth, lit, or hazard-free road. The product should
show coverage and uncertainty, retain the active route during recoverable failures, and
provide a documented degraded mode when network or provider services are unavailable.

## Real-world product scenarios

### Milan: surface trade-off

A motorcyclist accepts up to five additional minutes to reduce known cobblestone exposure.
Lastrico compares the fastest candidate with a materially different lower-exposure option
and discloses unknown surface distance.

### Catania: damaged-road evidence

A driver asks to reduce exposure to recently verified severe potholes. The system uses
time-bounded evidence, not a permanent city stereotype, and explains where coverage is
missing.

### North–south journey: route continuity

A traveller prefers appropriate major-road continuity and rejects a marginal time saving
that depends on narrow rural roads. The engine may recommend a longer motorway or national
road candidate if it stays within the confirmed delay tolerance and all legal restrictions.

### Conditional toll avoidance

A driver avoids tolls only when the expected additional time is below a chosen threshold.
The preference becomes a measurable policy rather than a global on/off assumption.

## Data and community model

National map availability is not national hazard coverage. Motia should expand through
versioned zones and corridors using:

- OpenStreetMap network data with attribution and ODbL compliance;
- Italy's CCISS National Access Point catalogue and reusable DATEX II/operator datasets;
- regional and municipal data with source-specific licences;
- contracted map, traffic, weather, and navigation services;
- moderated, time-bounded community observations;
- separately labelled inferred signals, used only after consent and validation.

Every material feature needs source, licence, geometry, observation time, import version,
confidence, freshness, mode relevance, verification state, and expiry. An official access
point may be a catalogue rather than one uniform production API; reuse rights, latency, and
coverage require dataset-level verification.

Community reports must not affect routing immediately. Contributors should report while
stopped or after a trip. Photos require metadata removal and protection of faces, plates,
private locations, and identity. Production requires moderation tooling, abuse reporting,
blocking, appeals, response targets, and accountable owners.

## Target technical architecture

- native iOS client in Swift/SwiftUI;
- native Android client in Kotlin/Compose;
- shared, versioned server contracts;
- PostgreSQL/PostGIS authoritative geospatial store;
- object storage for licensed snapshots and non-public evidence;
- stable road-edge identifiers across graph releases;
- versioned ingestion, validation, and reversible graph builds;
- contracted navigation, map, geocoding, and live-data services;
- candidate-route, hazard-matching, and scoring services;
- contribution, trust, and moderation services;
- distributed abuse protection and audit logs;
- privacy controls, observability, backups, and incident response;
- provider-licensed offline assets and cached active guidance for degraded operation.

The first production version should use a contracted navigation foundation while Motia owns
the preference, evidence, ranking, and explanation layer. Google Navigation SDK, Mapbox
Navigation SDK, and an operated/self-hosted OSM stack require proof-of-concept testing before
commitment. Provider terms and custom-route behaviour must be validated, not assumed.

## Automotive boundary

A PWA cannot simply be enabled in CarPlay or Android Auto.

CarPlay requires a native iOS app, Apple's navigation entitlement application and addendum,
CarPlay templates and sessions, simulator and vehicle testing, App Store review, and
approval that is not guaranteed. Android Auto requires a native Android navigation app,
Android for Cars templates and service declarations, vehicle-surface rendering,
distraction-limited flows, automotive testing, and Google Play review. Google's documented
Navigation SDK Android Auto integration is currently Preview and should be treated as a
supplier risk.

Automotive account and entitlement feasibility should begin early, while public automotive
release remains conditional on stable phone navigation.

## Product governance

Before a capability can influence routing it needs:

1. a named product and technical owner;
2. a source and licence decision;
3. a bounded meaning by travel mode;
4. test fixtures and quality thresholds;
5. privacy and security review;
6. an uncertainty and expiry policy;
7. rollback and incident procedures;
8. field validation;
9. language that does not overstate evidence.

## Product success measures

The first useful measures are not download counts alone:

- successful route previews and completed navigation sessions;
- non-fastest alternative selection and later route regret;
- route latency, rerouting reliability, and crash-free sessions;
- unknown distance per route;
- verified-evidence coverage and freshness;
- report confirmation, rejection, expiry, and moderation time;
- D30/D90 retention;
- willingness to pay and cost per navigation session;
- paid pilots and partner data contributions.

Crash reduction or safety impact requires independent, defensible study. Until then, Motia
measures product reliability, evidence exposure, user understanding, and route-choice
quality—not guaranteed safety.

## Current primary references

Accessed 30 July 2026:

- [Apple: Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements)
- [Android: Build a navigation app](https://developer.android.com/training/cars/apps/navigation)
- [Google: Navigation SDK for Android Auto](https://developers.google.com/maps/documentation/navigation/android-sdk/android-auto)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [European Commission: National Access Points](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en)

