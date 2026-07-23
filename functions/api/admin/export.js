import { json } from '../../../lib/http.js';
import { ensureSchema } from '../../../lib/schema.js';
import { isAdminSession } from '../../../lib/security.js';

export async function onRequestGet({ request, env }) {
  if (!(await isAdminSession(request, env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  await ensureSchema(env.DB);
  const [complaints, photos, events, notifications] = await Promise.all([
    env.DB.prepare(
      `SELECT c.*, s.updated_at, s.heard_at, s.resolved_at, s.deleted_at, s.response_text, s.resolution_text, s.due_at, s.version
       FROM complaints c LEFT JOIN complaint_state s ON s.complaint_id = c.id ORDER BY c.created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT p.id, p.complaint_id, p.filename, p.content_type, p.size, p.created_at, d.thumbnail_storage_key
       FROM complaint_photos p LEFT JOIN photo_derivatives d ON d.photo_id = p.id ORDER BY p.created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT id, complaint_id, event_type, payload, created_at FROM complaint_events ORDER BY created_at ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT id, complaint_id, status, attempt_count, telegram_message_id, last_error, queued_at, last_attempt_at, sent_at, failed_at, created_at
       FROM notification_outbox ORDER BY created_at ASC`,
    ).all(),
  ]);
  return json({
    format: 'booboo-portal-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    complaints: complaints.results,
    photos: photos.results.map((photo) => ({
      id: photo.id,
      complaintId: photo.complaint_id,
      filename: photo.filename,
      contentType: photo.content_type,
      size: Number(photo.size || 0),
      createdAt: photo.created_at,
      hasThumbnail: Boolean(photo.thumbnail_storage_key),
      downloadUrl: `/api/photos/${encodeURIComponent(photo.id)}`,
    })),
    events: events.results.map((event) => ({
      id: event.id,
      complaintId: event.complaint_id,
      type: event.event_type,
      payload: event.payload ? JSON.parse(event.payload) : null,
      createdAt: event.created_at,
    })),
    notifications: notifications.results,
  });
}
