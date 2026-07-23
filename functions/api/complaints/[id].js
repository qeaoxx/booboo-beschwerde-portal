import { attachPhotos, complaintFromRow, deleteKvKeys } from '../../../lib/complaints.js';
import { json, logError, requireSameOrigin } from '../../../lib/http.js';
import { ensureSchema } from '../../../lib/schema.js';
import { isAdminSession } from '../../../lib/security.js';
import {
  ALLOWED_CATEGORIES,
  ALLOWED_MOODS,
  ALLOWED_PRIORITIES,
  ALLOWED_STATUSES,
  cleanText,
  normalizeOptionalDate,
} from '../../../lib/validation.js';

async function requireAdmin(request, env) {
  return await isAdminSession(request, env) ? null : json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
}

async function loadComplaint(env, id) {
  const row = await env.DB.prepare(
    `SELECT
      c.id, c.title, c.details, c.category, c.mood, c.status, c.priority, c.created_at,
      s.updated_at, s.heard_at, s.resolved_at, s.deleted_at, s.response_text, s.resolution_text, s.due_at, s.version,
      n.id AS notification_id, n.status AS notification_status, n.attempt_count AS notification_attempt_count,
      n.last_error AS notification_last_error, n.sent_at AS notification_sent_at
     FROM complaints c
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     LEFT JOIN notification_outbox n ON n.complaint_id = c.id
     WHERE c.id = ?`,
  ).bind(id).first();
  if (!row) return null;
  const complaint = complaintFromRow(row);
  const { results: photoRows } = await env.DB.prepare(
    `SELECT p.id, p.complaint_id, p.filename, p.content_type, p.size, d.thumbnail_storage_key
     FROM complaint_photos p
     LEFT JOIN photo_derivatives d ON d.photo_id = p.id
     WHERE p.complaint_id = ?
     ORDER BY p.created_at ASC`,
  ).bind(id).all();
  attachPhotos([complaint], photoRows);
  const { results: events } = await env.DB.prepare(
    `SELECT id, event_type, payload, created_at
     FROM complaint_events WHERE complaint_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(id).all();
  complaint.events = events.map((event) => ({
    id: event.id,
    type: event.event_type,
    payload: event.payload ? JSON.parse(event.payload) : null,
    createdAt: event.created_at,
  }));
  return complaint;
}

export async function onRequestGet({ request, env, params }) {
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  await ensureSchema(env.DB);
  const complaint = await loadComplaint(env, params.id);
  return complaint ? json({ complaint }) : json({ error: 'Beschwerde nicht gefunden.' }, 404);
}

export async function onRequestPatch(context) {
  const authError = await requireAdmin(context.request, context.env);
  if (authError) return authError;
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  await ensureSchema(context.env.DB);

  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Ungültige Änderung.' }, 400);
  const current = await loadComplaint(context.env, context.params.id);
  if (!current || current.deletedAt) return json({ error: 'Beschwerde nicht gefunden.' }, 404);

  const next = {
    title: body.title === undefined ? current.title : cleanText(body.title, 90),
    details: body.details === undefined ? current.details : cleanText(body.details, 2500),
    category: body.category === undefined ? current.category : cleanText(body.category, 60),
    mood: body.mood === undefined ? current.mood : cleanText(body.mood, 12),
    status: body.status === undefined ? current.status : cleanText(body.status, 12),
    priority: body.priority === undefined ? current.priority : (body.priority === null || body.priority === '' ? null : cleanText(body.priority, 12)),
    responseText: body.responseText === undefined ? current.responseText : cleanText(body.responseText, 2000),
    resolutionText: body.resolutionText === undefined ? current.resolutionText : cleanText(body.resolutionText, 2000),
    dueAt: body.dueAt === undefined ? current.dueAt : normalizeOptionalDate(body.dueAt),
  };

  if (!next.title || !next.details) return json({ error: 'Titel und Beschreibung dürfen nicht leer sein.' }, 400);
  if (!ALLOWED_CATEGORIES.has(next.category)) return json({ error: 'Ungültige Kategorie.' }, 400);
  if (!ALLOWED_MOODS.has(next.mood)) return json({ error: 'Ungültige Stimmung.' }, 400);
  if (!ALLOWED_STATUSES.has(next.status)) return json({ error: 'Ungültiger Status.' }, 400);
  if (next.priority && !ALLOWED_PRIORITIES.has(next.priority)) return json({ error: 'Ungültige Priorität.' }, 400);
  if (body.dueAt !== undefined && next.dueAt === undefined) return json({ error: 'Ungültiges Fälligkeitsdatum.' }, 400);

  const now = new Date().toISOString();
  const heardAt = next.status === 'heard' && !current.heardAt ? now : current.heardAt;
  const resolvedAt = next.status === 'resolved' && !current.resolvedAt ? now : current.resolvedAt;
  const changedFields = Object.keys(next).filter((key) => next[key] !== current[key]);
  if (!changedFields.length) return json({ complaint: current });

  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE complaints SET title = ?, details = ?, category = ?, mood = ?, status = ?, priority = ? WHERE id = ?`,
      ).bind(next.title, next.details, next.category, next.mood, next.status, next.priority, current.id),
      context.env.DB.prepare(
        `UPDATE complaint_state
         SET updated_at = ?, heard_at = ?, resolved_at = ?, response_text = ?, resolution_text = ?, due_at = ?, version = version + 1
         WHERE complaint_id = ?`,
      ).bind(now, heardAt, resolvedAt, next.responseText || null, next.resolutionText || null, next.dueAt, current.id),
      context.env.DB.prepare(
        `INSERT INTO complaint_events (id, complaint_id, event_type, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        current.id,
        current.status !== next.status ? 'status_changed' : 'edited',
        JSON.stringify(current.status !== next.status
          ? { from: current.status, to: next.status, fields: changedFields }
          : { fields: changedFields }),
        now,
      ),
      ...(current.status !== next.status ? [
        context.env.DB.prepare(
          `UPDATE notification_outbox SET last_synced_status = NULL WHERE complaint_id = ? AND status = 'sent'`,
        ).bind(current.id),
      ] : []),
    ]);
  } catch (error) {
    logError('complaint_update_failed', error, { complaintId: current.id });
    return json({ error: 'Die Änderung konnte nicht gespeichert werden.' }, 500);
  }

  return json({ complaint: await loadComplaint(context.env, current.id) });
}

export async function onRequestDelete(context) {
  const authError = await requireAdmin(context.request, context.env);
  if (authError) return authError;
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  await ensureSchema(context.env.DB);

  const current = await loadComplaint(context.env, context.params.id);
  if (!current) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
  const permanent = new URL(context.request.url).searchParams.get('permanent') === '1';

  if (!permanent) {
    if (current.deletedAt) return json({ ok: true, alreadyDeleted: true });
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE complaint_state SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE complaint_id = ?`,
      ).bind(now, now, current.id),
      context.env.DB.prepare(
        `UPDATE notification_outbox
         SET status = CASE WHEN status = 'sent' THEN status ELSE 'cancelled' END,
             last_error = CASE WHEN status = 'sent' THEN last_error ELSE NULL END
         WHERE complaint_id = ?`,
      ).bind(current.id),
      context.env.DB.prepare(`DELETE FROM notification_deliveries WHERE complaint_id = ? AND status = 'pending'`).bind(current.id),
      context.env.DB.prepare(
        `INSERT INTO complaint_events (id, complaint_id, event_type, payload, created_at)
         VALUES (?, ?, 'deleted', NULL, ?)`,
      ).bind(crypto.randomUUID(), current.id, now),
    ]);
    return json({ ok: true, deletedAt: now, undoUntil: new Date(Date.now() + 30_000).toISOString() });
  }

  if (!current.deletedAt) return json({ error: 'Die Beschwerde muss zuerst in den Papierkorb verschoben werden.' }, 409);
  const { results: rows } = await context.env.DB.prepare(
    `SELECT p.storage_key, d.thumbnail_storage_key
     FROM complaint_photos p LEFT JOIN photo_derivatives d ON d.photo_id = p.id
     WHERE p.complaint_id = ?`,
  ).bind(current.id).all();
  const entries = rows.flatMap((row) => [
    row.storage_key ? { key: row.storage_key, kind: 'photo' } : null,
    row.thumbnail_storage_key ? { key: row.thumbnail_storage_key, kind: 'thumbnail' } : null,
  ].filter(Boolean));
  const now = new Date().toISOString();

  try {
    await context.env.DB.batch([
      ...entries.map((entry) => context.env.DB.prepare(
        `INSERT OR IGNORE INTO cleanup_jobs (storage_key, kind, created_at) VALUES (?, ?, ?)`,
      ).bind(entry.key, entry.kind, now)),
      context.env.DB.prepare('DELETE FROM notification_deliveries WHERE complaint_id = ?').bind(current.id),
      context.env.DB.prepare('DELETE FROM notification_outbox WHERE complaint_id = ?').bind(current.id),
      context.env.DB.prepare('DELETE FROM complaint_events WHERE complaint_id = ?').bind(current.id),
      context.env.DB.prepare('DELETE FROM photo_derivatives WHERE photo_id IN (SELECT id FROM complaint_photos WHERE complaint_id = ?)').bind(current.id),
      context.env.DB.prepare('DELETE FROM complaint_photos WHERE complaint_id = ?').bind(current.id),
      context.env.DB.prepare('DELETE FROM complaint_state WHERE complaint_id = ?').bind(current.id),
      context.env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(current.id),
    ]);
  } catch (error) {
    logError('complaint_purge_db_failed', error, { complaintId: current.id });
    return json({ error: 'Die Beschwerde konnte nicht endgültig gelöscht werden.' }, 500);
  }

  await deleteKvKeys(context.env, entries);
  return json({ ok: true, permanent: true });
}
