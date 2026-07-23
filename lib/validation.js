export const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
export const ALLOWED_STATUSES = new Set(['new', 'heard', 'resolved']);
export const ALLOWED_MOODS = new Set(['😤', '🥺', '🙄', '😡', '💗']);
export const ALLOWED_CATEGORIES = new Set([
  'Essen & Trinken',
  'Zu spät kommen',
  'Nachrichten & Antworten',
  'Aufmerksamkeit & Zuneigung',
  'Date-Night-Vergehen',
  'Haushalt & Ordnung',
  'Vergessene Versprechen',
  'Unnötige Diskussion',
  'Unangebrachtes Verhalten',
  'Geschenk- oder Blumenmangel',
  'Andere sehr ernste Angelegenheit',
]);

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 80 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 1536 * 1024;

export function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function cleanFilename(value) {
  if (typeof value !== 'string') return 'foto';
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'foto';
}

function isFileLike(value) {
  return value && typeof value === 'object' && typeof value.size === 'number' && typeof value.slice === 'function' && typeof value.stream === 'function';
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

export async function detectImageType(file) {
  if (!isFileLike(file) || file.size <= 0) return null;
  const bytes = new Uint8Array(await file.slice(0, 40).arrayBuffer());
  if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  const ascii = String.fromCharCode(...bytes);
  if (ascii.slice(4, 8) === 'ftyp' && /(heic|heix|hevc|hevx|mif1|msf1)/.test(ascii.slice(8))) {
    return /mif1|msf1/.test(ascii.slice(8, 16)) ? 'image/heif' : 'image/heic';
  }
  return null;
}

export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseLimit(value, fallback = 20, maximum = 60) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function normalizeOptionalDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export async function validateComplaintForm(formData) {
  const title = cleanText(formData.get('title'), 90);
  const details = cleanText(formData.get('details'), 2500);
  const categoryCandidate = cleanText(formData.get('category'), 60);
  const moodCandidate = cleanText(formData.get('mood'), 12);
  const priorityCandidate = cleanText(formData.get('priority'), 12);
  const submissionId = cleanText(formData.get('submissionId'), 64);
  const category = ALLOWED_CATEGORIES.has(categoryCandidate) ? categoryCandidate : 'Andere sehr ernste Angelegenheit';
  const mood = ALLOWED_MOODS.has(moodCandidate) ? moodCandidate : '😤';
  const priority = ALLOWED_PRIORITIES.has(priorityCandidate) ? priorityCandidate : null;
  const photos = formData.getAll('photos').filter((item) => isFileLike(item) && item.size > 0);
  const thumbnailSlots = formData.getAll('thumbnails');

  if (!title || !details) return { error: 'Bitte ergänze einen Titel und ein paar Details.' };
  if (photos.length > MAX_PHOTOS) return { error: `Bitte sende höchstens ${MAX_PHOTOS} Fotos auf einmal.` };
  if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) return { error: 'Ein Foto ist größer als 25 MB.' };
  if (photos.reduce((total, photo) => total + photo.size, 0) > MAX_TOTAL_PHOTO_BYTES) return { error: 'Die Fotos sind zusammen größer als 80 MB.' };

  const normalizedPhotos = [];
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    const contentType = await detectImageType(photo);
    if (!contentType) return { error: `„${cleanFilename(photo.name)}“ ist kein unterstütztes JPG-, PNG-, WebP- oder HEIC/HEIF-Bild.` };
    const thumbnail = isFileLike(thumbnailSlots[index]) && thumbnailSlots[index].size > 0 ? thumbnailSlots[index] : null;
    let thumbnailType = null;
    if (thumbnail) {
      thumbnailType = await detectImageType(thumbnail);
      if (!thumbnailType || !['image/jpeg', 'image/png', 'image/webp'].includes(thumbnailType) || thumbnail.size > MAX_THUMBNAIL_BYTES) {
        return { error: 'Eine automatisch erzeugte Bildvorschau ist ungültig. Bitte wähle die Fotos erneut aus.' };
      }
    }
    normalizedPhotos.push({ photo, contentType, thumbnail, thumbnailType });
  }

  return {
    value: {
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)
        ? submissionId
        : crypto.randomUUID(),
      title,
      details,
      category,
      mood,
      priority,
      photos: normalizedPhotos,
    },
  };
}
