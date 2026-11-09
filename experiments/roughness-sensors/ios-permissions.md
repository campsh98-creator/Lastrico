# Motion-sensor access from the web on iOS/iPadOS (and how other platforms differ)

Phase 4.20, Agent C. Research date: 2026-11-05. No physical iPhone was available and the iOS
Simulator is not installed on this machine (and would not help: WebKit sends empty motion values
on the Simulator, see §6). Nothing below was tested on a real device.

Confidence markers:

- **[verified]**: read on a primary source (W3C spec, WebKit source or bug tracker, Apple or
  Chromium documentation/source). The source is listed.
- **[inferred]**: follows from primary sources but was not observed on a device.
- **[untested]**: plausible or community-reported; needs a device test.

## 1. Summary for Lastrico

| Question | Answer | Confidence |
|---|---|---|
| Does iOS Safari need an explicit permission call? | Yes. Since iOS/iPadOS 13 pages must call `DeviceMotionEvent.requestPermission()` (or the orientation one) before motion events fire, in Safari and SFSafariViewController. | verified [S2, S3] |
| Must it come from a user gesture? | Yes, while the state is still "prompt". Without transient activation the promise is rejected with `NotAllowedError` ("Requesting device motion access requires a user gesture to prompt"). | verified [S1, S6a] |
| Secure context? | Required. On an insecure page WebKit **resolves `"denied"` without prompting** and logs "Browsing context is not secure". `http://localhost` is a secure context on desktop, but a phone opening `http://<lan-ip>` is not, so phone tests need HTTPS. | verified [S1, S6b] |
| One prompt for motion and orientation? | Yes, inferred. WebKit stores one decision per top-level origin for both APIs. | inferred [S6c] |
| Persistence of the grant | Cached per top-level origin in an **in-memory** map of the web-data store, cleared by `clearPermissions()`. Reloads reuse it; a new browser process (and likely a relaunched home-screen app) asks again. WKWebView apps re-prompt on every launch (WebKit bug 213468, still open). | inferred [S6c, S5]; untested on device |
| If denied | Later `requestPermission()` calls resolve `"denied"` without a prompt for that origin while the cached decision lasts. `devicemotion` listeners receive nothing, and WebKit only logs a console warning. The page cannot re-ask. The user has to clear the decision (relaunch Safari / clear website data). | verified for the code path [S6b, S6c]; how a user resets it on device is untested |
| Home-screen PWA (standalone) | Same WebKit code path. A separate web-data store from Safari is likely, so a grant given in Safari probably does not carry over. | inferred / untested |
| In-app WebViews | WKWebView was originally exempt (no prompt needed, 2019). Since iOS 15 the host app can decide through `WKUIDelegate webView:requestDeviceOrientationAndMotionPermissionForOrigin:…`. Behaviour depends on the host app (Instagram, Facebook, Telegram…). SFSafariViewController shows the Safari prompt. | verified [S4, S6e]; behaviour of specific apps untested |
| Sampling rate | WebKit on iOS polls Core Motion with an `NSTimer` at **1/60 s**, so about 60 Hz, timer-jittered, with possible stale repeats. There is no anti-alias guarantee: the browser hands over the latest fused sample. | verified in source [S6d]; jitter magnitude untested |
| `event.interval` | Spec: milliseconds, constant. WebKit iOS passes `kMotionUpdateInterval` = `1.0f/60.0f`, so it reports **≈0.0167 (seconds)**, not 16.7. Do not trust it; measure the rate from `event.timeStamp`. | verified in source [S1, S6d]; untested on device |
| Units | `acceleration` / `accelerationIncludingGravity` in m/s² (WebKit multiplies Core Motion g by 9.80665); `rotationRate` in deg/s (WebKit converts rad/s with `rad2deg`). The spec asks for rounding to 0.1 m/s² and 0.1 deg/s; no rounding appears in the WebKit iOS path read here. | verified [S1, S6d] |
| Sign convention | WebKit sums Core Motion `userAcceleration + gravity`. Core Motion gravity points toward the Earth, so `accelerationIncludingGravity` at rest should have the **opposite sign** to the W3C example (z ≈ −9.81 face-up). The analysis is sign-agnostic by design (tested on synthetic data). | inferred [S6d]; untested |
| Background / locked screen | Events stop. The spec fires events only to visible documents. WebKit iOS suspends motion updates whenever the page's active DOM objects are suspended (backgrounded tab or app). A locked screen hides the page. Recording therefore has gaps, and the prototype logs `page-hidden` events. | verified [S1, S6f]; lock-screen behaviour inferred |
| Generic Sensor API (`Accelerometer`, `Gyroscope`, `LinearAccelerationSensor`) | Not in Safari (macOS or iOS). Chromium only (Chrome 67+). | verified [S8, S10] |
| Permissions-Policy for iframes | Spec features `accelerometer`, `gyroscope`, `magnetometer` (default allowlist `'self'`). WebKit checks Gyroscope+Accelerometer for motion (plus Magnetometer for orientation). A cross-origin iframe needs `allow="accelerometer; gyroscope"`. MDN data lists the HTTP *header* as unsupported in Safari, so rely on the iframe `allow` attribute and same-origin pages. | verified [S1, S6b, S8]; header behaviour untested |
| App Store / privacy label (only if wrapped natively) | Raw `CMMotionManager` is not in the list of APIs that require `NSMotionUsageDescription` (those are CMSensorRecorder, CMPedometer, CMMotionActivityManager, CMMovementDisorderManager). Data processed only on the device is "not collected" for App Privacy labels. Uploading derived roughness would need disclosure (closest type: "Other Data"; plus Location if positions are sent). | verified [S13, S14]; label category inferred |

