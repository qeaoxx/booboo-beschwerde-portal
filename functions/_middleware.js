const textEncoder = new TextEncoder();
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function base64url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesFromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cookieValue(request, name) {
  const prefix = `${name}=`;
  return (request.headers.get('Cookie') || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) || '';
}

async function hmac(value, password) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
}

async function isValidSession(request, password) {
  const session = cookieValue(request, 'booboo_gate');
  const separator = session.lastIndexOf('.');
  if (!session || separator < 1) return false;
  const payload = session.slice(0, separator);
  const signature = session.slice(separator + 1);
  const [version, expiry] = payload.split('.');
  if (version !== 'v1' || !Number.isFinite(Number(expiry)) || Number(expiry) * 1000 < Date.now()) return false;
  try {
    const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, bytesFromBase64url(signature), textEncoder.encode(payload));
  } catch {
    return false;
  }
}

async function passwordMatches(candidate, expected) {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', textEncoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', textEncoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

function loginPage(hasError = false) {
  const message = hasError ? '<p class="error">Das Passwort stimmt noch nicht. Versuch es bitte erneut.</p>' : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7a2c4"><title>Nur für Booboo</title><style>
  :root{color:#352735;background:#fff7f9;font-family:ui-rounded,"DM Sans",system-ui,sans-serif}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 18%,#ffdbe9 0,transparent 24rem),radial-gradient(circle at 90% 85%,#ffd6e5 0,transparent 25rem),#fff7f9}.card{width:min(100%,430px);padding:46px 38px;border:1px solid rgba(255,255,255,.9);border-radius:28px;background:rgba(255,251,252,.9);box-shadow:0 20px 70px rgba(121,38,77,.14);text-align:center}.heart{font-size:38px;color:#ef6fa6;filter:drop-shadow(0 7px 9px #f9b4cd)}.eyebrow{margin:17px 0 10px;color:#cf3977;font:500 11px/1 ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase}h1{margin:0;font-size:clamp(34px,8vw,50px);letter-spacing:-.06em;line-height:.95}h1 em{color:#ef6fa6;font-family:Georgia,serif}p{color:#776875;line-height:1.6}form{margin-top:28px;text-align:left}label{display:grid;gap:8px;color:#654d5d;font-size:13px;font-weight:700}input{width:100%;border:1px solid #f0cbd9;border-radius:12px;padding:14px;outline:none;background:#fff;font:500 15px inherit}input:focus{border-color:#ef6fa6;box-shadow:0 0 0 3px #ffe0ec}button{width:100%;margin-top:18px;border:0;border-radius:999px;padding:14px 20px;color:white;background:linear-gradient(135deg,#f275a9,#d83f7c);box-shadow:0 8px 20px rgba(205,55,114,.23);font:700 14px inherit;cursor:pointer}.error{margin:15px 0 -7px;color:#c03670;font-size:13px}.tiny{margin:20px 0 0;color:#9c8994;font-size:12px}</style></head><body><main class="card"><div class="heart">♥</div><p class="eyebrow">Nur für euch zwei</p><h1>Booboo<br><em>Beschwerde Portal.</em></h1><p>Dieser kleine Ort ist privat. Gib den gemeinsamen Zugangscode ein, um weiterzugehen.</p><form method="post" action="/login"><label>Zugangscode<input name="password" type="password" autocomplete="current-password" required autofocus></label><button type="submit">Portal öffnen →</button></form>${message}<p class="tiny">Nicht öffentlich · keine fremden Beschwerden</p></main></body></html>`;
}

function responseWithNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const password = env.BOOBOO_PORTAL_PASSWORD;
  if (!password) return new Response('Das Portal ist noch nicht eingerichtet.', { status: 503 });

  const signedIn = await isValidSession(request, password);
  if (url.pathname === '/login') {
    if (request.method === 'POST') {
      const form = await request.formData().catch(() => null);
      const candidate = form?.get('password');
      if (typeof candidate !== 'string' || !(await passwordMatches(candidate, password))) return new Response(loginPage(true), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
      const payload = `v1.${expiry}.${nonce}`;
      const signature = base64url(new Uint8Array(await hmac(payload, password)));
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `booboo_gate=${payload}.${signature}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (signedIn) return Response.redirect(new URL('/', request.url), 303);
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
  }

  if (url.pathname === '/logout' && request.method === 'POST') {
    return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': 'booboo_gate=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' } });
  }

  if (!signedIn) {
    if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Der Portal-Zugangscode ist erforderlich.' }), { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    return Response.redirect(new URL('/login', request.url), 303);
  }

  return responseWithNoStore(await context.next());
}
