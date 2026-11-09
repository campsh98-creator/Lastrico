# Lastrico — Phase 4.31 final completion: Milan ZTL, reverse A/B, field-test cases

8 November 2026. Continues Phase 4.31 in the same working tree (uncommitted). There are no
Cloudflare, infrastructure or deployment tasks. Rome and the published pilot stay unchanged.

## Evidence before starting

- **No Milan ZTL logic exists.**
  - Valhalla requests carry no `date_time`, so time-dependent restrictions are not applied.
  - Lastrico's legality check (`explicitRestriction`) treats any way with an `:conditional` access tag as unrestricted, and `permit` as allowed.
- **The Milan OSM archives in the repository carry verifiable ZTL rules on individual ways.** On the Promessi Sposi ↔ Vetra corridor:
  - Navigli evening ZTL: Via Magolfa, Fusetti, Gola and Argelati have `motor_vehicle:conditional=no @ (20:00 - 07:00)`; Via Borsi has `access:conditional=permit @ (20:00-07:00)`; Via Pichi has `yes @ (07:00 - 20:00)`.
  - Ripa di Porta Ticinese carries a "zona a traffico limitato" comment.
  - The polygon "ZTL: Quadrilatero della Moda" (all-day ban except authorised categories) is in the central archive.
- **What the data does not have:** official ZTL perimeters, Area C (congestion charge) geometry, and public-holiday calendars.

## Scope

1. **Time rules.** Parse and evaluate OSM access conditions (days, months, hours, `PH`) in Europe/Rome time at the request's departure time.
2. **Verified ZTL areas.**
   - Build them from those tags, with way IDs, rules and evidence.
   - The person can authorise areas per mode. Authorisations are stored on the device and sent with every initial route and reroute.
3. **Legality.**
   - An unauthorised ZTL stretch in the middle of a route disqualifies that route.
   - Next to the start or the destination, it is reported, not hidden.
   - A ZTL-avoiding candidate is generated when the provider routes through one.
   - Pedestrian ways, private roads, one-ways, bus lanes and plain `no` are never unlocked.
4. **Reverse A/B button**, "Inverti partenza e destinazione":
   - swaps addresses and coordinates atomically;
   - keeps mode, objective, extra minutes and ZTL settings;
   - starts exactly one calculation.
5. **Field cases A–F.**
   - An evidence matrix reconstructed from provider routes and OSM, never from invented traces.
   - Case C: check whether the recentre control triggers a different reroute path.
6. **"Descrivi la tua preferenza".** Make it discoverable with a minimal change, and verify the existing Phase 4.29–4.31 features without rebuilding them.

## Limits

- No commits, pushes, deploys or Cloudflare work.
- No invented ZTL perimeters, hours or permissions.
- Unsupported cases are stated in the app and in the report: Area C payment, ZTLs without OSM rules, holidays, and categories such as residents or disabled.
- Planner payloads for routes that touch no ZTL rule stay identical.

## Acceptance

- Promessi Sposi → Vetra at 21:00 without authorisation avoids the Navigli evening ZTL. With authorisation it may use it. At 12:00 it is unaffected.
- The reverse button passes a browser test at 390×844 in both directions, with one request.
- Unit tests, TypeScript, lint and targeted browser scenarios pass.
- An Italian report with a six-case evidence matrix.
