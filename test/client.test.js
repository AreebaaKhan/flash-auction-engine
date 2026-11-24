import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveConnection } from '../public/connection.js';

test('browser connection resubscribes and retries original keys; ACKs remain separate', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousSocket = globalThis.WebSocket; const previousLocation = globalThis.location;
  const sockets = []; const statuses = []; const messages = [];
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    open() { this.readyState = 1; this.onopen(); }
    message(data) { this.onmessage({ data: JSON.stringify(data) }); }
    close(code = 1006) { this.readyState = 3; this.onclose({ code }); }
  }
  globalThis.WebSocket = FakeSocket; globalThis.location = { protocol: 'http:', host: 'example.test' };
  let connection;
  try {
    connection = new LiveConnection('token', m => messages.push(m), s => statuses.push(s));
    sockets[0].open(); assert.equal(sockets[0].sent[0].type, 'auth');
    sockets[0].message({ type: 'welcome' }); connection.subscribe('auction'); connection.bid(100);
    const request = sockets[0].sent.find(m => m.type === 'bid'); assert.equal(connection.pending.size, 1);
    sockets[0].close(); t.mock.timers.tick(20000);
    assert.equal(sockets.length, 2); sockets[1].open(); sockets[1].message({ type: 'welcome' });
    assert.ok(sockets[1].sent.some(m => m.type === 'subscribe' && m.auctionId === 'auction'));
    assert.deepEqual(sockets[1].sent.find(m => m.type === 'bid'), request);
    sockets[1].message({ type: 'state', state: { version: 100 } });
    sockets[1].message({ type: 'bid_result', requestId: request.requestId, version: 2, ok: true });
    assert.equal(connection.pending.size, 0); assert.equal(messages.at(-1).type, 'bid_result'); assert.ok(statuses.includes('Resynced'));
    connection.bid(110); const latest = sockets[1].sent.at(-1);
    sockets[1].message({ type: 'error', requestId: latest.requestId, reason: 'IP_RATE_LIMITED' }); assert.equal(connection.pending.size, 0);
  } finally { connection?.close(); globalThis.WebSocket = previousSocket; if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; }
});
