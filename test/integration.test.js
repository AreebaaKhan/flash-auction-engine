import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { temporary, client } from './helpers.js';

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
