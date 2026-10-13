// Loopback endpoint the real-browser extension reports to. Port and token are
// kept in bridge.json so an already-running browser keeps working across restarts.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const MAX_BODY = 8 * 1024 * 1024;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
  });
}

// handlers: { activity(id), avatar(id, payload) }
async function startBridge(dataDir, handlers) {
  const file = path.join(dataDir, 'bridge.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let token = saved.token || crypto.randomBytes(24).toString('hex');
  const validToken = (t) => {
    const got = Buffer.from(String(t || ''));
    const expected = Buffer.from(token);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };

  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/(activity|avatar)\/([^/?]+)$/);
    const ok = req.method === 'POST' && m && validToken(req.headers['x-bot-bubble']);
    if (!ok) { res.writeHead(404).end(); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      res.writeHead(204).end();
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        handlers[m[1]](decodeURIComponent(m[2]), payload);
      } catch (e) { console.error(`bridge: ${e.message}`); }
    });
  });

  let port;
  try {
    port = await listen(server, saved.port || 0);
  } catch {
    // Something else holds our old port and may have collected the token from a
    // still-running extension, so start over with a new one.
    port = await listen(server, 0);
    token = crypto.randomBytes(24).toString('hex');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ port, token }), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { port, token };
}

module.exports = { startBridge };
