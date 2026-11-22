/**
 * Foreground location follow: show where the person is on the map while the page is open, without starting anything else.
 *
 * It is one more subscriber of the page's single geolocation watch (`lib/gps-watch-hub.ts`), at low accuracy, so following the
 * position, navigating and recording all share one underlying watch. Rules:
 *  - it starts by itself only when the browser already reports the permission as `granted` (and the person has not switched it
 *    off); `prompt`, `denied` and a missing Permissions API wait for a gesture, so the page never raises the permission prompt
 *    on its own;
 *  - a hidden page releases its subscription and a visible one restores exactly one (iOS suspends a hidden page);
 *  - switching it off is remembered across reloads, until a gesture switches it on again; only that preference is stored, never
 *    a coordinate;
 *  - it forwards fixes and changes nothing else: planner endpoints and navigation are never touched here.
 *
 * Pure of any DOM: the page passes the hub, the permission query and the preference storage, so tests drive every case.
 */
import type { GpsWatchHub, HubError, HubPosition } from "./gps-watch-hub.ts";

export const FOLLOW_OFF_PREFERENCE = "lastrico-location-follow-off";

/** `idle` before `connect()`; `waiting` while subscribed and no fix yet; `gesture-required` when the permission is not granted. */
export type FollowStatus = "idle" | "waiting" | "live" | "gesture-required" | "denied" | "unavailable" | "off" | "suspended";

export type PermissionLike = {
  state: PermissionState;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export type FollowDependencies = {
  hub: Pick<GpsWatchHub, "subscribe" | "supported">;
  /** The Permissions API answer for geolocation, or null/undefined/throw when the browser cannot say. */
  queryPermission?: () => Promise<PermissionLike | null | undefined>;
  readOff?: () => boolean;
  writeOff?: (off: boolean) => void;
  onFix: (position: HubPosition) => void;
  onStatus: (status: FollowStatus) => void;
};

const PERMISSION_DENIED = 1;

export class ForegroundFollow {
  private readonly deps: FollowDependencies;
  private leave: (() => void) | null = null;
  private generation = 0;
  private visible = true;
  private off = false;
  private disposed = false;
  /** Bumped by everything that makes an in-flight permission answer obsolete. */
  private epoch = 0;
  private permission: PermissionLike | null = null;
  private status: FollowStatus = "idle";

  constructor(deps: FollowDependencies) {
    this.deps = deps;
  }

  /** Whether this follow holds a subscription on the hub right now. */
  get subscribed() { return this.leave !== null; }
  /** Whether the person switched it off (remembered across reloads). */
  get isOff() { return this.off; }
  get current() { return this.status; }

  /** Reads the remembered preference, then decides from the permission whether to start. */
  async connect() {
    if (this.disposed) return;
    try { this.off = this.deps.readOff?.() ?? false; } catch { /* Blocked storage: the in-memory value stays authoritative. */ }
    if (this.off) { this.emit("off"); return; }
    await this.refresh();
  }

  /** Re-reads the permission and starts or releases the subscription accordingly. Cheap to call; stale answers are dropped. */
  async refresh(): Promise<void> {
    if (this.disposed || this.off || !this.visible) return;
    const epoch = ++this.epoch;
    let permission: PermissionLike | null = null;
    try { permission = (await this.deps.queryPermission?.()) ?? null; } catch { /* Permissions API missing or refusing "geolocation". */ }
    if (this.disposed || this.off || !this.visible || epoch !== this.epoch) return;
    if (permission !== this.permission) {
      this.permission?.removeEventListener?.("change", this.onPermissionChange);
      this.permission = permission;
      this.permission?.addEventListener?.("change", this.onPermissionChange);
    }
    if (permission?.state === "granted") this.ensureSubscribed();
    else {
      this.release();
      this.emit(permission?.state === "denied" ? "denied" : "gesture-required");
    }
  }

  /** A tap on a location control: clears the remembered "off" and starts, whatever the permission says (the browser may ask). */
  startFromGesture() {
    if (this.disposed) return;
    this.epoch += 1;
    this.setOff(false);
    this.ensureSubscribed();
  }

  /** The explicit switch-off: remembered, and the subscription is released. */
  switchOff() {
    if (this.disposed) return;
    this.epoch += 1;
    this.setOff(true);
    this.release();
    this.emit("off");
  }

  /** The page became hidden (release) or visible again (restore one). */
  setVisible(visible: boolean) {
    if (this.disposed || visible === this.visible) return;
    this.visible = visible;
    this.epoch += 1;
    if (!visible) {
      this.release();
      if (!this.off) this.emit("suspended");
    } else if (!this.off) {
      void this.refresh();
    }
  }

  dispose() {
    this.disposed = true;
    this.epoch += 1;
    this.release();
    this.permission?.removeEventListener?.("change", this.onPermissionChange);
    this.permission = null;
  }

  private readonly onPermissionChange = () => {
    if (this.disposed || this.off || !this.visible) return;
    void this.refresh();
  };

  private ensureSubscribed() {
    if (this.disposed || this.off || !this.visible || this.leave) return;
    if (!this.deps.hub.supported) { this.emit("unavailable"); return; }
    this.emit("waiting");
    // Callbacks of a subscription that was released (or replaced) must never reach the page, even if the hub calls back
    // synchronously, before `subscribe` has returned.
    const generation = ++this.generation;
    const current = () => generation === this.generation && !this.disposed && !this.off && this.visible;
    const leave = this.deps.hub.subscribe({
      highAccuracy: false,
      onFix: (position) => {
        if (!current()) return;
        this.emit("live");
        this.deps.onFix(position);
      },
      onError: (error: HubError) => {
        if (!current()) return;
        if (error.code === PERMISSION_DENIED) {
          this.release();
          this.emit("denied");
        } else {
          // A timeout or a lost signal is transient: the browser's watch keeps going and the next fix says "live" again.
          this.emit("unavailable");
        }
      },
    });
    // A synchronous callback (a test double) may already have released, denied or switched off: keep nothing then.
    if (generation !== this.generation || this.disposed || this.off || !this.visible) { leave(); return; }
    this.leave = leave;
  }

  private release() {
    this.generation += 1;
    const leave = this.leave;
    this.leave = null;
    leave?.();
  }

  private setOff(off: boolean) {
    this.off = off;
    try { this.deps.writeOff?.(off); } catch { /* Blocked storage: the in-memory value stays authoritative. */ }
  }

  private emit(status: FollowStatus) {
    if (this.disposed || status === this.status) return;
    this.status = status;
    this.deps.onStatus(status);
  }
}
