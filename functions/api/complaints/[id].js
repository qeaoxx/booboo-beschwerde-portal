const ALLOWED_STATUSES = new Set(['new', 'heard', 'resolved']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function isAdmin(request, env) {
  return Boolean(env.BOOBOO_ADMIN_PASSWORD) && request.headers.get('x-admin-password') === env.BOOBOO_ADMIN_PASSWORD;
}

function complaintFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    category: row.category,
    mood: row.mood,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

export async function onRequestPatch({ request, env, params }) {
  if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || !ALLOWED_STATUSES.has(body.status)) return json({ error: 'Ungültiger Status.' }, 400);

  const result = await env.DB.prepare('UPDATE complaints SET status = ? WHERE id = ?').bind(body.status, params.id).run();
  if (!result.meta.changes) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
  const row = await env.DB.prepare(
    'SELECT id, title, details, category, mood, status, priority, created_at FROM complaints WHERE id = ?'
  ).bind(params.id).first();
  return json({ complaint: complaintFromRow(row) });
}

export async function onRequestDelete({ request, env, params }) {
  if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);
  const { results: photos } = await env.DB.prepare('SELECT storage_key FROM complaint_photos WHERE complaint_id = ?').bind(params.id).all();
  const existing = await env.DB.prepare('SELECT id FROM complaints WHERE id = ?').bind(params.id).first();
  if (!existing) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
  await Promise.all(photos.filter((photo) => photo.storage_key).map((photo) => env.PHOTOS.delete(photo.storage_key)));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM complaint_photos WHERE complaint_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true });
}
