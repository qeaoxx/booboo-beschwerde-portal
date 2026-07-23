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
    connection.executescript(migration.read_text(encoding='utf-8'))

version = connection.execute(
    "SELECT setting_value FROM notification_settings WHERE setting_key = 'schema_version'"
).fetchone()
if version != ('5',):
    raise SystemExit(f'Unerwartete Schema-Version: {version!r}')

outbox = connection.execute(
    'SELECT id, complaint_id, status FROM notification_outbox ORDER BY id'
).fetchall()
if outbox != [('valid-delivery', 'test-complaint', 'pending')]:
    raise SystemExit(f'Unerwartete Outbox-Migration: {outbox!r}')

foreign_key_errors = connection.execute('PRAGMA foreign_key_check').fetchall()
# Der absichtlich erzeugte Legacy-Orphan darf bestehen bleiben, aber nicht in neue Tabellen übernommen werden.
foreign_key_errors = [row for row in foreign_key_errors if row[0] != 'notification_deliveries']
if foreign_key_errors:
    raise SystemExit(f'Foreign-Key-Fehler: {foreign_key_errors!r}')

print(f'Migrationsprüfung erfolgreich: {len(migration_files)} Migrationen, Schema-Version 5, Legacy-Orphan sicher übersprungen.')
