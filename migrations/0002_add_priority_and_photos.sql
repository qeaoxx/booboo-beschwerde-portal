ALTER TABLE complaints ADD COLUMN priority TEXT;

CREATE TABLE IF NOT EXISTS complaint_photos (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS complaint_photos_complaint_id ON complaint_photos (complaint_id);
