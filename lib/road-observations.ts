/**
 * PROTOTYPE (implemented and unit-tested, not wired into the API or the routing path): user-generated road observations
 * with provenance, confidence and validation.
 *
 * Principles
 * - An observation is evidence, never a classification. It cannot turn an unknown surface into asphalt, and it cannot lower
 *   the cost of a stretch: observations may only make Lastrico MORE cautious (a warning, a penalty), or ask for a review.
 * - Every observation carries where it came from (channel, device accuracy, an opaque evidence reference), so a cluster can
 *   say how many independent sources agree. No account, no name, no GPS trace: a reporter is an opaque salted hash.
 * - Confidence is computed, shown as a number with its parts, and decays with age.
 */
export type Coordinate = [number, number];

export const OBSERVATION_KINDS = ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data", "rough_ride"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** Where an observation comes from, weakest to strongest. */
export const OBSERVATION_CHANNELS = ["community-report", "gps-roughness", "photo", "imagery-review"] as const;
export type ObservationChannel = (typeof OBSERVATION_CHANNELS)[number];

export type RoadObservation = {
  /** Opaque, unique per observation. */
  id: string;
  kind: ObservationKind;
  /** Where it was seen: a point, or the two ends of a short stretch. */
  start: Coordinate;
  end?: Coordinate;
  /** When it was observed (ISO 8601). */
  observedAt: string;
  provenance: {
    channel: ObservationChannel;
    /** Opaque salted hash of the reporter or device; never a name or an account. */
    reporter: string;
    /** Horizontal accuracy of the position, metres. */
    accuracyMeters: number;
    /** Opaque reference to evidence kept elsewhere (a photo id, an imagery sequence id), if any. */
    evidenceRef?: string;
  };
};

export const OBSERVATION_LIMITS = {
  maxAccuracyMeters: 50,
  maxStretchMeters: 300,
  maxAgeDays: 400,
  futureToleranceMs: 5 * 60_000,
  /** The same reporter repeating the same kind within this distance and time counts once. */
  repeatMeters: 10,
  repeatMs: 10 * 60_000,
  clusterMeters: 35,
  corroborationReporters: 3,
  corroborationDays: 60,
  halfLifeDays: 120,
} as const;

const CHANNEL_WEIGHT: Record<ObservationChannel, number> = {
  "community-report": 0.4,
  "gps-roughness": 0.45,
  photo: 0.7,
  "imagery-review": 0.85,
};

const MILAN_SERVICE_BOX = { west: 8.55, south: 45.1, east: 9.85, north: 45.95 };

function meters(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(latitude), (b[1] - a[1]) * 110_540);
}

function insideService([lon, lat]: Coordinate) {
  return lon >= MILAN_SERVICE_BOX.west && lon <= MILAN_SERVICE_BOX.east && lat >= MILAN_SERVICE_BOX.south && lat <= MILAN_SERVICE_BOX.north;
}

export type ConfidenceParts = { channel: number; accuracy: number; age: number; total: number };

/** Confidence of one observation, 0..0.9, with its parts: channel weight x position accuracy x age decay. */
export function observationConfidence(observation: RoadObservation, now: number): ConfidenceParts {
  const { accuracyMeters, channel } = observation.provenance;
  const accuracy = accuracyMeters <= 15 ? 1 : Math.max(0.2, 1 - (accuracyMeters - 15) / 50);
  const ageDays = Math.max(0, (now - Date.parse(observation.observedAt)) / 86_400_000);
  const age = 0.5 ** (ageDays / OBSERVATION_LIMITS.halfLifeDays);
  const total = Math.min(0.9, CHANNEL_WEIGHT[channel] * accuracy * age);
  return { channel: CHANNEL_WEIGHT[channel], accuracy, age, total };
}

export type Validation =
  | { ok: true; confidence: ConfidenceParts }
  | { ok: false; reason: "unknown-kind" | "unknown-channel" | "bad-time" | "future" | "too-old" | "outside-service-area" | "inaccurate" | "stretch-too-long" | "no-reporter" };

export function validateObservation(observation: RoadObservation, now: number): Validation {
  if (!OBSERVATION_KINDS.includes(observation.kind)) return { ok: false, reason: "unknown-kind" };
  if (!OBSERVATION_CHANNELS.includes(observation.provenance.channel)) return { ok: false, reason: "unknown-channel" };
  if (!observation.provenance.reporter) return { ok: false, reason: "no-reporter" };
  const at = Date.parse(observation.observedAt);
  if (!Number.isFinite(at)) return { ok: false, reason: "bad-time" };
  if (at > now + OBSERVATION_LIMITS.futureToleranceMs) return { ok: false, reason: "future" };
  if (now - at > OBSERVATION_LIMITS.maxAgeDays * 86_400_000) return { ok: false, reason: "too-old" };
  const points = [observation.start, ...(observation.end ? [observation.end] : [])];
  if (!points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && insideService(p))) return { ok: false, reason: "outside-service-area" };
  const accuracy = observation.provenance.accuracyMeters;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > OBSERVATION_LIMITS.maxAccuracyMeters) return { ok: false, reason: "inaccurate" };
  if (observation.end && meters(observation.start, observation.end) > OBSERVATION_LIMITS.maxStretchMeters) return { ok: false, reason: "stretch-too-long" };
  return { ok: true, confidence: observationConfidence(observation, now) };
}

export type ClusterStatus = "unverified" | "corroborated" | "disputed";

export type ObservationCluster = {
  kind: ObservationKind;
  centre: Coordinate;
  observations: number;
  independentReporters: number;
  channels: ObservationChannel[];
  lastObservedAt: string;
  /** Noisy-or of the members' confidences, capped at 0.9. */
  confidence: number;
  status: ClusterStatus;
  /** Why the status is what it is, in words the review queue can show. */
  basis: string;
};

