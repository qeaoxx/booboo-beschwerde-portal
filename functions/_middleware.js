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
  const message = error
    ? `<p class="error" role="alert">${error}</p>`
    : '';
  const retry = lockedSeconds > 0
    ? `<p class="tiny">Bitte warte noch ungefähr ${Math.ceil(lockedSeconds / 60)} Minute${lockedSeconds > 60 ? 'n' : ''}.</p>`
    : '';
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f7a2c4">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Nur für Booboo</title>
  <style>
    :root{color:#352735;background:#fff7f9;font-family:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;color-scheme:light}
    *{box-sizing:border-box}body{min-height:100svh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 18%,#ffdbe9 0,transparent 24rem),radial-gradient(circle at 90% 85%,#ffd6e5 0,transparent 25rem),#fff7f9}
    .card{width:min(100%,430px);padding:46px 38px;border:1px solid rgba(255,255,255,.9);border-radius:28px;background:rgba(255,251,252,.94);box-shadow:0 20px 70px rgba(121,38,77,.14);text-align:center}
    .heart{font-size:38px;color:#d93578;filter:drop-shadow(0 7px 9px #f9b4cd)}.eyebrow{margin:17px 0 10px;color:#b52562;font:700 11px/1 ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(34px,8vw,50px);letter-spacing:-.06em;line-height:.95}h1 em{color:#d93578;font-family:Georgia,serif}p{color:#6d5968;line-height:1.6}
    form{margin-top:28px;text-align:left}label{display:grid;gap:8px;color:#654d5d;font-size:13px;font-weight:750}input{width:100%;border:1px solid #dbaabe;border-radius:12px;padding:14px;outline:none;background:#fff;font:600 16px inherit}
    input:focus-visible{border-color:#d93578;box-shadow:0 0 0 4px #ffd9e8}button{width:100%;margin-top:18px;border:0;border-radius:999px;padding:14px 20px;color:#fff;background:linear-gradient(135deg,#e85c98,#c92669);box-shadow:0 8px 20px rgba(175,35,91,.25);font:750 14px inherit;cursor:pointer}
    button:focus-visible{outline:3px solid #7c1747;outline-offset:3px}.error{margin:15px 0 -7px;color:#a51f56;font-size:13px;font-weight:700}.tiny{margin:20px 0 0;color:#775f6c;font-size:12px}
    @media(max-width:480px){.card{padding:38px 24px;border-radius:23px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <main class="card">
    <div class="heart" aria-hidden="true">♥</div>
    <p class="eyebrow">Nur für euch zwei</p>
    <h1>Booboo<br><em>Beschwerde Portal.</em></h1>
    <p>Dieser kleine Ort ist privat. Gib den gemeinsamen Zugangscode ein, um weiterzugehen.</p>
    <form method="post" action="/login">
      <label>Zugangscode
        <input name="password" type="password" autocomplete="current-password" required autofocus maxlength="256">
      </label>
      <button type="submit">Portal öffnen →</button>
    </form>
    ${message}${retry}
    <p class="tiny">Nicht öffentlich · keine fremden Beschwerden</p>
  </main>
</body>
</html>`;
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
