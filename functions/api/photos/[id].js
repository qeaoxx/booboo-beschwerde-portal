export async function onRequestGet({ env, params }) {
  const photo = await env.DB.prepare('SELECT content_type, data FROM complaint_photos WHERE id = ?').bind(params.id).first();
  if (!photo) return new Response('Foto nicht gefunden.', { status: 404 });
  return new Response(photo.data, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
