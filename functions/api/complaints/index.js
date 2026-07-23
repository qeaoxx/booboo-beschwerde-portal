import { attachPhotos, complaintFromRow, enqueueNotification } from '../../../lib/complaints.js';
import { json, logError, requestId, requireSameOrigin } from '../../../lib/http.js';
import { ensureSchema } from '../../../lib/schema.js';
import { isAdminSession } from '../../../lib/security.js';
import { cleanFilename, escapeLike, parseLimit, parsePage, validateComplaintForm } from '../../../lib/validation.js';

function sortSql(value) {
  if (value === 'oldest') return 'c.created_at ASC';
  if (value === 'priority') return `CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, c.created_at DESC`;
  if (value === 'due') return 'CASE WHEN s.due_at IS NULL THEN 1 ELSE 0 END, s.due_at ASC, c.created_at DESC';
  return 'c.created_at DESC';
}

async function dashboardStats(env) {
  const row = await env.DB.prepare(
    `SELECT
      SUM(CASE WHEN s.deleted_at IS NULL AND c.status = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN s.deleted_at IS NULL AND c.status = 'heard' THEN 1 ELSE 0 END) AS heard_count,
      SUM(CASE WHEN s.deleted_at IS NULL AND c.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
      SUM(CASE WHEN s.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_count,
      COUNT(*) AS total_count
     FROM complaints c
     LEFT JOIN complaint_state s ON s.complaint_id = c.id`,
  ).first();
  return {
    new: Number(row?.new_count || 0),
    heard: Number(row?.heard_count || 0),
    resolved: Number(row?.resolved_count || 0),
    deleted: Number(row?.deleted_count || 0),
    total: Number(row?.total_count || 0),
  };
}

