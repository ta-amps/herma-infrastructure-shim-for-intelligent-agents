-- Persistent Cloudflare D1 caller-isolated schema for Herma context-shimming AI middleware (`ta-amps-herma`).

CREATE TABLE IF NOT EXISTS provisions (
  caller_scope   TEXT    NOT NULL DEFAULT 'system_builtin',
  prov_id        TEXT    NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  content_sha256 TEXT    NOT NULL,
  source_store   TEXT    NOT NULL,
  body_json      TEXT    NOT NULL,
  updated_at     REAL    NOT NULL,
  PRIMARY KEY (caller_scope, prov_id)
);

CREATE TABLE IF NOT EXISTS context_entries (
  caller_scope TEXT    NOT NULL DEFAULT 'system_builtin',
  entry_id     TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  kind         TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL,
  body_json    TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (caller_scope, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_context_scope_kind ON context_entries (caller_scope, kind, entry_id);

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
  caller_scope       TEXT NOT NULL DEFAULT 'system_builtin',
  project_tag        TEXT NOT NULL DEFAULT 'default',
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
CREATE INDEX IF NOT EXISTS idx_receipts_scope_time ON injection_receipts (caller_scope, project_tag, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_conv ON injection_receipts (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_receipts_time ON injection_receipts (created_at DESC);

CREATE TABLE IF NOT EXISTS working_entities (
  caller_scope    TEXT    NOT NULL,
  project_tag     TEXT    NOT NULL DEFAULT 'default',
  entity_kind     TEXT    NOT NULL,
  entity_value    TEXT    NOT NULL,
  hit_count       INTEGER NOT NULL DEFAULT 1,
  first_seen_at   REAL    NOT NULL,
  last_seen_at    REAL    NOT NULL,
  last_receipt_id TEXT    NOT NULL,
  PRIMARY KEY (caller_scope, project_tag, entity_kind, entity_value)
);
CREATE INDEX IF NOT EXISTS idx_working_entities_hot ON working_entities (caller_scope, project_tag, hit_count DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS rule_outcomes (
  outcome_id       TEXT    PRIMARY KEY,
  caller_scope     TEXT    NOT NULL,
  project_tag      TEXT    NOT NULL DEFAULT 'default',
  receipt_id       TEXT    NOT NULL,
  prov_id          TEXT    NOT NULL,
  outcome          TEXT    NOT NULL,
  tokens_saved_est INTEGER NOT NULL DEFAULT 0,
  latency_ms       REAL    NOT NULL DEFAULT 0.0,
  error_signature  TEXT,
  created_at       REAL    NOT NULL,
  UNIQUE (caller_scope, receipt_id, prov_id)
);
CREATE INDEX IF NOT EXISTS idx_rule_outcomes_scope ON rule_outcomes (caller_scope, project_tag, prov_id, created_at DESC);
