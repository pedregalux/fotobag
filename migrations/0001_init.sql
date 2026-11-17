-- 0001_init.sql

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  couple_names TEXT,
  event_date   TEXT,
  code_hash    TEXT,
  visibility   TEXT NOT NULL DEFAULT 'open',
  uploads_open INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id),
  display_key   TEXT NOT NULL,
  thumb_key     TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  mime          TEXT NOT NULL DEFAULT 'image/jpeg',
  sha256        TEXT NOT NULL,
  uploader_name TEXT,
  device_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'visible',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_photos_feed
  ON photos (event_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_device
  ON photos (event_id, device_id);

CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  photo_id   TEXT NOT NULL REFERENCES photos(id),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_ip ON login_attempts (ip, ts);
