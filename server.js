const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure dirs exist
[DATA_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');

const MIME_TYPES = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 50e6) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  let filePath = '';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  try {
    // API: GET /api/data
    if (url.pathname === '/api/data' && method === 'GET') {
      const data = readJSON(DATA_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // API: POST /api/data
    if (url.pathname === '/api/data' && method === 'POST') {
      const body = await parseBody(req);
      const { data } = body;
      if (!data) { res.writeHead(400); res.end(JSON.stringify({ success: false, message: 'No data' })); return; }
      const current = readJSON(DATA_FILE);
      const merged = { ...current, ...data };
      ['records', 'customers', 'customCats', 'customSubCats'].forEach(k => { if (!Array.isArray(merged[k])) merged[k] = []; });
      if (!merged.targets || typeof merged.targets !== 'object') merged.targets = {};
      writeJSON(DATA_FILE, merged);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // API: POST /api/upload (base64 image)
    if (url.pathname === '/api/upload' && method === 'POST') {
      const body = await parseBody(req);
      const { image } = body;
      if (!image) { res.writeHead(400); res.end(JSON.stringify({ success: false, message: 'No image' })); return; }
      const matches = image.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      if (!matches) { res.writeHead(400); res.end(JSON.stringify({ success: false, message: 'Invalid format' })); return; }
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const name = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, name), Buffer.from(matches[2], 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, url: '/uploads/' + name }));
      return;
    }

    // Serve uploaded files
    if (url.pathname.startsWith('/uploads/')) {
      filePath = path.join(UPLOADS_DIR, path.basename(url.pathname));
      if (fs.existsSync(filePath)) { serveFile(res, filePath); return; }
    }

    // Serve static files from public/
    filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveFile(res, filePath);
    } else {
      // Fallback to index.html
      serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }
  } catch (err) {
    console.error('Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:' + PORT);
  console.log('Serving from:', PUBLIC_DIR);
});
