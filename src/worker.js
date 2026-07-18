const ALLOWED_STATUSES = new Set(['new', 'heard', 'resolved']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function isAdmin(request, env) {
  const password = env.BOOBOO_ADMIN_PASSWORD;
  return Boolean(password) && request.headers.get('x-admin-password') === password;
}

async function complaintFromRow(row) {
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

async function handleApi(request, env, url) {
  if (url.pathname === '/api/complaints' && request.method === 'POST') {
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

  if (url.pathname === '/api/complaints' && request.method === 'GET') {
    if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);
    const { results } = await env.DB.prepare(
      'SELECT id, title, details, category, mood, status, created_at FROM complaints ORDER BY created_at DESC'
    ).all();
    return json({ complaints: await Promise.all(results.map(complaintFromRow)) });
  }

  const match = url.pathname.match(/^\/api\/complaints\/([\w-]+)$/);
  if (!match) return json({ error: 'Nicht gefunden.' }, 404);
  if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);

  if (request.method === 'PATCH') {
    const body = await request.json().catch(() => null);
    if (!body || !ALLOWED_STATUSES.has(body.status)) return json({ error: 'Ungültiger Status.' }, 400);
    const result = await env.DB.prepare('UPDATE complaints SET status = ? WHERE id = ?').bind(body.status, match[1]).run();
    if (!result.meta.changes) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
    const row = await env.DB.prepare('SELECT id, title, details, category, mood, status, created_at FROM complaints WHERE id = ?').bind(match[1]).first();
    return json({ complaint: await complaintFromRow(row) });
  }

  if (request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(match[1]).run();
    if (!result.meta.changes) return json({ error: 'Beschwerde nicht gefunden.' }, 404);
    return json({ ok: true });
  }

  return json({ error: 'Methode nicht erlaubt.' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.' }, 500);
    }
  },
};
