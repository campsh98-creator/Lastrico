/** One foreground-only watcher shared by map position and navigation. No coordinate persistence or polling. */
export type ForegroundGpsStatus = "idle" | "requesting" | "live" | "denied" | "unavailable" | "stopped" | "suspended" | "gesture-required";
export type PermissionLike = {
  state: PermissionState;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};
type Dependencies = {
  geolocation?: Pick<Geolocation, "watchPosition" | "clearWatch">;
  queryPermission?: () => Promise<PermissionLike>;
  readStopped?: () => boolean;
  writeStopped?: (stopped: boolean) => void;
  onPosition: (position: GeolocationPosition) => void;
  onStatus: (status: ForegroundGpsStatus, active: boolean) => void;
  onError?: (error: GeolocationPositionError) => void;
};
export const GPS_STOP_PREFERENCE = "lastrico-gps-stopped";

export class ForegroundGps {
  private watch: number | null = null;
  private generation = 0;
  private permissionEpoch = 0;
  private queryJob: Promise<void> | null = null;
  private permission: PermissionLike | null = null;
  private visible = true;
  private stopped = false;
  private navigation = false;
  private recording = false;
  private disposed = false;
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }
  get active() { return this.watch !== null; }
  get isStopped() { return this.stopped; }
  private get highAccuracy() { return this.navigation || this.recording; }

  async connect() {
    try { this.stopped = this.deps.readStopped?.() ?? false; } catch { /* Preference storage may be blocked. */ }
    if (this.stopped) this.emit("stopped");
    else await this.refresh();
  }
  private emit(status: ForegroundGpsStatus, active = this.active) { if (!this.disposed) this.deps.onStatus(status, active); }
  private clear() {
    this.generation += 1;
    const watch = this.watch;
    this.watch = null;
    if (watch !== null) this.deps.geolocation?.clearWatch(watch);
  }
  private invalidateQuery() { this.permissionEpoch += 1; this.queryJob = null; }
  private saveStopped(value: boolean) {
    this.stopped = value;
    try { this.deps.writeStopped?.(value); } catch { /* In-memory stop remains authoritative. */ }
  }
  private permissionChanged = () => {
    if (this.disposed || this.stopped || !this.visible) return;
    if (this.permission?.state === "granted") this.ensureWatch();
    else {
      this.clear();
      this.emit(this.permission?.state === "denied" ? "denied" : "gesture-required");
    }
  };
  async refresh(restart = false): Promise<void> {
    if (this.disposed || this.stopped || !this.visible) return;
    if (this.queryJob) return this.queryJob;
    const epoch = ++this.permissionEpoch;
    const job = (async () => {
      let permission: PermissionLike | null = null;
      try { permission = await this.deps.queryPermission?.() ?? null; } catch { /* Unsupported Permissions API. */ }
      if (this.disposed || this.stopped || !this.visible || epoch !== this.permissionEpoch) return;
      this.permission?.removeEventListener?.("change", this.permissionChanged);
      this.permission = permission;
      this.permission?.addEventListener?.("change", this.permissionChanged);
      if (permission?.state === "granted") {
        if (restart) this.clear();
        this.ensureWatch();
      } else {
        this.clear();
        this.emit(permission?.state === "denied" ? "denied" : "gesture-required");
      }
    })();
    this.queryJob = job;
    try { await job; } finally { if (this.queryJob === job) this.queryJob = null; }
  }
  private ensureWatch() {
    if (this.disposed || this.stopped || !this.visible || this.active) return;
    const geo = this.deps.geolocation;
    if (!geo) { this.emit("unavailable"); return; }
    const generation = ++this.generation;
    this.emit("requesting", true);
    try {
      const watch = geo.watchPosition((position) => {
        if (generation !== this.generation || this.disposed || this.stopped || !this.visible) return;
        this.emit("live", true);
        this.deps.onPosition(position);
      }, (error) => {
        if (generation !== this.generation || this.disposed || this.stopped || !this.visible) return;
        if (error.code === 1) { this.clear(); this.emit("denied", false); }
        else this.emit("unavailable", true);
        this.deps.onError?.(error);
      }, this.highAccuracy
        ? { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
        : { enableHighAccuracy: false, maximumAge: 5000, timeout: 15000 });
      // Browsers deliver asynchronously; also handle synchronous test/polyfill callbacks safely.
      if (generation === this.generation && !this.disposed && !this.stopped && this.visible) this.watch = watch;
      else geo.clearWatch(watch);
    } catch {
      this.clear();
      this.emit("unavailable");
    }
  }
  setNavigation(active: boolean) {
    if (active === this.navigation) return;
    const prevHigh = this.highAccuracy;
    this.navigation = active;
    if (this.active && prevHigh !== this.highAccuracy) { this.clear(); this.ensureWatch(); }
  }
  setRecording(active: boolean) {
    if (active === this.recording) return;
    const prevHigh = this.highAccuracy;
    this.recording = active;
    if (this.active && prevHigh !== this.highAccuracy) { this.clear(); this.ensureWatch(); }
  }
  setVisible(visible: boolean) {
    if (this.disposed) return;
    this.visible = visible;
    if (!visible) {
      this.invalidateQuery();
      this.clear();
      this.emit(this.stopped ? "stopped" : "suspended");
    } else void this.refresh();
  }
  startFromGesture() {
    if (this.disposed) return;
    this.invalidateQuery();
    this.saveStopped(false);
    this.ensureWatch();
  }
  restartFromGesture() { this.clear(); this.startFromGesture(); }
  stop() {
    this.invalidateQuery();
    this.saveStopped(true);
    this.clear();
    this.emit("stopped");
  }
  dispose() {
    this.disposed = true;
    this.invalidateQuery();
    this.clear();
    this.permission?.removeEventListener?.("change", this.permissionChanged);
    this.permission = null;
  }
}
