import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine, TokenBucket } from './engine.js';
import { config } from './config.js';
import { USERS, signToken, verifyToken } from './auth.js';

const publicRoot = new URL('../public/', import.meta.url);
const files = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/demo.html', 'demo.html'], ['/app.js', 'app.js'], ['/demo.js', 'demo.js'], ['/styles.css', 'styles.css'], ['/connection.js', 'connection.js'], ['/favicon.svg', 'favicon.svg']]);
const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
const catalog = engine => engine.list().map(({ history, topN, winners, ...a }) => a);

async function body(req) {
  let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 16384) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }); }
  try { return JSON.parse(value || '{}'); } catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}
export async function startServer(overrides = {}) {
  const cfg = config(overrides); const engine = new Engine(cfg);
  const ips = new TokenBucket(cfg.ipCapacity, cfg.ipRefill);
  const counters = { attempts: 0, accepted: 0, rejected: 0, duplicates: 0, slowClients: 0, connectionsTotal: 0 };
  const rejections = {}; const connectionsByIp = new Map();
  let stopping = false; let failed = false;
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, stopping || failed ? 503 : 200, { ok: !stopping && !failed, epoch: engine.epoch, instance: 'node-1', database: 'sqlite-wal', auctions: engine.auctions.size, serverTime: Date.now() });
      if (!ips.take(req.socket.remoteAddress || 'unknown')) return json(res, 429, { ok: false, reason: 'IP_RATE_LIMITED' });
      if (req.method === 'GET' && url.pathname === '/metrics') {
        const metrics = { ...counters, connections: wss.clients.size, auctions: engine.auctions.size, rssBytes: process.memoryUsage().rss, uptimeSeconds: process.uptime() };
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(Object.entries(metrics).map(([key, value]) => `flashroom_${key} ${value}`).join('\n') + '\n' + Object.entries(rejections).map(([key, value]) => `flashroom_rejections{reason="${key}"} ${value}`).join('\n') + '\n');
      }
      if (req.method === 'GET' && url.pathname === '/api/users') return json(res, 200, USERS);
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const input = await body(req); const user = USERS.find(u => u.id === input.userId);
        return user ? json(res, 200, { token: signToken(user, cfg.secret), user }) : json(res, 400, { ok: false, reason: 'UNKNOWN_USER' });
      }
      if (req.method === 'GET' && url.pathname === '/api/auctions') return json(res, 200, engine.list());
      if (req.method === 'POST' && url.pathname === '/api/auctions') {
        const user = verifyToken(req.headers.authorization?.replace(/^Bearer /, ''), cfg.secret);
        if (!user) return json(res, 401, { ok: false, reason: 'UNAUTHORIZED' });
        if (user.role !== 'admin') return json(res, 403, { ok: false, reason: 'FORBIDDEN' });
        const result = engine.create(await body(req), user);
        return json(res, result.ok ? 201 : 400, result);
      }
      const id = url.pathname.match(/^\/api\/auctions\/([a-f0-9-]+)$/)?.[1];
      if (req.method === 'GET' && id) { const state = engine.snapshot(id); return json(res, state ? 200 : 404, state || { ok: false, reason: 'NOT_FOUND' }); }
      const file = req.method === 'GET' && files.get(url.pathname);
      if (file) {
        const data = await readFile(new URL(file, publicRoot));
        res.writeHead(200, { 'Content-Type': `${mime[file.split('.').at(-1)]}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'" });
        return res.end(data);
      }
      json(res, 404, { ok: false, reason: 'NOT_FOUND' });
    } catch (e) { console.error('HTTP:', e.message); if (!res.headersSent) json(res, e.status || 500, { ok: false, reason: e.status ? e.message : 'INTERNAL_ERROR' }); else res.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > cfg.maxBuffer) { counters.slowClients++; ws.terminate(); return; }
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
  server.on('upgrade', (req, socket, head) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const origin = req.headers.origin;
    let originValid = true;
    try { if (origin) originValid = new URL(origin).host === req.headers.host; } catch { originValid = false; }
    if (stopping || failed || req.url !== '/ws' || !originValid || wss.clients.size >= cfg.maxConnections || (connectionsByIp.get(ip) || 0) >= cfg.maxConnectionsPerIp || !ips.take(ip)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.ip = ip; wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    counters.connectionsTotal++; connectionsByIp.set(ws.ip, (connectionsByIp.get(ws.ip) || 0) + 1);
    ws.alive = true; ws.user = null; ws.auctionId = null;
    const authTimeout = setTimeout(() => { if (!ws.user) ws.close(1008, 'Authentication required'); }, 5000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { clearTimeout(authTimeout); const count = (connectionsByIp.get(ws.ip) || 1) - 1; if (count) connectionsByIp.set(ws.ip, count); else connectionsByIp.delete(ws.ip); });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (!msg || typeof msg !== 'object') return send(ws, { type: 'error', reason: 'INVALID_MESSAGE' });
        const requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 100) : null;
        if (!ips.take(ws.ip)) return send(ws, { type: 'error', reason: 'IP_RATE_LIMITED', requestId });
        if (msg.type === 'auth') {
          if (ws.user) return send(ws, { type: 'error', reason: 'ALREADY_AUTHENTICATED', requestId });
          ws.user = verifyToken(msg.token, cfg.secret);
          if (!ws.user) return ws.close(1008, 'Invalid token');
          clearTimeout(authTimeout);
          send(ws, { type: 'welcome', user: ws.user, epoch: engine.epoch, serverTime: Date.now(), instance: 'node-1' });
          return send(ws, { type: 'catalog', auctions: catalog(engine), epoch: engine.epoch });
        }
        if (!ws.user || ws.user.exp <= Date.now() / 1000) return ws.close(1008, 'Authentication required');
        if (msg.type === 'subscribe') {
          if (typeof msg.auctionId !== 'string') return send(ws, { type: 'error', reason: 'INVALID_MESSAGE', requestId });
          const state = engine.snapshot(msg.auctionId);
          if (!state) return send(ws, { type: 'error', reason: 'NOT_FOUND', requestId });
          ws.auctionId = msg.auctionId; return send(ws, { type: 'snapshot', requestId, state });
        }
        if (msg.type === 'bid') {
          if (failed || stopping) return send(ws, { type: 'error', reason: 'UNAVAILABLE', requestId });
          counters.attempts++;
          const result = engine.bid(msg.auctionId, ws.user, msg.amount, msg.idempotencyKey);
          if (result.duplicate) counters.duplicates++;
          else if (result.ok) counters.accepted++;
          else { counters.rejected++; rejections[result.reason] = (rejections[result.reason] || 0) + 1; }
          return send(ws, { type: 'bid_result', requestId, auctionId: msg.auctionId, ...result });
        }
        send(ws, { type: 'error', reason: 'UNKNOWN_MESSAGE', requestId });
      } catch (e) { if (e instanceof SyntaxError) send(ws, { type: 'error', reason: 'INVALID_JSON' }); else { console.error('Bid operation failed:', e.message); failed = true; ws.close(1011, 'Storage failure; restart required'); } }
    });
  });
  const broadcast = setInterval(() => {
    if (!engine.dirty.size) return;
    const changed = new Set(engine.dirty); engine.dirty.clear();
    const summary = JSON.stringify({ type: 'catalog', auctions: catalog(engine), epoch: engine.epoch });
    const snapshots = new Map([...changed].map(id => [id, JSON.stringify({ type: 'state', state: engine.snapshot(id) })]));
    for (const ws of wss.clients) if (ws.user) { send(ws, summary); if (snapshots.has(ws.auctionId)) send(ws, snapshots.get(ws.auctionId)); }
  }, cfg.broadcastMs);
  let lastClockPush = 0;
  const clock = setInterval(() => {
    try { if (!failed) engine.finalizeDue(); } catch (e) { failed = true; console.error('Finalization failed:', e.message); }
    if (Date.now() - lastClockPush >= 1000) {
      lastClockPush = Date.now(); const message = JSON.stringify({ type: 'clock', serverTime: lastClockPush, epoch: engine.epoch });
      for (const ws of wss.clients) if (ws.user) send(ws, message);
    }
    ips.prune();
  }, 250);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive || (ws.user && ws.user.exp <= Date.now() / 1000)) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, cfg.heartbeatMs);
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); }); }
  catch (e) { clearInterval(broadcast); clearInterval(clock); clearInterval(heartbeat); engine.close(); throw e; }
  const address = server.address();
  return { cfg, engine, server, wss, counters, url: `http://${cfg.host}:${address.port}`, async close() {
    if (stopping) return; stopping = true;
    clearInterval(broadcast); clearInterval(clock); clearInterval(heartbeat);
    const closing = new Promise(resolve => server.close(resolve));
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    const timeout = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); server.closeAllConnections(); }, 1000);
    await closing; clearTimeout(timeout); await new Promise(resolve => wss.close(resolve)); engine.close();
  } };
}