## 2. Implementation rules derived for the prototype

1. Call `DeviceMotionEvent.requestPermission()` **synchronously as the first thing in the click
   handler**, before any `await` (test `prototype.test.mjs` enforces this statically).
2. Feature-detect it (`typeof DeviceMotionEvent.requestPermission === "function"`). Otherwise
   listen directly (Android Chrome, Firefox).
3. Treat `"denied"` as possibly meaning "insecure context" too, and show `isSecureContext`.
4. Never rely on `event.interval`. Compute the rate from timestamps and keep the raw value for
   diagnostics (the prototype reports the unit it appears to use).
5. Record gaps honestly: `visibilitychange` → event in the trace. The analysis splits runs at gaps.
6. Ask for GPS separately (its own consent and system prompt). Default to **speed-only**:
   coordinates are dropped at ingestion.
7. Request only motion (not orientation): gravity direction is estimated from acceleration, so
   the compass/magnetometer is never needed.

## 3. Android / Chromium differences

- `devicemotion` is delivered at a fixed **60 Hz** (`kDefaultPumpFrequencyHz = 60`). The Generic Sensor
  maximum for motion sensors is also 60 Hz (`kMaxAllowedFrequency = 60.0`). [verified, S9]
- Chromium shipped a `requestPermission()` that **reports already-set permissions without
  prompting** (Intent to Ship, Oct 2023, target M121). Access is granted by default. MDN compat
  data lists Chrome 152 for this method. [verified, S7, S8] In this session's desktop Chromium
  browser pane, `DeviceMotionEvent.requestPermission` existed and resolved `"denied"` on a
  machine without motion hardware (observed, desktop only).
- The Generic Sensor API is available in Chromium (secure context, visible and focused document;
  readings stop when hidden). [verified, S10, S11]
- Firefox: `DeviceMotionEvent` supported, no `requestPermission` (MDN compat data). [verified S8; untested]

## 4. Battery, CPU, thermal (qualitative)

- Apple: "The larger the interval, the fewer events are delivered to your app, improving battery
  life". Stop updates when not needed so the hardware can power down. [verified, S12a] The
  browser fixes the interval at 1/60 s. A page cannot lower it, only stop listening.
- Location is the larger cost: higher accuracy "causes Core Location to power up additional
  hardware". [verified, S12b] The prototype makes GPS optional and off by default.
- The dominant cost of a web recording is likely the **screen that must stay on** (the page must be
  visible) plus GPS. Main-thread JS for ~60 events/s is small. Analysis cost measured on a
  desktop (Apple M1, Node 24): ~74 ms for a 10-minute trip, i.e. ~7 ms per minute of data. Even
  10× slower on a phone this is negligible. [measured on desktop; phone estimate inferred]
- Thermal: a phone on a sunny dashboard with screen, GPS and charging is a known throttling case.
  It is not measured here. [untested]

## 5. Physics consequence of 60 Hz (key for the product question)

Sett joints excite the wheel at f = v / pitch. With pitch 0.10–0.20 m and 60 Hz sampling
(Nyquist 30 Hz, analysis band ≤ 27 Hz) the joint frequency is resolvable only below about
**v ≈ 3 m/s (11 km/h)**. At city driving speeds it aliases, and the 1–2 ms timer jitter smears it.
Above that speed the analysis can only see *sustained vibration energy*. It cannot tell pavé
from other sustained rough surfaces (degraded asphalt, gravel, tram-track joints). The synthetic
confounder test demonstrates this. [inferred from S6d + sampling theory; demonstrated on synthetic data]

## 6. Sources