/** What the rest of the system may do with a cluster. Never "make this stretch smoother or asphalt". */
export type ObservationInfluence =
  | { action: "penalise"; reason: string }
  | { action: "warn"; reason: string }
  | { action: "review"; reason: string }
  | { action: "none"; reason: string };

/**
 * Groups valid observations of the same kind within `clusterMeters`, counts INDEPENDENT reporters (the same reporter
 * repeating a kind in the same place and minutes counts once), and marks a cluster corroborated only with enough reporters
 * inside the corroboration window or one imagery review. Invalid observations are skipped and counted by reason.
 */
export function aggregateObservations(observations: RoadObservation[], now: number) {
  const skipped: Record<string, number> = {};
  const accepted: { observation: RoadObservation; confidence: number }[] = [];
  const seen: RoadObservation[] = [];
  for (const observation of observations) {
    const validation = validateObservation(observation, now);
    if (!validation.ok) { skipped[validation.reason] = (skipped[validation.reason] ?? 0) + 1; continue; }
    const repeat = seen.some((other) => other.provenance.reporter === observation.provenance.reporter && other.kind === observation.kind
      && meters(other.start, observation.start) <= OBSERVATION_LIMITS.repeatMeters
      && Math.abs(Date.parse(other.observedAt) - Date.parse(observation.observedAt)) <= OBSERVATION_LIMITS.repeatMs);
    if (repeat) { skipped.repeat = (skipped.repeat ?? 0) + 1; continue; }
    seen.push(observation);
    accepted.push({ observation, confidence: validation.confidence.total });
  }
  const groups: { kind: ObservationKind; members: typeof accepted }[] = [];
  for (const entry of accepted) {
    const group = groups.find((g) => g.kind === entry.observation.kind
      && g.members.some((m) => meters(m.observation.start, entry.observation.start) <= OBSERVATION_LIMITS.clusterMeters));
    if (group) group.members.push(entry); else groups.push({ kind: entry.observation.kind, members: [entry] });
  }
  const windowMs = OBSERVATION_LIMITS.corroborationDays * 86_400_000;
  const clusters: ObservationCluster[] = groups.map(({ kind, members }) => {
    const reporters = new Set(members.map((m) => m.observation.provenance.reporter));
    const recent = new Set(members.filter((m) => now - Date.parse(m.observation.observedAt) <= windowMs).map((m) => m.observation.provenance.reporter));
    const reviewed = members.some((m) => m.observation.provenance.channel === "imagery-review");
    const corroborated = reviewed || recent.size >= OBSERVATION_LIMITS.corroborationReporters;
    const confidence = Math.min(0.9, 1 - members.reduce((p, m) => p * (1 - m.confidence), 1));
    return {
      kind,
      centre: [members.reduce((s, m) => s + m.observation.start[0], 0) / members.length, members.reduce((s, m) => s + m.observation.start[1], 0) / members.length] as Coordinate,
      observations: members.length,
      independentReporters: reporters.size,
      channels: [...new Set(members.map((m) => m.observation.provenance.channel))],
      lastObservedAt: new Date(Math.max(...members.map((m) => Date.parse(m.observation.observedAt)))).toISOString(),
      confidence: Math.round(confidence * 100) / 100,
      status: corroborated ? "corroborated" as const : "unverified" as const,
      basis: reviewed ? "rivista su immagini" : corroborated
        ? `${recent.size} segnalatori indipendenti negli ultimi ${OBSERVATION_LIMITS.corroborationDays} giorni`
        : `${reporters.size} segnalatore/i: servono ${OBSERVATION_LIMITS.corroborationReporters} indipendenti o una revisione su immagini`,
    };
  });
  // Opposing claims about the same place (rough vs recently asphalted) are disputed: neither is believed.
  const rough = clusters.filter((c) => c.kind === "pave" || c.kind === "rough_cobblestone" || c.kind === "rough_ride");
  for (const roughCluster of rough) {
    for (const smooth of clusters.filter((c) => c.kind === "recently_asphalted")) {
      if (meters(roughCluster.centre, smooth.centre) > OBSERVATION_LIMITS.clusterMeters) continue;
      roughCluster.status = smooth.status = "disputed";
      roughCluster.basis = smooth.basis = "segnalazioni opposte nello stesso punto: nessuna è creduta";
    }
  }
  return { clusters, skipped };
}

/**
 * The only effects a cluster may have. A rough-surface claim can add caution once corroborated (and is flagged for review
 * when the map says the stretch is smooth); a "recently asphalted" or smooth claim can never reduce a penalty, remove a
 * warning or turn an unknown surface into asphalt: it only opens a review.
 */
export function observationInfluence(cluster: ObservationCluster, mapSurface: "cobblestone" | "asphalt" | "other" | "unknown"): ObservationInfluence {
  if (cluster.status === "disputed") return { action: "review", reason: cluster.basis };
  if (cluster.kind === "wrong_data") return { action: "review", reason: "segnalato come dato errato" };
  if (cluster.kind === "recently_asphalted") return { action: "review", reason: "una segnalazione di asfalto nuovo non riduce mai una penalità" };
  if (cluster.status !== "corroborated") return { action: "warn", reason: `non confermata: ${cluster.basis}` };
  return mapSurface === "asphalt" || mapSurface === "unknown"
    ? { action: "penalise", reason: `fondo ruvido segnalato (${cluster.basis}); la mappa dice ${mapSurface === "asphalt" ? "asfalto" : "sconosciuto"}: da rivedere` }
    : { action: "penalise", reason: `fondo ruvido confermato dalle segnalazioni (${cluster.basis})` };
}
