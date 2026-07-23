import { ensureSchema } from './schema.js';
import { logError } from './http.js';

export function complaintFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    category: row.category,
    mood: row.mood,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    heardAt: row.heard_at || null,
    resolvedAt: row.resolved_at || null,
    deletedAt: row.deleted_at || null,
    responseText: row.response_text || '',
    resolutionText: row.resolution_text || '',
    dueAt: row.due_at || null,
    version: Number(row.version || 1),
    notification: row.notification_status ? {
      id: row.notification_id,
      status: row.notification_status,
      attempts: Number(row.notification_attempt_count || 0),
      lastError: row.notification_last_error || null,
      sentAt: row.notification_sent_at || null,
    } : null,
  };
}

export function attachPhotos(complaints, rows) {
  const byComplaint = new Map(complaints.map((complaint) => [complaint.id, complaint]));
  for (const complaint of complaints) complaint.photos = [];
  for (const row of rows) {
    const complaint = byComplaint.get(row.complaint_id);
    if (!complaint) continue;
    complaint.photos.push({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      size: Number(row.size || 0),
      hasThumbnail: Boolean(row.thumbnail_storage_key),
    });
  }
  return complaints;
}

export async function enqueueNotification(context, notificationId, complaint) {
  try {
    await context.env.TELEGRAM_NOTIFICATIONS.send({
      notificationId,
      complaintId: complaint.id,
      title: complaint.title,
      category: complaint.category,
      priority: complaint.priority,
    });
    const queuedAt = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE notification_outbox
       SET status = CASE WHEN status = 'sent' THEN status ELSE 'queued' END,
           queued_at = ?, last_error = NULL
       WHERE id = ? AND status NOT IN ('sent', 'cancelled')`,
    ).bind(queuedAt, notificationId).run();
  } catch (error) {
    await context.env.DB.prepare(
      `UPDATE notification_outbox
       SET status = CASE WHEN status = 'sent' THEN status ELSE 'pending' END,
           last_error = ?
       WHERE id = ? AND status NOT IN ('sent', 'cancelled')`,
    ).bind(String(error?.message || error).slice(0, 500), notificationId).run().catch(() => undefined);
    logError('telegram_enqueue_failed', error, { notificationId, complaintId: complaint.id });
  }
}

export async function queueCleanupJob(db, storageKey, kind, error = null) {
  await ensureSchema(db);
  await db.prepare(
    `INSERT INTO cleanup_jobs (storage_key, kind, last_error, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(storage_key) DO UPDATE SET kind = excluded.kind, last_error = excluded.last_error`,
  ).bind(storageKey, kind, error ? String(error).slice(0, 500) : null, new Date().toISOString()).run();
}

export async function deleteKvKeys(env, entries) {
  const results = await Promise.allSettled(entries.map((entry) => env.PHOTOS.delete(entry.key)));
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const entry = entries[index];
    if (result.status === 'fulfilled') {
      await env.DB.prepare('DELETE FROM cleanup_jobs WHERE storage_key = ?').bind(entry.key).run().catch(() => undefined);
    } else {
      await queueCleanupJob(env.DB, entry.key, entry.kind, result.reason).catch(() => undefined);
      logError('kv_cleanup_failed', result.reason, { storageKey: entry.key, kind: entry.kind });
    }
  }
}
