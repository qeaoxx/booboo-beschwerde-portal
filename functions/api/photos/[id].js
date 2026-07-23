import { ensureSchema } from '../../../lib/schema.js';

export async function onRequestGet({ request, env, params }) {
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant') === 'thumb' ? 'thumb' : 'original';
  const photo = await env.DB.prepare(
    `SELECT p.filename, p.content_type, p.size, p.storage_key, d.thumbnail_storage_key
     FROM complaint_photos p
     LEFT JOIN photo_derivatives d ON d.photo_id = p.id
     WHERE p.id = ?`,
  ).bind(params.id).first();
  if (!photo) return new Response('Foto nicht gefunden.', { status: 404 });
  if (!photo.storage_key) return new Response('Dieses alte Testfoto wurde nicht gespeichert.', { status: 410 });

  const key = variant === 'thumb' && photo.thumbnail_storage_key ? photo.thumbnail_storage_key : photo.storage_key;
  const object = await env.PHOTOS.getWithMetadata(key, { type: 'stream' });
  if (!object?.value) return new Response('Foto nicht gefunden.', { status: 404 });
  const metadataType = object.metadata?.contentType;
  const contentType = variant === 'thumb' && metadataType ? metadataType : photo.content_type;
  const filename = String(photo.filename || 'foto').replace(/["\r\n]/g, '-');
  return new Response(object.value, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
