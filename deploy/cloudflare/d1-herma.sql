-- Persistent Cloudflare D1 schema for Herma context-shimming AI middleware (`ta-amps-herma`).

CREATE TABLE IF NOT EXISTS provisions (
  prov_id        TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  content_sha256 TEXT    NOT NULL,
  source_store   TEXT    NOT NULL,
  body_json      TEXT    NOT NULL,
  updated_at     REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS context_entries (
  entry_id   TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  body_json  TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_context_kind ON context_entries (kind, entry_id);

CREATE TABLE IF NOT EXISTS harness_keys (
  key_id        TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  harness_kind  TEXT NOT NULL,
  scopes_json   TEXT NOT NULL,
  secret_sha256 TEXT NOT NULL UNIQUE,
  created_at    REAL NOT NULL,
  revoked_at    REAL
);

CREATE TABLE IF NOT EXISTS injection_receipts (
  receipt_id         TEXT PRIMARY KEY,
  receipt_sha256     TEXT NOT NULL,
  conversation_id    TEXT,
  harness_kind       TEXT NOT NULL,
  protocol           TEXT NOT NULL,
  model              TEXT NOT NULL,
  matched_provisions TEXT NOT NULL,
  injected_uris      TEXT NOT NULL,
  body_json          TEXT NOT NULL DEFAULT '{}',
  created_at         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_conv ON injection_receipts (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_receipts_time ON injection_receipts (created_at DESC);
