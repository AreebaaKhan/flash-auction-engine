import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '../src/auth.js';

export function temporary() { const dir = mkdtempSync(join(tmpdir(), 'flashroom-')); return { dir, dbPath: join(dir, 'auction.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }; }
export async function client(app, user = { id: 'ayesha', name: 'Ayesha', role: 'bidder' }, token) {
  const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws');
  const messages = []; const listeners = new Set();
  ws.on('message', raw => { const m = JSON.parse(raw); messages.push(m); for (const listener of listeners) listener(m); });
  ws.on('error', () => {});
  const wait = (predicate, timeout = 10000) => new Promise((resolve, reject) => {
    const found = messages.find(predicate); if (found) return resolve(found);
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for WebSocket message')); }, timeout);
    function check(m) { if (predicate(m)) { clearTimeout(timer); listeners.delete(check); resolve(m); } }
    listeners.add(check);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', token: token || signToken(user, app.cfg.secret) }));
  await wait(m => m.type === 'welcome');
  return { ws, messages, wait, send: m => ws.send(JSON.stringify(m)), async subscribe(auctionId) { const requestId = randomUUID(); ws.send(JSON.stringify({ type: 'subscribe', auctionId, requestId })); return wait(m => m.type === 'snapshot' && m.requestId === requestId); }, async bid(auctionId, amount, idempotencyKey = randomUUID()) { const requestId = randomUUID(); ws.send(JSON.stringify({ type: 'bid', auctionId, amount, idempotencyKey, requestId })); return wait(m => m.type === 'bid_result' && m.requestId === requestId); }, close: () => ws.terminate() };
}
