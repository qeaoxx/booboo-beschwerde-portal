import { json, requireSameOrigin } from '../../../../lib/http.js';
import { ensureSchema } from '../../../../lib/schema.js';
import { isAdminSession } from '../../../../lib/security.js';

export async function onRequestPost({ request, env, params }) {
  if (!(await isAdminSession(request, env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  await ensureSchema(env.DB);
  const existing = await env.DB.prepare(
    `SELECT c.id, s.deleted_at FROM complaints c LEFT JOIN complaint_state s ON s.complaint_id = c.id WHERE c.id = ?`,
  ).bind(params.id).first();
  if (!existing) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
  if (!existing.deleted_at) return json({ ok: true, alreadyRestored: true });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE complaint_state SET deleted_at = NULL, updated_at = ?, version = version + 1 WHERE complaint_id = ?`,
    ).bind(now, params.id),
    env.DB.prepare(
      `UPDATE notification_outbox SET status = CASE WHEN status = 'cancelled' THEN 'pending' ELSE status END WHERE complaint_id = ?`,
    ).bind(params.id),
    env.DB.prepare(
      `INSERT INTO complaint_events (id, complaint_id, event_type, payload, created_at)
       VALUES (?, ?, 'restored', NULL, ?)`,
    ).bind(crypto.randomUUID(), params.id, now),
  ]);
  return json({ ok: true });
}
