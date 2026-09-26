import { ensureSchema } from '../../lib/schema.js';

function logError(event, error, fields = {}) {
  console.error(JSON.stringify({
    event,
    error: String(error?.message || error).slice(0, 500),
    ...fields,
  }));
}

async function retryCleanupJobs(env) {
  const { results } = await env.DB.prepare(
    'SELECT storage_key, kind FROM cleanup_jobs ORDER BY created_at ASC LIMIT 50',
  ).all();

  for (const job of results) {
    try {
      await env.PHOTOS.delete(job.storage_key);
      await env.DB.prepare('DELETE FROM cleanup_jobs WHERE storage_key = ?').bind(job.storage_key).run();
    } catch (error) {
      await env.DB.prepare(
        `UPDATE cleanup_jobs
         SET attempt_count = attempt_count + 1, last_error = ?, last_attempt_at = ?
         WHERE storage_key = ?`,
      ).bind(String(error?.message || error).slice(0, 500), new Date().toISOString(), job.storage_key).run();
      logError('cleanup_retry_failed', error, { storageKey: job.storage_key, kind: job.kind });
    }
  }
}

async function purgeExpiredTrash(env) {
  const { results: complaints } = await env.DB.prepare(
    `SELECT c.id FROM complaints c
     JOIN complaint_state s ON s.complaint_id = c.id
     WHERE s.deleted_at IS NOT NULL AND datetime(s.deleted_at) < datetime('now', '-30 days')
     ORDER BY s.deleted_at ASC LIMIT 10`,
  ).all();

  for (const complaint of complaints) {
    const { results: photos } = await env.DB.prepare(
      `SELECT p.storage_key, d.thumbnail_storage_key
       FROM complaint_photos p
       LEFT JOIN photo_derivatives d ON d.photo_id = p.id
       WHERE p.complaint_id = ?`,
    ).bind(complaint.id).all();
    const entries = photos.flatMap((photo) => [
      photo.storage_key ? { key: photo.storage_key, kind: 'photo' } : null,
      photo.thumbnail_storage_key ? { key: photo.thumbnail_storage_key, kind: 'thumbnail' } : null,
    ].filter(Boolean));
    const now = new Date().toISOString();

    await env.DB.batch([
      ...entries.map((entry) => env.DB.prepare(
        'INSERT OR IGNORE INTO cleanup_jobs (storage_key, kind, created_at) VALUES (?, ?, ?)',
      ).bind(entry.key, entry.kind, now)),
      env.DB.prepare('DELETE FROM complaint_events WHERE complaint_id = ?').bind(complaint.id),
      env.DB.prepare('DELETE FROM photo_derivatives WHERE photo_id IN (SELECT id FROM complaint_photos WHERE complaint_id = ?)').bind(complaint.id),
      env.DB.prepare('DELETE FROM complaint_photos WHERE complaint_id = ?').bind(complaint.id),
      env.DB.prepare('DELETE FROM complaint_state WHERE complaint_id = ?').bind(complaint.id),
      env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(complaint.id),
    ]);

    for (const entry of entries) {
      try {
        await env.PHOTOS.delete(entry.key);
        await env.DB.prepare('DELETE FROM cleanup_jobs WHERE storage_key = ?').bind(entry.key).run();
      } catch (error) {
        logError('trash_purge_cleanup_failed', error, { complaintId: complaint.id, storageKey: entry.key });
      }
    }
    console.info(JSON.stringify({ event: 'trash_purged', complaintId: complaint.id }));
  }
}

export default {
  async scheduled(controller, env) {
    await ensureSchema(env.DB);
    const tasks = [['retry_cleanup_jobs', retryCleanupJobs(env)]];
    if (controller.cron === '17 3 * * *') tasks.push(['purge_expired_trash', purgeExpiredTrash(env)]);
    const results = await Promise.allSettled(tasks.map(([, task]) => task));
    results.forEach((result, index) => {
      if (result.status === 'rejected') logError('scheduled_task_failed', result.reason, { task: tasks[index][0] });
    });
  },
};
