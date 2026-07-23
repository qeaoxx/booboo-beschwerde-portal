import { json, requireSameOrigin } from '../../../lib/http.js';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  checkLoginRateLimit,
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  isAdminSession,
  passwordMatches,
  recordLoginFailure,
} from '../../../lib/security.js';

export async function onRequestGet({ request, env }) {
  return json({ authenticated: await isAdminSession(request, env) });
}

export async function onRequestPost({ request, env }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!env.BOOBOO_ADMIN_PASSWORD) return json({ error: 'Das Dashboard-Passwort ist nicht eingerichtet.' }, 503);

  const rate = await checkLoginRateLimit(env.PHOTOS, request, env.BOOBOO_ADMIN_PASSWORD, 'admin-login');
  if (!rate.allowed) {
    return json({ error: 'Zu viele falsche Versuche. Bitte warte kurz.', retryAfter: rate.retryAfter }, 429, {
      'Retry-After': String(rate.retryAfter),
    });
  }

  const body = await request.json().catch(() => null);
  if (!(await passwordMatches(body?.password, env.BOOBOO_ADMIN_PASSWORD))) {
    const failed = await recordLoginFailure(env.PHOTOS, rate.key, rate.failures);
    const retryAfter = failed.lockedUntil > Date.now() ? Math.ceil((failed.lockedUntil - Date.now()) / 1000) : 0;
    return json({
      error: retryAfter ? 'Zu viele falsche Versuche. Bitte warte kurz.' : 'Das Dashboard-Passwort stimmt nicht.',
      retryAfter,
    }, retryAfter ? 429 : 401, retryAfter ? { 'Retry-After': String(retryAfter) } : {});
  }

  await clearLoginFailures(env.PHOTOS, rate.key);
  const cookie = await createSessionCookie(ADMIN_COOKIE, env.BOOBOO_ADMIN_PASSWORD, 'admin', ADMIN_SESSION_SECONDS);
  return json({ authenticated: true }, 200, { 'Set-Cookie': cookie });
}

export async function onRequestDelete({ request }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  return json({ authenticated: false }, 200, { 'Set-Cookie': clearSessionCookie(ADMIN_COOKIE) });
}
