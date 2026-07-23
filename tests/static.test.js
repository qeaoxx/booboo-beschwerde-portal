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
