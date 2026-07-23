const encoder = new TextEncoder();

export const PORTAL_COOKIE = 'booboo_gate';
export const ADMIN_COOKIE = 'booboo_admin';
export const PORTAL_SESSION_SECONDS = 60 * 60 * 24 * 14;
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cookieValue(request, name) {
  const prefix = `${name}=`;
  return (request.headers.get('Cookie') || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
}

async function verifyHmac(value, signature, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(value));
}

export async function passwordMatches(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) return false;
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export async function createSessionCookie(name, secret, purpose, maxAgeSeconds) {
  const expiry = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `v2.${expiry}.${nonce}`;
  const signature = base64url(new Uint8Array(await hmac(`${purpose}|${payload}`, secret)));
  return `${name}=${payload}.${signature}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(name) {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function verifySession(request, name, secret, purpose) {
  if (!secret) return false;
  const session = cookieValue(request, name);
  const parts = session.split('.');
  if (parts.length !== 4) return false;
  const [version, expiry, nonce, signature] = parts;
  if (version !== 'v2' || !nonce || !Number.isFinite(Number(expiry))) return false;
  if (Number(expiry) * 1000 <= Date.now()) return false;
  try {
    return verifyHmac(
      `${purpose}|${version}.${expiry}.${nonce}`,
      bytesFromBase64url(signature),
      secret,
    );
  } catch {
    return false;
  }
}

export function isPortalSession(request, env) {
  return verifySession(request, PORTAL_COOKIE, env.BOOBOO_PORTAL_PASSWORD, 'portal');
}

export function isAdminSession(request, env) {
  return verifySession(request, ADMIN_COOKIE, env.BOOBOO_ADMIN_PASSWORD, 'admin');
}

async function fingerprint(request, secret, scope) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const signature = await hmac(`${scope}|${ip}`, secret);
  return base64url(new Uint8Array(signature)).slice(0, 32);
}

function limiterKey(scope, value) {
  return `security/${scope}/${value}`;
}

export async function checkLoginRateLimit(kv, request, secret, scope) {
  if (!kv || !secret) return { allowed: true, retryAfter: 0, key: null, failures: 0 };
  const key = limiterKey(scope, await fingerprint(request, secret, scope));
  const state = await kv.get(key, 'json').catch(() => null);
  const now = Date.now();
  const lockedUntil = Number(state?.lockedUntil || 0);
  return {
    allowed: lockedUntil <= now,
    retryAfter: lockedUntil > now ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0,
    key,
    failures: Number(state?.failures || 0),
  };
}

export async function recordLoginFailure(kv, key, failures) {
  if (!kv || !key) return { failures: failures + 1, lockedUntil: 0 };
  const nextFailures = failures + 1;
  const now = Date.now();
  const lockedUntil = nextFailures >= 5 ? now + 15 * 60 * 1000 : 0;
  try {
    await kv.put(key, JSON.stringify({ failures: nextFailures, lockedUntil }), { expirationTtl: 60 * 60 });
  } catch {
    // Authentication must remain available if the limiter backend is temporarily unavailable.
  }
  return { failures: nextFailures, lockedUntil };
}

export async function clearLoginFailures(kv, key) {
  if (kv && key) await kv.delete(key).catch(() => undefined);
}
