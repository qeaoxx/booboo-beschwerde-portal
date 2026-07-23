import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFilename, detectImageType, escapeLike, normalizeOptionalDate } from '../lib/validation.js';

function file(bytes, name, type = 'application/octet-stream') {
  return new File([Uint8Array.from(bytes)], name, { type });
}

test('detects supported image signatures instead of trusting MIME header', async () => {
  assert.equal(await detectImageType(file([0xff, 0xd8, 0xff, 0x00], 'fake.txt')), 'image/jpeg');
  assert.equal(await detectImageType(file([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], 'image.bin')), 'image/png');
  assert.equal(await detectImageType(file([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50], 'image.bin')), 'image/webp');
  assert.equal(await detectImageType(file([1,2,3,4,5,6], 'bad.jpg', 'image/jpeg')), null);
});

test('sanitizes filenames and LIKE queries', () => {
  assert.equal(cleanFilename('../booboo\u0000?.jpg'), '..-booboo--.jpg');
  assert.equal(escapeLike('100%_ok\\'), '100\\%\\_ok\\\\');
});

test('normalizes optional dates', () => {
  assert.equal(normalizeOptionalDate(''), null);
  assert.equal(normalizeOptionalDate('not-a-date'), undefined);
  assert.match(normalizeOptionalDate('2026-07-23T10:00:00Z'), /^2026-07-23T10:00:00\.000Z$/);
});
