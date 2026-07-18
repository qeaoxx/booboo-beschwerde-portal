const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.BOOBOO_ADMIN_PASSWORD || '';
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'complaints.json');

function readComplaints() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeComplaints(complaints) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(complaints, null, 2));
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) reject(new Error('Request body is too large.'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON.')); }
    });
  });
}

function isAdmin(request) {
  return Boolean(adminPassword) && request.headers['x-admin-password'] === adminPassword;
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function serveFile(requestPath, response) {
  const requested = requestPath === '/' ? '/index.html' : requestPath;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return send(response, 403, { error: 'Forbidden' });
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  fs.readFile(filePath, (error, content) => {
    if (error) return send(response, 404, 'Not found', 'text/plain; charset=utf-8');
    send(response, 200, content.toString(), types[path.extname(filePath)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === '/api/complaints' && request.method === 'POST') {
      const body = await readBody(request);
      const title = cleanText(body.title, 90);
      const details = cleanText(body.details, 2500);
      const category = cleanText(body.category, 40) || 'Other';
      const mood = cleanText(body.mood, 12) || '😤';
      if (!title || !details) return send(response, 400, { error: 'Bitte ergänze einen Titel und ein paar Details.' });
      const complaints = readComplaints();
      const complaint = { id: crypto.randomUUID(), title, details, category, mood, status: 'new', createdAt: new Date().toISOString() };
      complaints.unshift(complaint);
      writeComplaints(complaints);
      return send(response, 201, { complaint });
    }

    if (url.pathname === '/api/complaints' && request.method === 'GET') {
      if (!isAdmin(request)) return send(response, 401, { error: 'Passwort erforderlich.' });
      return send(response, 200, { complaints: readComplaints() });
    }

    const complaintMatch = url.pathname.match(/^\/api\/complaints\/([\w-]+)$/);
    if (complaintMatch && request.method === 'PATCH') {
      if (!isAdmin(request)) return send(response, 401, { error: 'Passwort erforderlich.' });
      const body = await readBody(request);
      if (!['new', 'heard', 'resolved'].includes(body.status)) return send(response, 400, { error: 'Ungültiger Status.' });
      const complaints = readComplaints();
      const complaint = complaints.find((item) => item.id === complaintMatch[1]);
      if (!complaint) return send(response, 404, { error: 'Beschwerde nicht gefunden.' });
      complaint.status = body.status;
      writeComplaints(complaints);
      return send(response, 200, { complaint });
    }

    if (complaintMatch && request.method === 'DELETE') {
      if (!isAdmin(request)) return send(response, 401, { error: 'Passwort erforderlich.' });
      const complaints = readComplaints();
      const remaining = complaints.filter((item) => item.id !== complaintMatch[1]);
      if (remaining.length === complaints.length) return send(response, 404, { error: 'Beschwerde nicht gefunden.' });
      writeComplaints(remaining);
      return send(response, 200, { ok: true });
    }

    if (request.method === 'GET') return serveFile(url.pathname, response);
    return send(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return send(response, 500, { error: 'Something went wrong. Please try again.' });
  }
});

server.listen(port, () => console.log(`Booboo Beschwerde Portal ist bereit unter http://localhost:${port}`));