- **S1**: W3C, *Device Orientation and Motion*, Candidate Recommendation Draft, 26 Oct 2026, <https://www.w3.org/TR/orientation-event/> (requestPermission algorithm and NotAllowedError, `[SecureContext]`, permissions-policy features and `'self'` default, units, rounding to 0.1, `interval` in ms, events only for visible documents).
- **S2**: WebKit blog, *New WebKit Features in Safari 13*, <https://webkit.org/blog/9674/new-webkit-features-in-safari-13/> ("Developers will now need to call DeviceMotionEvent.requestPermission() or DeviceOrientationEvent.requestPermission()", Safari and Safari View Controller on iOS/iPadOS).
- **S3**: WebKit Bugzilla 201676 (closed INVALID, Chris Dumez, 2019-09-17): request permission "with a user interaction", <https://bugs.webkit.org/show_bug.cgi?id=201676>.
- **S4**: WebKit Bugzilla 203287 (FIXED r253343, 2019-12-10): WKWebView exempt at the time, SVC prompts, secure context needed, WKUIDelegate workaround, <https://bugs.webkit.org/show_bug.cgi?id=203287>.
- **S5**: WebKit Bugzilla 213468 "WKWebView doesn't remember motion permission" (NEW), <https://bugs.webkit.org/show_bug.cgi?id=213468>.
- **S6**: WebKit source, `main` branch, read 2026-11-05 via <https://github.com/WebKit/WebKit>:
  - a. `Source/WebCore/dom/DeviceMotionEvent.cpp`: `requestPermission` (denied when not allowed, NotAllowedError without gesture).
  - b. `Source/WebCore/page/LocalDOMWindow.cpp`: `isAllowedToUseDeviceMotionOrOrientation` (secure context), Permissions Policy checks, no events plus console warning without permission.
  - c. `Source/WebCore/dom/DeviceOrientationAndMotionAccessController.cpp` and `Source/WebKit/UIProcess/WebsiteData/WebDeviceOrientationAndMotionAccessController.{h,cpp}`: per-origin `HashMap<SecurityOriginData,bool>`, prompt queue, `clearPermissions()`.
  - d. `Source/WebCore/platform/ios/WebCoreMotionManager.{h,mm}` (`kMotionUpdateInterval = 1.0f / 60.0f`, NSTimer polling, `kGravity = 9.80665`, `rad2deg`) and `Source/WebCore/platform/ios/DeviceMotionClientIOS.mm` (interval = `kMotionUpdateInterval`; on `PLATFORM(IOS_FAMILY_SIMULATOR)` the values are empty).
  - e. `Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h`: `requestDeviceOrientationAndMotionPermissionForOrigin`, `WK_API_AVAILABLE(ios(15.0))`.
  - f. `Source/WebCore/dom/Document.cpp`: `suspendActiveDOMObjects` → `suspendDeviceMotionAndOrientationUpdates` (iOS).
- **S7**: Chromium blink-dev, *Intent to Ship: Implement requestPermission() for DeviceOrientationEvent and DeviceMotionEvent* (Oct 2023), <https://groups.google.com/a/chromium.org/g/blink-dev/c/jy6QmMeV9gY>.
- **S8**: MDN: <https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static>, <https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/interval>. MDN browser-compat-data (`api/DeviceMotionEvent.json`, `api/Accelerometer.json`, `http/headers/Permissions-Policy.json`), <https://github.com/mdn/browser-compat-data>. Note: BCD lists Safari iOS **14.5** for `requestPermission`, which conflicts with the WebKit Safari 13 announcement (S2). We trust S2 for the introduction date.
- **S9**: Chromium source: `third_party/blink/renderer/modules/device_orientation/device_sensor_event_pump.h` (`kDefaultPumpFrequencyHz = 60`), `services/device/public/cpp/generic_sensor/sensor_traits.h` (`kMaxAllowedFrequency = 60.0`), <https://chromium.googlesource.com/chromium/src/>.
- **S10**: Chrome for Developers, *Sensors for the web*, <https://developer.chrome.com/docs/capabilities/web-apis/generic-sensor>.
- **S11**: W3C, *Generic Sensor API*, CRD 14 May 2026, <https://www.w3.org/TR/generic-sensor/>.
- **S12**: Apple, *Energy Efficiency Guide for iOS Apps* (archived): a. <https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/MotionBestPractices.html>, b. <https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/LocationBestPractices.html>. Also `CMMotionManager` / `deviceMotionUpdateInterval` (interval capped to hardware limits; check timestamps for the true interval), <https://developer.apple.com/documentation/coremotion/cmmotionmanager>.
- **S13**: Apple, `NSMotionUsageDescription`, <https://developer.apple.com/documentation/bundleresources/information-property-list/nsmotionusagedescription>.
- **S14**: Apple, *App privacy details on the App Store*, <https://developer.apple.com/app-store/app-privacy-details/> (definition of "collect"; on-device-only processing is not collected).
- Background (not reviewed in depth, cited for context on speed dependence): Sensors 2020 speed-adaptive road-surface recognition, <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7013573/>. Douangphachanh & Oneyama, EASTS proceedings, <https://easts.info/on-line/proceedings/vol9/PDF/P297.pdf>.
