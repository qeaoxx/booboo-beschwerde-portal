import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_COOKIE,
  createSessionCookie,
  passwordMatches,
  verifySession,
} from '../lib/security.js';

function requestWithCookie(cookie) {
  return new Request('https://example.test/', { headers: { Cookie: cookie.split(';')[0] } });
}

test('password comparison accepts only exact value', async () => {
  assert.equal(await passwordMatches('richtig', 'richtig'), true);
  assert.equal(await passwordMatches('falsch', 'richtig'), false);
  assert.equal(await passwordMatches('', 'richtig'), false);
});

test('signed admin session validates and rejects tampering', async () => {
  const cookie = await createSessionCookie(ADMIN_COOKIE, 'very-secret-value', 'admin', 3600);
  assert.equal(await verifySession(requestWithCookie(cookie), ADMIN_COOKIE, 'very-secret-value', 'admin'), true);
  const tampered = cookie.replace('v2.', 'v2.x');
  assert.equal(await verifySession(requestWithCookie(tampered), ADMIN_COOKIE, 'very-secret-value', 'admin'), false);
  assert.equal(await verifySession(requestWithCookie(cookie), ADMIN_COOKIE, 'different-secret', 'admin'), false);
  assert.equal(await verifySession(requestWithCookie(cookie), ADMIN_COOKIE, 'very-secret-value', 'portal'), false);
});
