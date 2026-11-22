/**
 * The one geolocation watch of the page.
 *
 * Navigation and the independent GPS recorder both need a stream of fixes. Each used to call `watchPosition` itself, so recording
 * while navigating opened two watches (twice the battery, two permission lifecycles, two places to renew after iOS stalls one).
 * Everything that wants fixes now subscribes here: one underlying watch exists while at least one subscriber does, it uses high
 * accuracy as soon as any subscriber asks for it, `renew()` replaces it (iOS can silently stall a long-lived watch), and it is
 * cleared when the last subscriber leaves. This is the only place in the app that calls `watchPosition`.
 *
 * Foreground only, no storage, no network: it forwards what the browser gives it.
 */
export type HubPosition = Pick<GeolocationPosition, "timestamp"> & {
  coords: Pick<GeolocationCoordinates, "latitude" | "longitude" | "accuracy" | "heading" | "speed">;
};
/** The browser's own error object, so callers keep reading `error.code === error.PERMISSION_DENIED`. */
export type HubError = GeolocationPositionError;

export type HubSubscriber = {
  onFix: (position: HubPosition) => void;
  onError?: (error: HubError) => void;
  /** The subscriber needs the best fix the device can give (navigation and recording both do). */
  highAccuracy?: boolean;
};

type Geo = Pick<Geolocation, "watchPosition" | "clearWatch">;

/** What navigation has always asked for; recording shares it. */
export const HIGH_ACCURACY_WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 1_500, timeout: 12_000 } as const;
export const LOW_ACCURACY_WATCH_OPTIONS = { enableHighAccuracy: false, maximumAge: 5_000, timeout: 15_000 } as const;
const PERMISSION_DENIED = 1;

export class GpsWatchHub {
  private readonly geolocation: () => Geo | undefined;
  private readonly subscribers = new Set<HubSubscriber>();
  private watchId: number | null = null;
  private watchIsHighAccuracy = false;
  /** Callbacks of a watch that was replaced or cleared must not reach anybody. */
  private generation = 0;

  constructor(geolocation: () => Geo | undefined) {
    this.geolocation = geolocation;
  }

  /** Subscribers right now. */
  get size() { return this.subscribers.size; }
  /** Whether an underlying watch exists. */
  get active() { return this.watchId !== null; }
  get supported() { return Boolean(this.geolocation()); }

  /** Adds a subscriber and starts the shared watch if it is not running. Returns the function that removes it again. */
  subscribe(subscriber: HubSubscriber): () => void {
    const entry: HubSubscriber = { ...subscriber };
    this.subscribers.add(entry);
    if (this.watchId === null) this.arm();
    else if (entry.highAccuracy && !this.watchIsHighAccuracy) this.arm();
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.subscribers.delete(entry);
      if (this.subscribers.size === 0) this.disarm();
      else if (this.watchIsHighAccuracy && !this.needsHighAccuracy()) this.arm();
    };
  }

  /** Replaces the underlying watch with a fresh one (what a stalled iOS watch needs). Does nothing without subscribers. */
  renew() {
    if (this.subscribers.size > 0) this.arm();
  }

  private needsHighAccuracy() {
    for (const subscriber of this.subscribers) if (subscriber.highAccuracy) return true;
    return false;
  }

  private disarm() {
    this.generation += 1;
    const id = this.watchId;
    this.watchId = null;
    this.watchIsHighAccuracy = false;
    if (id !== null) this.geolocation()?.clearWatch(id);
  }

  private arm() {
    this.disarm();
    const geolocation = this.geolocation();
    if (!geolocation) return;
    const generation = this.generation;
    const high = this.needsHighAccuracy();
    const id = geolocation.watchPosition(
      (position) => {
        if (generation !== this.generation) return;
        this.deliver((subscriber) => subscriber.onFix(position));
      },
      (error) => {
        if (generation !== this.generation) return;
        // A denied permission ends the browser's watch: forget it, so the next renew() or subscriber asks again.
        if (error.code === PERMISSION_DENIED) {
          this.generation += 1;
          const dead = this.watchId;
          this.watchId = null;
          this.watchIsHighAccuracy = false;
          if (dead !== null) this.geolocation()?.clearWatch(dead);
        }
        this.deliver((subscriber) => subscriber.onError?.(error));
      },
      high ? { ...HIGH_ACCURACY_WATCH_OPTIONS } : { ...LOW_ACCURACY_WATCH_OPTIONS },
    );
    // Browsers answer asynchronously; a synchronous callback (tests, polyfills) may already have ended this generation.
    if (generation === this.generation) {
      this.watchId = id;
      this.watchIsHighAccuracy = high;
    } else geolocation.clearWatch(id);
  }

  /** Subscribers may unsubscribe from inside their callback, so iterate over a copy; one failing subscriber never starves the rest. */
  private deliver(call: (subscriber: HubSubscriber) => void) {
    for (const subscriber of [...this.subscribers]) {
      if (!this.subscribers.has(subscriber)) continue;
      try { call(subscriber); } catch (error) { setTimeout(() => { throw error; }); }
    }
  }
}

/** The page's hub. `navigator.geolocation` is looked up on every call, so a test double or a polyfill installed later is honoured. */
export const gpsWatchHub = new GpsWatchHub(() => (typeof navigator === "undefined" ? undefined : navigator.geolocation));
