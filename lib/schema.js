const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS notification_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
    telegram_message_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  )`,
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
  `CREATE TABLE IF NOT EXISTS notification_outbox (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    telegram_message_id TEXT,
    last_error TEXT,
    queued_at TEXT,
    last_attempt_at TEXT,
    sent_at TEXT,
    failed_at TEXT,
    last_synced_status TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS notification_outbox_status_created_at
    ON notification_outbox (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS cleanup_jobs (
    storage_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('photo', 'thumbnail', 'orphan')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    last_attempt_at TEXT
  )`,
];

export async function ensureSchema(db) {
  try {
    const version = await db.prepare(
      `SELECT setting_value FROM notification_settings WHERE setting_key = 'schema_version'`,
    ).first();
    if (version?.setting_value === '5') return;
  } catch {
    // The compatibility table is created below on databases that predate notifications.
  }
  await db.batch(SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)));
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO complaint_state (complaint_id, updated_at)
     SELECT id, COALESCE(created_at, ?) FROM complaints`,
  ).bind(now).run();

  try {
    await db.prepare(
      `INSERT OR IGNORE INTO notification_outbox
       (id, complaint_id, status, telegram_message_id, last_error, created_at, sent_at)
       SELECT legacy.id, legacy.complaint_id,
              CASE WHEN legacy.status = 'sent' THEN 'sent' ELSE 'pending' END,
              legacy.telegram_message_id, legacy.last_error, legacy.created_at, legacy.sent_at
       FROM notification_deliveries legacy
       JOIN complaints c ON c.id = legacy.complaint_id`,
    ).run();
    await db.prepare(
      `UPDATE notification_outbox
       SET status = 'sent',
           telegram_message_id = COALESCE(telegram_message_id, (SELECT telegram_message_id FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id)),
           sent_at = COALESCE(sent_at, (SELECT sent_at FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id))
       WHERE id IN (SELECT id FROM notification_deliveries WHERE status = 'sent')`,
    ).run();
  } catch {
    // Fresh local databases can be initialized before the legacy notification migration exists.
  }
  await db.prepare(
    `INSERT INTO notification_settings (setting_key, setting_value, updated_at)
     VALUES ('schema_version', '5', ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
  ).bind(new Date().toISOString()).run();
}
