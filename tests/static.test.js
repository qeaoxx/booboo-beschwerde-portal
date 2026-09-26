import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('portal and dashboard use the same German category set', async () => {
  const [index, validation] = await Promise.all([
    read('../public/index.html'),
    read('../lib/validation.js'),
  ]);
  const select = index.match(/<select id="category"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, 'public category select exists');
  const categories = [...select[1].matchAll(/<option(?:\s[^>]*)?>(.*?)<\/option>/g)]
    .map((option) => option[1].replace(/&amp;/g, '&').trim());
  const allowed = [...validation.matchAll(/^  '([^']+)',$/gm)].map((match) => match[1]);
  const editSelect = index.match(/<select id="edit-category"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(editSelect, 'dashboard category select exists');
  const editCategories = [...editSelect[1].matchAll(/<option(?:\s[^>]*)?>(.*?)<\/option>/g)]
    .map((option) => option[1].replace(/&amp;/g, '&').trim());
  assert.deepEqual(categories, allowed);
  assert.deepEqual(editCategories, allowed);
  assert.match(index, /<html lang="de">/);
});

test('dashboard actions, backup, upload and login are present', async () => {
  const [index, app, middleware] = await Promise.all([
    read('../public/index.html'),
    read('../public/app.js'),
    read('../functions/_middleware.js'),
  ]);
  for (const id of ['complaint-form', 'photos', 'priority', 'complaint-list', 'category-filter', 'sort-order', 'edit-dialog', 'create-backup', 'verify-backup', 'deep-health']) {
    assert.match(index, new RegExp('id="' + id + '"'));
  }
  for (const route of ['/api/complaints', '/api/admin/session', '/api/admin/health', '/api/admin/export']) {
    assert.ok(app.includes(route), 'app uses ' + route);
  }
  assert.match(middleware, /Booboo — Privater Bereich/);
  assert.match(middleware, /checkLoginRateLimit/);
  assert.ok(middleware.includes('function secured(response, options)'));
  assert.ok(middleware.includes('.note{align-self:flex-end;'));
  assert.ok(!middleware.includes('.note{position:absolute;'));
});

test('visual system respects motion preferences and avoids third-party font dependencies', async () => {
  const [index, css, login] = await Promise.all([
    read('../public/index.html'),
    read('../public/styles.css'),
    read('../functions/_middleware.js'),
  ]);
  assert.doesNotMatch(index + css + login, /fonts\.googleapis|fonts\.gstatic/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@keyframes/);
  assert.match(css, /--rose/);
});

test('public experience has no Telegram integration', async () => {
  const [index, app, css] = await Promise.all([
    read('../public/index.html'),
    read('../public/app.js'),
    read('../public/styles.css'),
  ]);
  assert.doesNotMatch(index + app + css, /telegram/i);
  assert.ok(!index.includes('t.me/') && !app.includes('t.me/') && !css.includes('t.me/'));
});

test('legacy outbound delivery code is not part of the active complaint path', async () => {
  const [create, update, restore, library, schema, health, exportRoute] = await Promise.all([
    read('../functions/api/complaints/index.js'),
    read('../functions/api/complaints/[id].js'),
    read('../functions/api/complaints/[id]/restore.js'),
    read('../lib/complaints.js'),
    read('../lib/schema.js'),
    read('../functions/api/admin/health.js'),
    read('../functions/api/admin/export.js'),
  ]);
  const active = [create, update, restore, library, schema, health, exportRoute].join('\n');
  assert.doesNotMatch(active, /notification_outbox|notification_deliveries/);
});
