CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  category TEXT NOT NULL,
  mood TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'heard', 'resolved')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS complaints_created_at ON complaints (created_at DESC);
