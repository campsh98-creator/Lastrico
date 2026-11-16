-- Lastrico Surface Intelligence Layer - Cloudflare D1 (SQLite) DDL, experimental 0.1.0.
-- Phase 4.36 DESIGN artefact: not a Drizzle migration, not applied anywhere (tests run it in an in-memory node:sqlite database).
-- ROLE OF D1 IN THE HYBRID: intake and review workspace ONLY. It is NEVER read while computing a route (no D1 query on the
-- /api/routes path), so routes stay reproducible from versioned static tiles. An offline Node export turns accepted rows
-- into ledger evidence (fixture.sil.json shape). The existing road_reports table (db/schema.ts) is left untouched.
-- PRIVACY BY CONSTRUCTION: no raw coordinates, no free text, no nickname, no IP, no user or device id, no GPS trace table.
-- Free-plan limits used for sizing (fetched 2026-11-14): 100,000 rows written/day, 5,000,000 rows read/day, 500 MB per database,
-- 50 queries per invocation (a db.batch() counts once), 100 bound parameters per query.

CREATE TABLE sil_dataset_release (
  dataset_version          TEXT PRIMARY KEY,                       -- e.g. sil-milan-2026-11-14.1
  area                     TEXT NOT NULL CHECK (area IN ('milan','roccella','rome')),
  manifest_sha256          TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  ledger_sha256            TEXT NOT NULL CHECK (length(ledger_sha256) = 64),
  base_tiles_sha256        TEXT NOT NULL CHECK (length(base_tiles_sha256) = 64),
  policy_version           TEXT NOT NULL,
  previous_dataset_version TEXT REFERENCES sil_dataset_release (dataset_version),
  mode                     TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off','shadow','on')),
  status                   TEXT NOT NULL DEFAULT 'built' CHECK (status IN ('built','published','rolled_back')),
  created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Coarse, consented, moderated report evidence from the public report flow (snapped to way + 25 m bucket by the export/snap script).
CREATE TABLE sil_report_intake (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  way_id          INTEGER NOT NULL CHECK (way_id > 0),
  bucket_from_m   INTEGER NOT NULL CHECK (bucket_from_m >= 0 AND bucket_from_m % 25 = 0),
  topic           TEXT NOT NULL CHECK (topic IN ('surface_material','physical_roughness','rails_presence','rail_crossing')),
  value           TEXT NOT NULL CHECK (length(value) <= 32),         -- enumerated claim value (e.g. sett, rough, present), never free text
  severity        INTEGER CHECK (severity BETWEEN 1 AND 3),
  reported_week   TEXT NOT NULL CHECK (reported_week GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),  -- week precision only
  consent_version TEXT NOT NULL,
  moderation      TEXT NOT NULL DEFAULT 'pending' CHECK (moderation IN ('pending','verified','rejected'))
);
CREATE INDEX sil_report_intake_key_idx ON sil_report_intake (way_id, bucket_from_m, topic);

-- Aggregates are what the export reads; the k threshold (default 3 verified reports) is applied at export, not at write.
CREATE TABLE sil_report_aggregate (
  way_id        INTEGER NOT NULL,
  bucket_from_m INTEGER NOT NULL,
  topic         TEXT NOT NULL,
  value         TEXT NOT NULL,
  week          TEXT NOT NULL,
  n_reports     INTEGER NOT NULL CHECK (n_reports >= 1),
  PRIMARY KEY (way_id, bucket_from_m, topic, value, week)
) WITHOUT ROWID;

-- Verification queue: imagery and field checks. References only (provider, id, date, licence), never pixels.
CREATE TABLE sil_verification_task (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_version     TEXT NOT NULL REFERENCES sil_dataset_release (dataset_version),
  way_id              INTEGER NOT NULL,
  from_m              REAL NOT NULL,
  to_m                REAL NOT NULL CHECK (to_m >= from_m),
  topic               TEXT NOT NULL,
  attribute           TEXT NOT NULL,
  priority            TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  reasons             TEXT NOT NULL,                                  -- JSON array of resolver reason codes
  imagery_refs        TEXT,                                           -- JSON array of {provider,imageId,capturedAt,licenceId}
  state               TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','in_review','resolved','wont_fix')),
  outcome_evidence_id TEXT,                                           -- ledger id of the evidence the review produced
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sil_verification_task_queue_idx ON sil_verification_task (state, priority, way_id);

-- RESERVED for the opt-in phone-sensor design (Agent 6). Aggregates only; no table for traces or windows per user exists.
CREATE TABLE sil_sensor_aggregate (
  way_id        INTEGER NOT NULL,
  bucket_from_m INTEGER NOT NULL CHECK (bucket_from_m % 25 = 0),
  speed_band    TEXT NOT NULL,
  vehicle_class TEXT NOT NULL,
  week          TEXT NOT NULL,
  contributors  INTEGER NOT NULL CHECK (contributors >= 5),           -- k-anonymity floor enforced on write
  n_windows     INTEGER NOT NULL CHECK (n_windows >= contributors),
  metric        TEXT NOT NULL,
  p50           REAL NOT NULL,
  p90           REAL NOT NULL,
  PRIMARY KEY (way_id, bucket_from_m, speed_band, vehicle_class, week, metric)
) WITHOUT ROWID;
