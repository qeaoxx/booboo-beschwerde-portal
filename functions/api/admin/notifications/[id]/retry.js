import { enqueueNotification } from '../../../../../lib/complaints.js';
import { json, requireSameOrigin } from '../../../../../lib/http.js';
import { ensureSchema } from '../../../../../lib/schema.js';
import { isAdminSession } from '../../../../../lib/security.js';

export async function onRequestPost(context) {
  if (!(await isAdminSession(context.request, context.env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  await ensureSchema(context.env.DB);
  const row = await context.env.DB.prepare(
    `SELECT n.id, n.complaint_id, c.title, c.category, c.priority, s.deleted_at
     FROM notification_outbox n
     JOIN complaints c ON c.id = n.complaint_id
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     WHERE n.id = ?`,
  ).bind(context.params.id).first();
  if (!row || row.deleted_at) return json({ error: 'Benachrichtigung nicht gefunden oder Beschwerde gelöscht.' }, 404);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE notification_outbox
       SET status = 'pending', attempt_count = 0, last_error = NULL, failed_at = NULL, queued_at = NULL
       WHERE id = ?`,
    ).bind(row.id),
    context.env.DB.prepare(
      `INSERT INTO notification_deliveries (id, complaint_id, status, created_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(id) DO UPDATE SET status = 'pending', last_error = NULL, sent_at = NULL`,
    ).bind(row.id, row.complaint_id, now),
  ]);
  context.waitUntil(enqueueNotification(context, row.id, {
    id: row.complaint_id,
    title: row.title,
    category: row.category,
    priority: row.priority,
  }));
  return json({ ok: true });
}
