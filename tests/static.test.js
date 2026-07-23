import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend does not expose admin password or external fonts', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(app, /x-admin-password/i);
  assert.doesNotMatch(app, /boobooAdminPassword/);
  assert.match(html, /noindex,nofollow/);
});

test('security headers and full function routing are present', async () => {
  const [headers, routes] = await Promise.all([
    readFile(new URL('../public/_headers', import.meta.url), 'utf8'),
    readFile(new URL('../public/_routes.json', import.meta.url), 'utf8'),
  ]);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.deepEqual(JSON.parse(routes).include, ['/*']);
});

test('all frontend ids are unique and direct selectors resolve', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const references = new Set([
    ...[...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]),
    ...[...app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]),
  ]);
  for (const reference of references) assert.ok(ids.includes(reference), `Fehlende ID: ${reference}`);
});

test('complaint persistence is not rolled back for notification failures', async () => {
  const source = await readFile(new URL('../functions/api/complaints/index.js', import.meta.url), 'utf8');
  assert.match(source, /context\.waitUntil\(enqueueNotification/);
  assert.doesNotMatch(source, /DELETE FROM complaints/);
  assert.match(source, /notification_outbox/);
});

test('dialog cancel controls close without submitting edits', async () => {
  const [html, dialogs] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/dialogs.js', import.meta.url), 'utf8'),
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
