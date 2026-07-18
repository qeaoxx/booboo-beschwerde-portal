export async function onRequestGet({ env, params }) {
  const photo = await env.DB.prepare('SELECT content_type, storage_key FROM complaint_photos WHERE id = ?').bind(params.id).first();
  if (!photo) return new Response('Foto nicht gefunden.', { status: 404 });
  if (!photo.storage_key) return new Response('Dieses alte Testfoto wurde nicht gespeichert. Bitte lade es noch einmal hoch.', { status: 410 });
  const stream = await env.PHOTOS.get(photo.storage_key, 'stream');
  if (!stream) return new Response('Foto nicht gefunden.', { status: 404 });
  return new Response(stream, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
