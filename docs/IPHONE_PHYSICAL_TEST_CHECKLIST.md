# Lastrico physical iPhone test checklist

Use a safe passenger test or stop the vehicle before interacting with the screen. Record iPhone model, iOS version, Safari/PWA mode, transport mode, route, time and weather for every failure.

## Install and permissions

- [ ] Open the deployed HTTPS URL in Safari.
- [ ] Use **Condividi → Aggiungi alla schermata Home** and open Lastrico from its icon.
- [ ] Confirm the standalone layout respects the status bar, notch/Dynamic Island and Home Indicator.
- [ ] Start navigation and choose **Allow While Using App** with precise location enabled.
- [ ] Deny location once and confirm Lastrico ends GPS navigation, preserves the calculated route and explains how to retry or use simulation.

## Stationary and movement behavior

- [ ] While stationary for two minutes, confirm the arrow does not move automatically.
- [ ] Confirm the HUD says GPS live/weak/requesting according to actual signal and never says simulation.
- [ ] Move along the selected route and confirm the arrow advances only with the device position.
- [ ] Confirm heading changes smoothly without spinning when stopped.
- [ ] Confirm distance, ETA and next instruction do not jump materially backwards at intersections.
- [ ] Toggle voice off/on; confirm visual instructions always remain and the visible instruction is spoken once after reactivation.

## Rerouting and lifecycle

- [ ] Leave the route safely and confirm recalculation starts only after consecutive reliable off-route fixes.
- [ ] Confirm one new Lastrico route replaces the old route and preserves Auto/Moto/Bici, avoidance level, time budget and safe/fast choice.
- [ ] Turn connectivity off while off-route; confirm the last route remains visible and no false successful reroute appears.
- [ ] Return online and confirm the app can recover without reload.
- [ ] Tap Start repeatedly; confirm only one navigation session is visible.
- [ ] Run Start → Stop → Start ten times; confirm no duplicate voice, marker or unexpected location updates.
- [ ] Stop during a reroute, then calculate a new planner route; confirm calculation is not stuck.
- [ ] Lock/unlock the iPhone and background/foreground the PWA; confirm the UI explains any suspended GPS and resumes without duplicate navigation.

## Coverage and arrival

- [ ] Test a position near and then outside the Milan beta boundary; confirm the state says **Fuori area beta**, not **GPS debole**.
- [ ] Approach the destination normally; confirm arrival requires movement and two reliable readings.
- [ ] Confirm arrival stops GPS, voice and Wake Lock and leaves the route recoverable.

## Visual matrix

- [ ] Test portrait and landscape in light, dark and automatic themes.
- [ ] Open the keyboard in the planner; confirm all fields, prompt and **Confronta i percorsi** remain reachable by panel scrolling.
- [ ] Confirm **Avvia con GPS**, **Termina**, voice and recenter controls are at least 44px and not covered.
- [ ] Select Anti-pavé and Più rapido alternately; confirm the map highlight, metrics, pavement overlay and navigation all follow the same selection.

## Release evidence

- [ ] Attach screen recordings for one normal route, one reroute and one permission-denied recovery.
- [ ] Attach screenshots of planner, route result and GPS HUD in both themes.
- [ ] File every failure with exact reproduction steps and whether it occurred in Safari, standalone PWA or both.

