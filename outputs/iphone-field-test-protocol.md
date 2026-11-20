# iPhone field test, Milan: 30–45 minutes (20 November 2026)

Target: `https://lastrico-preview-437.campsh.workers.dev` only. Never the pilot. Nothing here has been run on a phone yet:
this is the protocol for the first physical run.

## Before leaving (5 min)

- iPhone: Safari (not an in-app browser), Settings > Privacy > Location Services > Safari Websites > **While Using** and
  **Precise Location on**. Low Power Mode off. Silent switch off, volume up, battery above 50 %, mobile data on.
- Open the preview, add it to the Home Screen only if you want to test that too (the main run uses Safari).
- Open `/api/traffic/status` once: it must say `configured: true`. If it says `key-rejected`, live traffic is **off**: skip the
  traffic steps and write it down. Do not retry more than once (every attempt spends a provider request).
- Decide a second person or a passenger who writes the notes; the driver or rider never touches the phone while moving.

## Route set (about 35 min)

Pick three journeys of 3–6 km that you know. At least one crosses an area with setts (pavé) and, if possible, a tram line.

1. **A: car or motorcycle, pavé avoidance "forte".** Compare the two cards before leaving: note minutes, distance and pavé %.
2. **B: bicycle**, same idea, a different journey. Bicycle ignores traffic by design.
3. **C: any mode, deliberate wrong turn** to force a reroute.

## What to check, in order

| # | Step | Pass if | Write down |
| --- | --- | --- | --- |
| 1 | Start GPS navigation outdoors | First fix in under 30 s; the position snaps on the road; no "imprecise" banner | seconds to first fix, accuracy shown |
| 2 | First 500 m | Heading arrow follows the direction of travel; marker does not jump sideways or backwards | jumps, lag |
| 3 | Voice | First instruction is spoken in Italian; "next turn" prompts arrive before the turn; pavé warnings queue, not cut off | missing or late prompts, wrong volume |
| 4 | Pavé | Warning appears before a known pavé stretch; the safe route actually avoids stones you can feel | stones felt on the "safe" route |
| 5 | Tram | Only note whether you cross tram rails: rail layers are not shipped, so tram **avoidance cannot work yet** and is not measured | count of rail crossings |
| 6 | Traffic (only if status is `ok`) | "Traffico live" can be switched on; the note says live data; ETA is not shorter than without traffic | ETA with and without, anything marked "stima" |
| 7 | Deliberate off-route (journey C) | Within ~10 s: "Fuori percorso", then recalculation, then a new line; same pavé preference; time to new route under ~5 s | seconds to new route, preference kept |
| 8 | Tunnel, underpass or covered street | "Segnale debole"/"GPS ripreso" is shown; navigation continues after the signal returns | seconds without fix, recovery |
| 9 | Background and foreground | Lock the phone 30 s, or switch app for a minute, then return: GPS resumes in under 10 s, screen stays on during navigation, voice still works | voice after return (Safari may stay silent), fix recovery time |
| 10 | Airplane mode for 30 s while off-route | Message "sei offline, mantengo l'ultimo percorso", no crash; reroute works once the network is back | behaviour |
| 11 | Arrival | "Sei arrivato a destinazione" spoken and shown within ~30 m of the destination; navigation ends; position is not kept | distance at announcement, false early arrival |

## Record

Use the in-app GPS trace recorder (Diagnostica) for each journey and export the GPX/JSON: it stays on the phone until shared.
Note the time of any failure so it can be matched with the trace.

## Stop conditions

Stop the test and go back to a normal map app if: the route sends you the wrong way into a one-way or closed street, the position
is more than 100 m off for more than a minute, or the app freezes. Safety first; Lastrico is a beta and is not a replacement for
road signs.

## Pass for "GO" after the field test

Fix in under 30 s; no wrong-way instruction; reroute under 5 s keeping the preference; arrival announced correctly; voice works
at least until the first background return; no crash. Anything else is logged as a defect for the next iteration.
