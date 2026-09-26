#!/usr/bin/env python3
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'migrations'
connection = sqlite3.connect(':memory:')
connection.execute('PRAGMA foreign_keys = ON')
migration_files = sorted(MIGRATIONS.glob('*.sql'))
if not migration_files:
    raise SystemExit('Keine Migrationen gefunden.')

for migration in migration_files:
    if migration.name == '0005_harden_portal.sql':
        connection.execute(
            "INSERT INTO complaints (id, title, details, category, mood, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ('test-complaint', 'Test', 'Details', 'Essen & Trinken', '😤', 'new', 'normal', '2026-07-23T08:00:00.000Z'),
        )
        connection.execute(
            "INSERT INTO notification_deliveries (id, complaint_id, status, created_at) VALUES (?, ?, ?, ?)",
            ('valid-delivery', 'test-complaint', 'pending', '2026-07-23T08:00:00.000Z'),
        )
        connection.execute('PRAGMA foreign_keys = OFF')
        connection.execute(
            "INSERT INTO notification_deliveries (id, complaint_id, status, created_at) VALUES (?, ?, ?, ?)",
            ('orphan-delivery', 'missing-complaint', 'pending', '2026-07-23T08:00:00.000Z'),
        )
        connection.execute('PRAGMA foreign_keys = ON')
    if migration.name == '0006_remove_legacy_delivery_tables.sql':
        connection.execute(
            "INSERT INTO complaint_photos (id, complaint_id, filename, content_type, size, data, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ('test-photo', 'test-complaint', 'test.jpg', 'image/jpeg', 128, b'', 'complaints/test/original', '2026-07-23T08:01:00.000Z'),
        )
        connection.execute(
            "INSERT INTO photo_derivatives (photo_id, thumbnail_storage_key, created_at) VALUES (?, ?, ?)",
            ('test-photo', 'complaints/test/thumb', '2026-07-23T08:01:00.000Z'),
        )
    connection.executescript(migration.read_text(encoding='utf-8'))

version = connection.execute(
    "SELECT setting_value FROM portal_settings WHERE setting_key = 'schema_version'"
).fetchone()
if version != ('6',):
    raise SystemExit(f'Unerwartete Schema-Version: {version!r}')

complaint = connection.execute(
    "SELECT id, title FROM complaints WHERE id = 'test-complaint'"
).fetchone()
photo = connection.execute(
    "SELECT id, storage_key FROM complaint_photos WHERE id = 'test-photo'"
).fetchone()
thumbnail = connection.execute(
    "SELECT thumbnail_storage_key FROM photo_derivatives WHERE photo_id = 'test-photo'"
).fetchone()
if complaint != ('test-complaint', 'Test') or photo != ('test-photo', 'complaints/test/original') or thumbnail != ('complaints/test/thumb',):
    raise SystemExit('Die Bereinigung darf Beschwerden oder Fotos nicht verändern.')

remaining = connection.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notification_outbox', 'notification_deliveries', 'notification_settings')"
).fetchall()
if remaining:
    raise SystemExit(f'Alte Zustelltabellen vorhanden: {remaining!r}')

foreign_key_errors = connection.execute('PRAGMA foreign_key_check').fetchall()
if foreign_key_errors:
    raise SystemExit(f'Foreign-Key-Fehler: {foreign_key_errors!r}')

print(f'Migrationsprüfung erfolgreich: {len(migration_files)} Migrationen, Schema-Version 6, Beschwerden und Fotoobjekte bleiben erhalten.')
