import { json, logError, requireSameOrigin } from '../../../lib/http.js';
import { ensureSchema } from '../../../lib/schema.js';
import { isAdminSession } from '../../../lib/security.js';

async function listKvKeys(kv, prefix, maximum = 100_000) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, limit: 1000, cursor });
    keys.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && keys.length < maximum);
  return keys.slice(0, maximum);
}

async function integrity(env, { includeAll = false } = {}) {
  const { results: rows } = await env.DB.prepare(
    `SELECT p.id, p.storage_key, d.thumbnail_storage_key
     FROM complaint_photos p LEFT JOIN photo_derivatives d ON d.photo_id = p.id`,
  ).all();
  const expected = new Set();
  for (const row of rows) {
    if (row.storage_key) expected.add(row.storage_key);
    if (row.thumbnail_storage_key) expected.add(row.thumbnail_storage_key);
  }
  const actual = new Set(await listKvKeys(env.PHOTOS, 'complaints/'));
  const missing = [...expected].filter((key) => !actual.has(key));
  const orphaned = [...actual].filter((key) => !expected.has(key));
  return {
    expected: expected.size,
    actual: actual.size,
    missingCount: missing.length,
    orphanedCount: orphaned.length,
    missing: missing.slice(0, 50),
    orphaned: includeAll ? orphaned : orphaned.slice(0, 50),
  };
}

export async function onRequestGet({ request, env }) {
  if (!(await isAdminSession(request, env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  await ensureSchema(env.DB);
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  const [complaints, photos, cleanup] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM complaints`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM complaint_photos`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM cleanup_jobs`).first(),
  ]);
  let integrityResult = null;
  if (deep) {
    try {
      integrityResult = await integrity(env);
    } catch (error) {
      logError('integrity_scan_failed', error);
      integrityResult = { error: 'Integritätsprüfung fehlgeschlagen.' };
    }
  }
  return json({
    healthy: Number(cleanup?.count || 0) === 0 && !integrityResult?.missingCount && !integrityResult?.error,
    complaints: Number(complaints?.count || 0),
    photos: { count: Number(photos?.count || 0), bytes: Number(photos?.bytes || 0) },
    cleanupJobs: Number(cleanup?.count || 0),
    integrity: integrityResult,
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdminSession(request, env))) return json({ error: 'Dashboard-Anmeldung erforderlich.' }, 401);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  await ensureSchema(env.DB);
  const body = await request.json().catch(() => null);
  if (body?.action !== 'repair-orphans') return json({ error: 'Ungültige Wartungsaktion.' }, 400);
  const scan = await integrity(env, { includeAll: true });
  const batch = scan.orphaned.slice(0, 100);
  const results = await Promise.allSettled(batch.map((key) => env.PHOTOS.delete(key)));
  let removed = 0;
  for (let index = 0; index < results.length; index += 1) {
    if (results[index].status === 'fulfilled') removed += 1;
    else {
      const key = batch[index];
      await env.DB.prepare(
        `INSERT OR REPLACE INTO cleanup_jobs (storage_key, kind, attempt_count, last_error, created_at, last_attempt_at)
         VALUES (?, 'orphan', 1, ?, ?, ?)`,
      ).bind(key, String(results[index].reason).slice(0, 500), new Date().toISOString(), new Date().toISOString()).run();
    }
  }
  return json({ ok: true, removed, failed: results.length - removed, remaining: Math.max(0, scan.orphaned.length - batch.length) });
}
