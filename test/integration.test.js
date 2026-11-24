import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { temporary, client } from './helpers.js';
import { WebSocket } from 'ws';

test('vertical slice: HTTP login/create, WebSocket bid/push, SQLite and restart', async () => {
  const temp = temporary(); let app; let bidder; let observer;
  try {
    app = await startServer({ dbPath: temp.dbPath, port: 0, antiMax: 0 });
    const login = await fetch(app.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'admin' }) }).then(r => r.json());
    const response = await fetch(app.url + '/api/auctions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ item: 'Vertical slice', stock: 2, startingPrice: 100, minIncrement: 10 }) });
    assert.equal(response.status, 201); const { state } = await response.json();
    bidder = await client(app); observer = await client(app, { id: 'sara', name: 'Sara', role: 'bidder' });
    await observer.subscribe(state.id);
    const bid = await bidder.bid(state.id, 100, 'vertical-1'); assert.equal(bid.ok, true);
    const pushed = await observer.wait(m => m.type === 'state' && m.state.version === 2); assert.equal(pushed.state.highest, 100);
    assert.equal(app.engine.db.prepare('SELECT count(*) AS n FROM bids').get().n, 1);
    assert.equal((await fetch(app.url)).status, 200);
    bidder.close(); observer.close(); await app.close();
    app = await startServer({ dbPath: temp.dbPath, port: 0 });
    assert.equal(app.engine.snapshot(state.id).highest, 100);
    bidder = await client(app); const snapshot = await bidder.subscribe(state.id); assert.equal(snapshot.state.version, 2);
    const repeated = await bidder.bid(state.id, 100, 'vertical-1'); assert.equal(repeated.duplicate, true);
  } finally { bidder?.close(); observer?.close(); if (app) await app.close(); temp.cleanup(); }
});

test('admin-only creation, malformed messages, snapshots after reconnect and finalization push', async () => {
  const temp = temporary(); let app; let c;
  try {
    app = await startServer({ dbPath: temp.dbPath, port: 0, antiMax: 0 });
    const unauthorized = await fetch(app.url + '/api/auctions', { method: 'POST', body: '{}' }); assert.equal(unauthorized.status, 401);
    const login = await fetch(app.url + '/api/login', { method: 'POST', body: JSON.stringify({ userId: 'sara' }) }).then(r => r.json());
    const forbidden = await fetch(app.url + '/api/auctions', { method: 'POST', headers: { Authorization: `Bearer ${login.token}` }, body: '{}' }); assert.equal(forbidden.status, 403);
    const a = app.engine.create({ item: 'Reconnect', stock: 1, startingPrice: 100, minIncrement: 10, endsAt: Date.now() + 1500 }, { role: 'admin' }).state;
    c = await client(app); c.send({ type: 'bid', amount: 100, idempotencyKey: 'malformed', requestId: 'bad' });
    assert.equal((await c.wait(m => m.requestId === 'bad')).reason, 'INVALID_BID');
    const initial = await c.subscribe(a.id); c.close();
    app.engine.bid(a.id, { id: 'hamza', name: 'Hamza' }, 100, 'offline');
    c = await client(app); const snapshot = await c.subscribe(a.id); assert.ok(snapshot.state.version > initial.state.version); assert.equal(snapshot.state.highest, 100);
    const ended = await c.wait(m => m.type === 'state' && m.state.status === 'ended'); assert.equal(ended.state.winners[0].userId, 'hamza');
    assert.equal((await fetch(app.url + '/health')).status, 200); assert.match(await (await fetch(app.url + '/metrics')).text(), /flashroom_connections/);
  } finally { c?.close(); if (app) await app.close(); temp.cleanup(); }
});

test('per-IP HTTP rate limiting and global WebSocket connection cap', async () => {
  let app; let c;
  try {
    app = await startServer({ dbPath: ':memory:', port: 0, ipCapacity: 1, ipRefill: 1 });
    assert.equal((await fetch(app.url + '/api/users')).status, 200); assert.equal((await fetch(app.url + '/api/users')).status, 429); await app.close();
    app = await startServer({ dbPath: ':memory:', port: 0, maxConnections: 1 }); c = await client(app);
    const status = await new Promise((resolve, reject) => { const extra = new WebSocket(app.url.replace('http:', 'ws:') + '/ws'); extra.on('unexpected-response', (_req, res) => { const status = res.statusCode; res.resume(); extra.terminate(); resolve(status); }); extra.on('error', () => {}); extra.on('open', () => { extra.terminate(); reject(new Error('Connection cap was bypassed')); }); });
    assert.equal(status, 503);
  } finally { c?.close(); if (app) await app.close(); }
});

test('WebSocket authentication rejects invalid tokens', async () => {
  const app = await startServer({ dbPath: ':memory:', port: 0 });
  try {
    const code = await new Promise((resolve, reject) => { const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws'); ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'invalid' }))); ws.on('close', resolve); ws.on('error', reject); });
    assert.equal(code, 1008);
  } finally { await app.close(); }
});
