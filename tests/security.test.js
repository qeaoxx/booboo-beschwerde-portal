import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_COOKIE,
  createSessionCookie,
  passwordMatches,
  verifySession,
  checkLoginRateLimit,
  recordLoginFailure,
} from '../lib/security.js';
import { isSameOriginRequest, requireSameOrigin } from '../lib/http.js';

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

test('session cookies are HttpOnly, Secure and strict same-site', async () => {
  const cookie = await createSessionCookie(ADMIN_COOKIE, 'very-secret-value', 'admin', 3600);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});

test('same-origin browser login survives Cloudflare internal URL differences', () => {
  const request = new Request('https://internal.pages.dev/login', {
    method: 'POST',
    headers: {
      Origin: 'https://booboo-portal.pages.dev',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  assert.equal(isSameOriginRequest(request), true);
  assert.equal(requireSameOrigin(request), null);
});

test('same-origin validation accepts the public Cloudflare host as a fallback', () => {
  const request = new Request('https://internal.pages.dev/login', {
    method: 'POST',
    headers: {
      Origin: 'https://booboo-portal.pages.dev',
      Host: 'booboo-portal.pages.dev',
      'X-Forwarded-Proto': 'https',
    },
  });
  assert.equal(isSameOriginRequest(request), true);
});

test('cross-site and Pages sibling-site writes remain blocked', async () => {
  const crossSite = new Request('https://booboo-portal.pages.dev/login', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
    },
  });
  const siblingSite = new Request('https://booboo-portal.pages.dev/login', {
    method: 'POST',
    headers: {
      Origin: 'https://other-project.pages.dev',
      'Sec-Fetch-Site': 'same-site',
    },
  });

  assert.equal(isSameOriginRequest(crossSite), false);
  assert.equal(isSameOriginRequest(siblingSite), false);

  const rejection = requireSameOrigin(crossSite);
  assert.equal(rejection.status, 403);
  assert.deepEqual(await rejection.json(), { error: 'Diese Anfrage wurde aus Sicherheitsgründen abgelehnt.' });
});

test('same-origin validation accepts a matching referer when Origin is unavailable', () => {
  const request = new Request('https://booboo-portal.pages.dev/login', {
    method: 'POST',
    headers: {
      Referer: 'https://booboo-portal.pages.dev/login',
      Host: 'booboo-portal.pages.dev',
      'X-Forwarded-Proto': 'https',
    },
  });
  assert.equal(isSameOriginRequest(request), true);
});

test('login limiter locks after five failures without storing the IP', async () => {
  const entries = new Map();
  const kv = {
    async get(key) { return entries.has(key) ? JSON.parse(entries.get(key)) : null; },
    async put(key, value) { entries.set(key, value); },
    async delete(key) { entries.delete(key); },
  };
  const request = new Request('https://example.test/login', { headers: { 'CF-Connecting-IP': '203.0.113.10' } });
  let rate = await checkLoginRateLimit(kv, request, 'secret', 'portal-login');
  for (let failures = 0; failures < 5; failures += 1) {
    await recordLoginFailure(kv, rate.key, failures);
  }
  rate = await checkLoginRateLimit(kv, request, 'secret', 'portal-login');
  assert.equal(rate.allowed, false);
  assert.ok(rate.retryAfter > 0);
  assert.doesNotMatch([...entries.keys()][0], /203\.0\.113\.10/);
});
