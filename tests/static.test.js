import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readPublic(name) {
  return readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
}

test('frontend does not expose admin password or external fonts', async () => {
  const [html, app, polish] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('polish.css'),
  ]);
  for (const source of [html, app, polish]) assert.doesNotMatch(source, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(app, /x-admin-password/i);
  assert.doesNotMatch(app, /boobooAdminPassword/);
  assert.match(html, /noindex,nofollow/);
});

test('security headers and full function routing are present', async () => {
  const [headers, routes] = await Promise.all([
    readPublic('_headers'),
    readPublic('_routes.json'),
  ]);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /worker-src 'self'/);
  assert.match(headers, /manifest-src 'self'/);
  assert.deepEqual(JSON.parse(routes).include, ['/*']);
});

test('all frontend ids are unique and direct selectors resolve', async () => {
  const [html, app, polish] = await Promise.all([
    readPublic('index.html'),
    readPublic('app.js'),
    readPublic('ui-polish.js'),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const source = `${app}\n${polish}`;
  const references = new Set([
    ...[...source.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]),
  ]);
  for (const reference of references) assert.ok(ids.includes(reference), `Fehlende ID: ${reference}`);
});

test('visual polish includes dark mode, reduced motion and heart identity', async () => {
  const [html, css, finalCss, icon, middleware] = await Promise.all([
    readPublic('index.html'),
    readPublic('polish.css'),
    readPublic('polish-final.css'),
    readPublic('favicon.svg'),
    readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /polish-final\.css/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /class="brand-hearts"/);
  assert.doesNotMatch(html, /class="brand-mark"/);
  assert.match(middleware, /class="heart-mark"/);
  assert.doesNotMatch(middleware, /class="mark"/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(finalCss, /\.complaint-card > p\.complaint-details/);
  assert.match(finalCss, /border-left:\s*4px solid/);
  assert.match(icon, /<svg/);
  assert.match(icon, /Booboo Portal/);
});

test('private PWA uses a network-only service worker', async () => {
  const [manifestSource, worker] = await Promise.all([
    readPublic('manifest.webmanifest'),
    readPublic('sw.js'),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.src === '/favicon.svg'));
  assert.doesNotMatch(worker, /caches\.open|cache\.put|addAll/);
  assert.doesNotMatch(worker, /addEventListener\(['"]fetch/);
  assert.match(worker, /caches\.keys/);
});

test('complaint persistence is not rolled back for notification failures', async () => {
  const source = await readFile(new URL('../functions/api/complaints/index.js', import.meta.url), 'utf8');
  assert.match(source, /context\.waitUntil\(enqueueNotification/);
  assert.doesNotMatch(source, /DELETE FROM complaints/);
  assert.match(source, /notification_outbox/);
});

test('dialog cancel controls close without submitting edits', async () => {
  const [html, dialogs] = await Promise.all([
    readPublic('index.html'),
    readPublic('dialogs.js'),
  ]);
  assert.equal((html.match(/data-close-dialog/g) || []).length, 4);
  assert.match(dialogs, /querySelectorAll\('\[data-close-dialog\]'\)/);
});

test('runtime schema always reconciles staggered legacy notification delivery', async () => {
  const [schema, worker] = await Promise.all([
    readFile(new URL('../lib/schema.js', import.meta.url), 'utf8'),
    readFile(new URL('../telegram-notifier/src/entry.js', import.meta.url), 'utf8'),
  ]);
  for (const source of [schema, worker]) {
    assert.match(source, /reconcileLegacyNotifications/);
    assert.doesNotMatch(source, /if \(version\?\.setting_value === '5'\) return/);
    assert.match(source, /notification_deliveries WHERE status = 'sent'/);
  }
});
