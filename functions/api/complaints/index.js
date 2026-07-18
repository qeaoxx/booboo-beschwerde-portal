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
    priority: row.priority,
    createdAt: row.created_at,
  };
}

const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 80 * 1024 * 1024;

function cleanFilename(value) {
  return typeof value === 'string' ? value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 120) || 'foto' : 'foto';
}

function photosFor(photos, complaintId) {
  return photos.filter((photo) => photo.complaint_id === complaintId).map((photo) => ({
    id: photo.id,
    filename: photo.filename,
    contentType: photo.content_type,
    size: photo.size,
  }));
}

export async function onRequestPost({ request, env }) {
  const body = await request.formData().catch(() => null);
  if (!body) return json({ error: 'Ungültige Anfrage.' }, 400);

  const title = cleanText(body.get('title'), 90);
  const details = cleanText(body.get('details'), 2500);
  const category = cleanText(body.get('category'), 40) || 'Andere Angelegenheit';
  const mood = cleanText(body.get('mood'), 12) || '😤';
  const candidatePriority = cleanText(body.get('priority'), 12);
  const priority = ALLOWED_PRIORITIES.has(candidatePriority) ? candidatePriority : null;
  const photos = body.getAll('photos').filter((item) => typeof item !== 'string' && item.size > 0);
  if (!title || !details) return json({ error: 'Bitte ergänze einen Titel und ein paar Details.' }, 400);
  if (photos.length > MAX_PHOTOS) return json({ error: `Bitte sende höchstens ${MAX_PHOTOS} Fotos auf einmal.` }, 400);
  if (photos.some((photo) => !ALLOWED_IMAGE_TYPES.has(photo.type) || photo.size > MAX_PHOTO_BYTES)) return json({ error: 'Bitte verwende JPG, PNG oder WebP mit höchstens 25 MB pro Foto.' }, 400);
  if (photos.reduce((total, photo) => total + photo.size, 0) > MAX_TOTAL_PHOTO_BYTES) return json({ error: 'Die Fotos sind zusammen zu groß. Bitte wähle insgesamt höchstens 80 MB aus.' }, 400);

  const complaint = {
    id: crypto.randomUUID(), title, details, category, mood,
    status: 'new', priority, createdAt: new Date().toISOString(), photos: [],
  };
  await env.DB.prepare(
    'INSERT INTO complaints (id, title, details, category, mood, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(complaint.id, complaint.title, complaint.details, complaint.category, complaint.mood, complaint.status, complaint.priority, complaint.createdAt).run();

  try {
    for (const photo of photos) {
      const id = crypto.randomUUID();
      const item = { id, filename: cleanFilename(photo.name), contentType: photo.type, size: photo.size };
      await env.DB.prepare(
        'INSERT INTO complaint_photos (id, complaint_id, filename, content_type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(item.id, complaint.id, item.filename, item.contentType, item.size, await photo.arrayBuffer(), complaint.createdAt).run();
      complaint.photos.push(item);
    }
    return json({ complaint }, 201);
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM complaint_photos WHERE complaint_id = ?').bind(complaint.id),
      env.DB.prepare('DELETE FROM complaints WHERE id = ?').bind(complaint.id),
    ]);
    console.error(error);
    return json({ error: 'Die Fotos konnten nicht gespeichert werden. Bitte versuche es erneut.' }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Passwort erforderlich.' }, 401);
  const { results } = await env.DB.prepare(
    'SELECT id, title, details, category, mood, status, priority, created_at FROM complaints ORDER BY created_at DESC'
  ).all();
  const { results: photoRows } = await env.DB.prepare(
    'SELECT id, complaint_id, filename, content_type, size FROM complaint_photos ORDER BY created_at ASC'
  ).all();
  return json({ complaints: results.map((row) => ({ ...complaintFromRow(row), photos: photosFor(photoRows, row.id) })) });
}