export async function onRequestPost(context) {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  await ensureSchema(context.env.DB);

  const formData = await context.request.formData().catch(() => null);
  if (!formData) return json({ error: 'Ungültige Anfrage.' }, 400);
  const validation = await validateComplaintForm(formData);
  if (validation.error) return json({ error: validation.error }, 400);
  const input = validation.value;

  const existing = await context.env.DB.prepare('SELECT id FROM complaints WHERE id = ?').bind(input.id).first();
  if (existing) return json({ complaint: { id: input.id }, duplicate: true }, 200);

  const now = new Date().toISOString();
  const complaint = {
    id: input.id,
    title: input.title,
    details: input.details,
    category: input.category,
    mood: input.mood,
    status: 'new',
    priority: input.priority,
    createdAt: now,
    updatedAt: now,
    photos: [],
  };
  const notificationId = crypto.randomUUID();
  const uploaded = [];
  const photoStatements = [];
  const derivativeStatements = [];

  try {
    for (const item of input.photos) {
      const photoId = crypto.randomUUID();
      const storageKey = `complaints/${complaint.id}/${photoId}/original`;
      const filename = cleanFilename(item.photo.name);
      await context.env.PHOTOS.put(storageKey, item.photo.stream(), {
        metadata: { complaintId: complaint.id, photoId, kind: 'original', contentType: item.contentType, filename },
      });
      uploaded.push({ key: storageKey, kind: 'photo' });

      let thumbnailStorageKey = null;
      if (item.thumbnail) {
        thumbnailStorageKey = `complaints/${complaint.id}/${photoId}/thumbnail`;
        await context.env.PHOTOS.put(thumbnailStorageKey, item.thumbnail.stream(), {
          metadata: { complaintId: complaint.id, photoId, kind: 'thumbnail', contentType: item.thumbnailType },
        });
        uploaded.push({ key: thumbnailStorageKey, kind: 'thumbnail' });
        derivativeStatements.push(
          context.env.DB.prepare(
            'INSERT INTO photo_derivatives (photo_id, thumbnail_storage_key, created_at) VALUES (?, ?, ?)',
          ).bind(photoId, thumbnailStorageKey, now),
        );
      }

      photoStatements.push(
        context.env.DB.prepare(
          `INSERT INTO complaint_photos
           (id, complaint_id, filename, content_type, size, data, storage_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(photoId, complaint.id, filename, item.contentType, item.photo.size, new Uint8Array(0), storageKey, now),
      );
      complaint.photos.push({
        id: photoId,
        filename,
        contentType: item.contentType,
        size: item.photo.size,
        hasThumbnail: Boolean(thumbnailStorageKey),
      });
    }

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO complaints (id, title, details, category, mood, status, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(complaint.id, complaint.title, complaint.details, complaint.category, complaint.mood, complaint.status, complaint.priority, complaint.createdAt),
      context.env.DB.prepare(
        'INSERT INTO complaint_state (complaint_id, updated_at) VALUES (?, ?)',
      ).bind(complaint.id, now),
      ...photoStatements,
      ...derivativeStatements,
      context.env.DB.prepare(
        `INSERT INTO notification_outbox (id, complaint_id, status, created_at)
         VALUES (?, ?, 'pending', ?)`,
      ).bind(notificationId, complaint.id, now),
      context.env.DB.prepare(
        `INSERT INTO notification_deliveries (id, complaint_id, status, created_at)
         VALUES (?, ?, 'pending', ?)`,
      ).bind(notificationId, complaint.id, now),
      context.env.DB.prepare(
        `INSERT INTO complaint_events (id, complaint_id, event_type, payload, created_at)
         VALUES (?, ?, 'created', ?, ?)`,
      ).bind(crypto.randomUUID(), complaint.id, JSON.stringify({ photoCount: complaint.photos.length, priority: complaint.priority }), now),
    ]);
  } catch (error) {
    const cleanup = await Promise.allSettled(uploaded.map((entry) => context.env.PHOTOS.delete(entry.key)));
    cleanup.forEach((result, index) => {
      if (result.status === 'rejected') logError('complaint_upload_rollback_failed', result.reason, { storageKey: uploaded[index].key });
    });
    const duplicate = await context.env.DB.prepare('SELECT id FROM complaints WHERE id = ?').bind(complaint.id).first().catch(() => null);
    if (duplicate) return json({ complaint: { id: complaint.id }, duplicate: true }, 200);
    logError('complaint_save_failed', error, { requestId: requestId(context.request), complaintId: complaint.id });
    return json({ error: 'Die Beschwerde konnte nicht sicher gespeichert werden. Bitte versuche es erneut.' }, 500);
  }

  context.waitUntil(enqueueNotification(context, notificationId, complaint));
  return json({ complaint, notification: { status: 'pending' } }, 201);
}

export async function onRequestGet({ request, env }) {
  if (!(await isAdminSession(request, env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  await ensureSchema(env.DB);

  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get('page'));
  const limit = parseLimit(url.searchParams.get('limit'));
  const offset = (page - 1) * limit;
  const clauses = [];
  const bindings = [];
  const trash = url.searchParams.get('trash') === '1';
  clauses.push(trash ? 's.deleted_at IS NOT NULL' : 's.deleted_at IS NULL');

  const status = url.searchParams.get('status');
  if (status && ['new', 'heard', 'resolved'].includes(status)) {
    clauses.push('c.status = ?');
    bindings.push(status);
  }
  const priority = url.searchParams.get('priority');
  if (priority && ['low', 'normal', 'high', 'urgent', 'none'].includes(priority)) {
    clauses.push(priority === 'none' ? 'c.priority IS NULL' : 'c.priority = ?');
    if (priority !== 'none') bindings.push(priority);
  }
  const category = url.searchParams.get('category');
  if (category) {
    clauses.push('c.category = ?');
    bindings.push(category.slice(0, 60));
  }
  const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (query) {
    clauses.push(`(c.title LIKE ? ESCAPE '\\' OR c.details LIKE ? ESCAPE '\\' OR c.category LIKE ? ESCAPE '\\')`);
    const like = `%${escapeLike(query)}%`;
    bindings.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT
      c.id, c.title, c.details, c.category, c.mood, c.status, c.priority, c.created_at,
      s.updated_at, s.heard_at, s.resolved_at, s.deleted_at, s.response_text, s.resolution_text, s.due_at, s.version,
      n.id AS notification_id, n.status AS notification_status, n.attempt_count AS notification_attempt_count,
      n.last_error AS notification_last_error, n.sent_at AS notification_sent_at
    FROM complaints c
    LEFT JOIN complaint_state s ON s.complaint_id = c.id
    LEFT JOIN notification_outbox n ON n.complaint_id = c.id
    ${where}
    ORDER BY ${sortSql(url.searchParams.get('sort'))}
    LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...bindings, limit + 1, offset).all();
  const hasMore = results.length > limit;
  const rows = results.slice(0, limit);
  const complaints = rows.map(complaintFromRow);

  if (complaints.length) {
    const placeholders = complaints.map(() => '?').join(',');
    const { results: photoRows } = await env.DB.prepare(
      `SELECT p.id, p.complaint_id, p.filename, p.content_type, p.size, d.thumbnail_storage_key
       FROM complaint_photos p
       LEFT JOIN photo_derivatives d ON d.photo_id = p.id
       WHERE p.complaint_id IN (${placeholders})
       ORDER BY p.created_at ASC`,
    ).bind(...complaints.map((item) => item.id)).all();
    attachPhotos(complaints, photoRows);
  } else {
    attachPhotos(complaints, []);
  }

  const categories = await env.DB.prepare(
    `SELECT DISTINCT category FROM complaints c
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     WHERE s.deleted_at IS NULL
     ORDER BY category ASC`,
  ).all();

  return json({
    complaints,
    stats: await dashboardStats(env),
    categories: categories.results.map((row) => row.category),
    pagination: { page, limit, hasMore },
  });
}
