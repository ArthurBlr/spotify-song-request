// Small helpers shared by the API handlers (Web-standard Request/Response).

const NO_STORE = { 'cache-control': 'no-store' };

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  });
}

/** Error payload understood by the front end: a stable code plus a French message. */
export function fail(status, error, message, extra = {}) {
  return json({ error, message, ...extra }, status);
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** Minimal HTML page for the two setup screens (login errors, callback). */
export function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="app">
<header class="top"><h1>${escapeHtml(title)}</h1></header>
<section class="card prose">
${bodyHtml}
</section>
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer', ...NO_STORE },
  });
}

export function requestUrl(request) {
  return new URL(request.url, 'http://localhost');
}

function first(value) {
  return (value ?? '').split(',')[0].trim();
}

/**
 * Origin the visitor actually used (https://my-app.vercel.app). Behind a proxy
 * the forwarded headers are authoritative; locally they are absent.
 */
export function publicOrigin(request) {
  const url = requestUrl(request);
  const headers = request.headers;
  const host = first(headers.get('x-forwarded-host')) || headers.get('host') || url.host;
  const proto = first(headers.get('x-forwarded-proto')) || url.protocol.slice(0, -1);
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

export function clientIp(request) {
  return first(request.headers.get('x-forwarded-for')) || request.headers.get('x-real-ip') || 'local';
}

export function readCookies(request) {
  const cookies = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

export function setCookie(request, name, value, maxAge) {
  const secure = publicOrigin(request).startsWith('https://') ? '; Secure' : '';
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
