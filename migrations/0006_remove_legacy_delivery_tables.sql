DROP TABLE IF EXISTS notification_outbox;
DROP TABLE IF EXISTS notification_deliveries;
DROP TABLE IF EXISTS notification_settings;

CREATE TABLE IF NOT EXISTS portal_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO portal_settings (setting_key, setting_value, updated_at)
VALUES ('schema_version', '6', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at;
