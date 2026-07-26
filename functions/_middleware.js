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
    ? `<p class="retry">Bitte warte noch ungefähr ${Math.ceil(lockedSeconds / 60)} Minute${lockedSeconds > 60 ? 'n' : ''}.</p>`
    : '';
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#d93578">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>Nur für Booboo</title>
  <style>
    :root{color:#352735;background:#fff7f9;font-family:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;color-scheme:light}
    *{box-sizing:border-box}
    body{min-height:100svh;margin:0;display:grid;place-items:center;padding:24px;overflow:hidden;background:radial-gradient(circle at 12% 12%,#ffd3e4 0,transparent 25rem),radial-gradient(circle at 90% 88%,#f6b9d0 0,transparent 29rem),linear-gradient(145deg,#fff9fb,#f8e8ef)}
    body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.11;background-image:radial-gradient(#c74b80 .6px,transparent .8px);background-size:12px 12px}
    .orb{position:fixed;border-radius:999px;filter:blur(1px);pointer-events:none}.orb.one{width:170px;height:170px;left:-70px;bottom:7%;background:rgba(235,107,162,.16)}.orb.two{width:120px;height:120px;right:-35px;top:9%;background:rgba(217,53,120,.13)}
    .card{position:relative;width:min(100%,450px);padding:42px 38px 36px;border:1px solid rgba(255,255,255,.94);border-radius:30px;background:rgba(255,252,253,.9);box-shadow:0 28px 90px rgba(91,23,55,.15),inset 0 1px rgba(255,255,255,.9);backdrop-filter:blur(24px);text-align:center}
    .mark{width:58px;height:58px;display:grid;place-items:center;margin:0 auto 21px;border-radius:19px;background:linear-gradient(145deg,#f287b5,#b7205d);color:#fff;font:850 28px/1 Georgia,serif;box-shadow:0 14px 34px rgba(183,32,93,.25);transform:rotate(-3deg)}.mark span{transform:rotate(3deg)}
    .eyebrow{margin:0 0 12px;color:#a92158;font:800 11px/1 ui-monospace,"SFMono-Regular",monospace;letter-spacing:.14em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(38px,9vw,54px);letter-spacing:-.06em;line-height:.92}h1 em{color:#d93578;font-family:Georgia,serif;font-weight:700}
    .intro{max-width:350px;margin:20px auto 0;color:#6c5665;line-height:1.62;font-size:14px}
    .privacy{display:inline-flex;align-items:center;gap:7px;margin-top:17px;padding:6px 10px;border:1px solid #e8bfd0;border-radius:999px;background:#fff3f7;color:#765c69;font-size:11px;font-weight:750}.privacy::before{content:"";width:7px;height:7px;border-radius:999px;background:#45a576;box-shadow:0 0 0 3px #def3e8}
    form{margin-top:27px;text-align:left;padding:19px;border:1px solid #e5bacb;border-radius:20px;background:rgba(255,247,250,.78)}
    label{display:grid;gap:9px;color:#5e4554;font-size:13px;font-weight:800}
    input{width:100%;border:1px solid #dbaabe;border-radius:13px;padding:14px 15px;outline:none;background:#fff;color:#352735;font:650 16px inherit;transition:border-color .15s,box-shadow .15s}
    input:focus-visible{border-color:#d93578;box-shadow:0 0 0 4px rgba(217,53,120,.15)}
    button{width:100%;margin-top:15px;border:0;border-radius:999px;padding:14px 20px;color:#fff;background:linear-gradient(135deg,#eb6ba2,#ae1f58);box-shadow:0 10px 26px rgba(175,35,91,.25);font:800 14px inherit;cursor:pointer;transition:transform .15s,box-shadow .15s}
    button:hover{transform:translateY(-2px);box-shadow:0 14px 31px rgba(175,35,91,.31)}button:active{transform:scale(.985)}button:focus-visible{outline:3px solid #7c1747;outline-offset:3px}
    .error{margin:15px 0 0;padding:10px 12px;border-radius:12px;background:#fff0f5;color:#9f174e;font-size:13px;font-weight:750;text-align:center}.retry{margin:8px 0 0;color:#775f6c;font-size:12px;text-align:center}
    .tiny{margin:19px 0 0;color:#806a76;font-size:11px}
    @media(max-width:480px){body{padding:10px}.card{padding:34px 22px 29px;border-radius:25px}.mark{width:52px;height:52px;border-radius:17px}.intro{font-size:13px}form{padding:16px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <div class="orb one" aria-hidden="true"></div><div class="orb two" aria-hidden="true"></div>
  <main class="card">
    <div class="mark" aria-hidden="true"><span>B</span></div>
    <p class="eyebrow">Nur für euch zwei</p>
    <h1>Booboo<br><em>Beschwerde Portal.</em></h1>
    <p class="intro">Dieser kleine Ort ist privat. Gib euren gemeinsamen Zugangscode ein, um weiterzugehen.</p>
    <span class="privacy">Privat und geschützt</span>
    <form method="post" action="/login">
      <label>Zugangscode
        <input name="password" type="password" autocomplete="current-password" required autofocus maxlength="256" placeholder="Gemeinsamen Code eingeben">
      </label>
      <button type="submit">Portal öffnen →</button>
      ${message}${retry}
    </form>
    <p class="tiny">Keine fremden Beschwerden · keine öffentlichen Inhalte</p>
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
