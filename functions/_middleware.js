import { applySecurityHeaders, html, json, requireSameOrigin } from '../lib/http.js';
import {
  ADMIN_COOKIE,
  PORTAL_COOKIE,
  PORTAL_SESSION_SECONDS,
  checkLoginRateLimit,
  clearLoginFailures,
  clearSessionCookie,
  createSessionCookie,
  isPortalSession,
  passwordMatches,
  recordLoginFailure,
} from '../lib/security.js';

function loginPage({ error = '', lockedSeconds = 0 } = {}) {
  const message = error ? `<p class="error" role="alert">${error}</p>` : '';
  const retry = lockedSeconds > 0
    ? `<p class="error">Bitte warte noch ungefähr ${Math.ceil(lockedSeconds / 60)} Minute${lockedSeconds > 60 ? 'n' : ''}.</p>`
    : '';
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f7f3ed"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>Booboo — Privater Bereich</title>
<style>
:root{color:#38322d;background:#f7f3ed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}*{box-sizing:border-box}
body{min-height:100svh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 10% 15%,#ead7c8 0,transparent 28rem),radial-gradient(ellipse at 92% 90%,#ead3c9 0,transparent 30rem),#f7f3ed}
.panel{display:grid;grid-template-columns:1.05fr .95fr;width:min(940px,100%);min-height:650px;border:1px solid #e6ddd4;background:#fffdf9;box-shadow:0 32px 100px #372a2018}
.story{display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;padding:clamp(28px,5vw,54px);background:#eee4db}
.brand{display:flex;align-items:center;gap:10px;color:#3a332e;font-size:15px;font-weight:750;letter-spacing:-.06em}.mark{display:grid;width:34px;height:34px;place-items:center;border:1px solid #be8c7d;border-radius:50%;color:#9e6564;font:italic 20px Georgia,serif}
.overline{color:#a16c62;font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase}.story h1{margin:20px 0;font:400 clamp(45px,6vw,67px)/.98 Georgia,serif;letter-spacing:-.07em}.story h1 em{color:#a76768}.story p{max-width:300px;color:#777067;font-size:13px;line-height:1.85}
.note{align-self:flex-end;width:133px;height:154px;margin:24px 0 0;padding:16px;background:#fbf8f1;box-shadow:0 15px 32px #4e3b2a19;transform:rotate(5deg)}.note small{color:#aa7770;font-size:8px;letter-spacing:.1em}.note strong{display:block;margin-top:22px;font:400 20px/1 Georgia,serif}.note em{color:#a76768}
.form-side{display:flex;flex-direction:column;justify-content:center;padding:clamp(32px,6vw,62px)}.form-side h2{margin:15px 0 8px;font:400 36px Georgia,serif;letter-spacing:-.06em}.hint{margin:0 0 29px;color:#827a72;font-size:12px;line-height:1.8}
label{display:block;margin-bottom:9px;color:#57504a;font-size:11px;font-weight:700}input{width:100%;height:48px;padding:0 14px;border:1px solid #e3dbd3;border-radius:2px;color:#38322d;background:#fffefa;font-size:13px}input:focus{border-color:#ae7772;outline:0;box-shadow:0 0 0 4px #ae77721f}
button{display:flex;width:100%;height:48px;align-items:center;justify-content:space-between;margin-top:15px;padding:0 18px;border:0;border-radius:2px;color:#fffaf5;background:#37312d;font-size:11px;font-weight:650;cursor:pointer;transition:transform .2s,background .2s}button:hover{transform:translateY(-2px);background:#554642}
.error{margin:13px 0 0;color:#a3444b;font-size:11px;line-height:1.6}.back{display:inline-block;margin-top:27px;color:#8c635f;font-size:11px;text-decoration:none}.back:hover{text-decoration:underline}.foot{margin-top:34px;color:#aaa097;font-size:9px;letter-spacing:.11em;text-transform:uppercase}
@media(max-width:680px){body{padding:12px}.panel{grid-template-columns:1fr;min-height:0}.story{min-height:240px;padding:25px}.story h1{font-size:43px;margin:14px 0}.story p{max-width:255px;font-size:11px}.note{width:93px;height:112px;margin-top:12px;padding:11px}.note strong{margin-top:15px;font-size:15px}.form-side{padding:30px 25px}.foot{margin-top:24px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important}}
</style></head><body><main class="panel"><section class="story" aria-label="Booboo"><div class="brand"><span class="mark" aria-hidden="true">b.</span><span>booboo</span></div><div><span class="overline">Euer privater Raum</span><h1>Ein offenes Ohr<br><em>fängt hier an.</em></h1><p>Ein liebevoller Ort für alles, was gesagt werden muss — geschützt und nur für euch zwei.</p></div><div class="note" aria-hidden="true"><small>AN BOOBOO · IMMER</small><strong>Manchmal hilft,<br>wenn jemand<br><em>zuhört.</em></strong></div></section><section class="form-side"><span class="overline">Privater Bereich</span><h2>Willkommen zurück.</h2><p class="hint">Melde dich an, um eure Nachrichten in Ruhe zu lesen.</p><form method="post" action="/login"><label for="password">Portal-Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit"><span>Geschützten Bereich öffnen</span><span aria-hidden="true">↗</span></button>${message}${retry}</form><a class="back" href="/">← Zurück zum Portal</a><p class="foot">Privat · Persönlich · Nur für euch</p></section></main></body></html>`;
}

function secured(response, options) {
  return applySecurityHeaders(response, options);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const password = env.BOOBOO_PORTAL_PASSWORD;
  if (!password) return secured(html('Das Portal ist noch nicht eingerichtet.', 503));

  const signedIn = await isPortalSession(request, env);

  if (url.pathname === '/login') {
    if (request.method === 'POST') {
      const originError = requireSameOrigin(request);
      if (originError) return secured(originError);

      const rate = await checkLoginRateLimit(env.PHOTOS, request, password, 'portal-login');
      if (!rate.allowed) {
        return secured(html(loginPage({ error: 'Zu viele falsche Versuche. Der Zugang ist kurz gesperrt.', lockedSeconds: rate.retryAfter }), 429, {
          'Retry-After': String(rate.retryAfter),
        }));
      }

      const form = await request.formData().catch(() => null);
      const candidate = form?.get('password');
      if (!(await passwordMatches(candidate, password))) {
        const failed = await recordLoginFailure(env.PHOTOS, rate.key, rate.failures);
        const lockedSeconds = failed.lockedUntil > Date.now() ? Math.ceil((failed.lockedUntil - Date.now()) / 1000) : 0;
        return secured(html(loginPage({
          error: lockedSeconds ? 'Zu viele falsche Versuche. Der Zugang ist kurz gesperrt.' : 'Das Passwort stimmt nicht. Versuch es bitte erneut.',
          lockedSeconds,
        }), lockedSeconds ? 429 : 401, lockedSeconds ? { 'Retry-After': String(lockedSeconds) } : {}));
      }

      await clearLoginFailures(env.PHOTOS, rate.key);
      const cookie = await createSessionCookie(PORTAL_COOKIE, password, 'portal', PORTAL_SESSION_SECONDS);
      return secured(new Response(null, {
        status: 303,
        headers: { Location: '/', 'Set-Cookie': cookie },
      }));
    }

    if (request.method !== 'GET') return secured(json({ error: 'Methode nicht erlaubt.' }, 405, { Allow: 'GET, POST' }));
    if (signedIn) return secured(Response.redirect(new URL('/', request.url), 303));
    return secured(html(loginPage()));
  }

  if (url.pathname === '/logout' && request.method === 'POST') {
    const originError = requireSameOrigin(request);
    if (originError) return secured(originError);
    const headers = new Headers({ Location: '/login' });
    headers.append('Set-Cookie', clearSessionCookie(PORTAL_COOKIE));
    headers.append('Set-Cookie', clearSessionCookie(ADMIN_COOKIE));
    return secured(new Response(null, { status: 303, headers }));
  }

  if (!signedIn) {
    if (url.pathname.startsWith('/api/')) {
      return secured(json({ error: 'Der Portal-Zugangscode ist erforderlich.' }, 401));
    }
    return secured(Response.redirect(new URL('/login', request.url), 303));
  }

  return secured(await context.next());
}
