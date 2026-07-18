function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
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
    createdAt: row.created_at,
  };
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Ungültige Anfrage.' }, 400);

  const title = cleanText(body.title, 90);
  const details = cleanText(body.details, 2500);
  const category = cleanText(body.category, 40) || 'Andere Angelegenheit';
  const mood = cleanText(body.mood, 12) || '😤';
  if (!title || !details) return json({ error: 'Bitte ergänze einen Titel und ein paar Details.' }, 400);

  const complaint = {
    id: crypto.randomUUID(), title, details, category, mood,
    status: 'new', createdAt: new Date().toISOString(),
  };
  await env.DB.prepare(
    'INSERT INTO complaints (id, title, details, category, mood, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(complaint.id, complaint.title, complaint.details, complaint.category, complaint.mood, complaint.status, complaint.createdAt).run();
  return json({ complaint }, 201);
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT id, title, details, category, mood, status, created_at FROM complaints ORDER BY created_at DESC'
  ).all();
  return json({ complaints: results.map(complaintFromRow) });
}
