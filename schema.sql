CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type ~ '^[a-z0-9]+(\.[a-z0-9]+)*$'),
  value TEXT,
  ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
