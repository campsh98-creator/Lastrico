# Source log - smartphone sensing feasibility (Phase 4.36, Agent 6)

Budget: at most 15 web fetches/searches. **Used: 15.** Retrieval date for every entry: **2026-11-14** (clock time of day not recorded).
No personal, project or trace-derived data appeared in any request: URLs and prompts name only public documents. Nothing was
downloaded to disk by me (the fetch tool saved one 63 KB response for entry 7 under its own tool-results folder).
Label in the last column is what the entry supports in the report: V = VERIFIED primary text read; S = secondary/search summary; X = failed.

| # | Tool | URL / query | Result | Used for |
|---|---|---|---|---|
| 1 | WebFetch | https://www.w3.org/TR/orientation-event/ | OK, first 100,000 of 115,183 chars read. W3C Candidate Recommendation Draft **26 October 2026**: `interval` in ms and constant; no numeric event rate ("implementation-defined"); `requestPermission()` rejects with NotAllowedError without transient activation; secure context only; events not fired unless the document is visible; acceleration rounded to 0.1 m/s^2, rotation rate 0.1 deg/s | V |
| 2 | WebFetch | https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor | OK. Sensors list (Accelerometer, Gyroscope, LinearAccelerationSensor, ...); `frequency` option (example 60); "Sensor readings are only accessible by a visible web page"; secure context; no maximum rate stated; no timestamp base stated; no last-updated date | V |
| 3 | WebFetch | https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview | OK, whole page. Android 12+ (targetSdk 31): `registerListener` capped at **200 Hz** unless `HIGH_SAMPLING_RATE_SENSORS`; direct channel ~50 Hz; cap applies even with the permission if microphone toggle is off; **Android 9+: continuous sensors (accelerometer, gyroscope) deliver no events to background apps**; "system will not disable sensors automatically when the screen turns off"; unregistered listeners "can drain the battery in just a few hours"; the delay is only a hint, no public method to read the true rate, use timestamps | V |
| 4 | WebFetch | https://developer.apple.com/documentation/coremotion/cmmotionmanager | **X**: page body is JavaScript-rendered; only the title returned. Nothing from this page is used as a fact; the tool's general-knowledge remarks are discarded. iOS native rate ceiling, Core Motion timestamps and background behaviour stay UNVERIFIED | X |
| 5 | WebSearch | Screen Wake Lock API iOS home screen web app standalone PWA fixed iOS 18.4 WebKit bug 254545 | Result list + summary (secondary). Points to WebKit bug 254545 RESOLVED FIXED and a later bug saying "resolved in iOS 18.4"; MDN table lists Safari 16.4-18.4 with a "does not work in standalone" note, possibly stale | S |
| 6 | WebFetch | https://www.w3.org/TR/geolocation/ | OK, first 100,000 of 128,657 chars. CRD dated **05 November 2026**. `accuracy` = metres at **68 % confidence level (one standard deviation)**; `speed` m/s or null; `heading` null when stationary; `timestamp` = time the position was acquired; secure context, express permission | V |
| 7 | WebFetch | https://developer.android.com/reference/android/location/Location | OK (63 KB saved by the tool, searched with Grep). `getAccuracy()` = horizontal accuracy radius at the **68th percentile**; `getElapsedRealtimeNanos()` = fix time since boot | V |
| 8 | WebFetch | https://bugs.webkit.org/show_bug.cgi?id=254545 | OK. "New Wake Lock API does not work in Home Screen Web Apps": RESOLVED FIXED; reported 2023-03-27; Apple (Jen Simmons) said on 2025-03-31 it works in Home Screen web apps in **iOS/iPadOS 18.4**; iOS 16.4-18.3.1 did not; thread does not state whether the lock survives a locked screen; a related bug (255363) reports failure to re-acquire the lock after switching away | V |
| 9 | WebFetch | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-12020-processing-personal-data-context_en | **X**: HTTP 404 | X |
| 10 | WebSearch | smartphone accelerometer road roughness IRI estimation accuracy crowdsourced systematic review correlation vehicle speed phone placement | Result list + summary (secondary): individual studies (Springer s42947-021-00069-3; ASCE Journal of Infrastructure Systems "Study of the Factors Affecting Road Roughness Measurement Using Smartphones"; UCL Bartlett "evaluating smartphone-based road roughness estimation systems in an urban area"; a Monash/ARRB test of three commercial systems). Finds: speed raises RMS/variance and speed normalisation reduces it; suspension, placement, speed and vehicle matter; smartphone accuracy varies by device and vehicle; **no systematic review or pooled accuracy figure was found**. Articles themselves were not read | S |
| 11 | WebFetch | https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm | OK. iOS WebKit **polls** Core Motion with a repeating `NSTimer` (no handler push) and reads `deviceMotion` (accelerometer fallback); `kGravity = 9.80665`; `rad2deg`; "no rounding or smoothing" in this file; no suspend handling in this file | V |
| 12 | WebFetch | https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/device_orientation/device_sensor_event_pump.h | OK. `static constexpr int kDefaultPumpFrequencyHz = 60;` ("Default rate for firing events") | V |
| 13 | WebFetch | https://www.edpb.europa.eu/system/files/2021-03/edpb_guidelines_202001_connected_vehicles_v2.0_adopted_en.pdf | **X**: HTTP 404 (URL guessed) | X |
| 14 | WebFetch | https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/ios/WebCoreMotionManager.h | OK. `constexpr float kMotionUpdateInterval = 1.0f / 60.0f;` | V |
| 15 | WebFetch | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 (offset 100000) | **X**: empty page text. GDPR article text was therefore **not** read in this session; every GDPR statement in the report is UNVERIFIED against the primary text and is a design principle to be confirmed by the owner's legal adviser | X |

## Claims inherited from Phase 4.20 (retrieved 2026-11-05, NOT re-retrieved on 2026-11-14, so UNVERIFIED for this phase's rule)

From `experiments/roughness-sensors/ios-permissions.md`: iOS permission cached per top-level origin in memory and re-asked on a new
browser process (S6c); WebKit suspends motion updates when active DOM objects are suspended (S6f); home-screen PWA has a separate web-data
store (inferred); Generic Sensor API absent in Safari (S8, S10); Chromium Generic Sensor `kMaxAllowedFrequency = 60` (S9); Chromium
`requestPermission()` shipped (S7); `event.interval` in WebKit iOS is passed as 1/60 and so reads about 0.0167 (S6d); Apple energy guide
statements on interval and location power (S12); `NSMotionUsageDescription` and App Privacy label rules (S13, S14); the speed-adaptive
road-surface paper (PMC7013573) and Douangphachanh & Oneyama. They are cited in the report as "inherited" and carry the UNVERIFIED mark
unless entries 1-15 above confirm them.

## Not searched (budget) and therefore UNVERIFIED

Battery and thermal measurements for continuous IMU + GPS recording; iOS native `CMMotionManager` rates; Android `SensorEvent.timestamp` base;
Screen Wake Lock release on hidden page; Safari/Chrome behaviour of a locked screen in a home-screen app; GDPR/ePrivacy article text; EDPB or Garante
guidance; ISO 8608 numeric class limits and ISO 2631 / ISO 5349 exposure limits; ICC interpretation bands (Koo and Li 2016); tram gauge and rail
geometry in Milan; store fees for a native app; names/versions of free native sensor-logger apps.
