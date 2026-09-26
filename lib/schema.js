const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS complaint_state (
    complaint_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    heard_at TEXT,
    resolved_at TEXT,
    deleted_at TEXT,
    response_text TEXT,
    resolution_text TEXT,
    due_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS complaint_events (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS complaint_events_complaint_id_created_at
    ON complaint_events (complaint_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS photo_derivatives (
    photo_id TEXT PRIMARY KEY,
    thumbnail_storage_key TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES complaint_photos(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS cleanup_jobs (
    storage_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('photo', 'thumbnail', 'orphan')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    last_attempt_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS portal_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

export async function ensureSchema(db) {
  let version = null;
  try {
    version = await db.prepare(
      `SELECT setting_value FROM portal_settings WHERE setting_key = 'schema_version'`,
    ).first();
  } catch {
    // Migrations create the settings table; older schema versions are reconciled below.
  }
  if (version?.setting_value === '6') return;

  await db.batch(SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)));
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO complaint_state (complaint_id, updated_at)
     SELECT id, COALESCE(created_at, ?) FROM complaints`,
  ).bind(now).run();
  await db.prepare(
    `INSERT INTO portal_settings (setting_key, setting_value, updated_at)
     VALUES ('schema_version', '6', ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
  ).bind(now).run();
}
