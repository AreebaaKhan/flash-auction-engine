import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { startServer } from '../src/server.js';
import { temporary, client } from '../test/helpers.js';

export function argument(name, fallback) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`)); const n = Number(arg ? arg.slice(name.length + 3) : fallback);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer.`); return n;
}
export const machine = () => ({ node: process.version, platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryGiB: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10 });
export function save(name, value) { mkdirSync('docs/results', { recursive: true }); writeFileSync(`docs/results/${name}`, JSON.stringify(value, null, 2) + '\n'); }
export function workload(attempts, concurrency) {
  const tasks = [];
  for (let i = 0; i < attempts; i++) {
    const slot = i % concurrency; const duplicate = Math.floor(i / concurrency) % 10 === 9;
    tasks.push({ index: i, slot, userId: `bot-${slot}`, amount: duplicate ? tasks[i - concurrency].amount : 100 + i * 10, key: duplicate ? tasks[i - concurrency].key : `request-${i}` });
  }
  return tasks;
}
const ranking = positions => [...positions.values()].sort((a, b) => b.amount - a.amount || a.version - b.version || a.userId.localeCompare(b.userId));
export function verifyEngine(engine, id, responses, tasks) {
  const rows = engine.db.prepare('SELECT * FROM bids WHERE auction_id=? ORDER BY version').all(id);
  const positions = new Map(); const topAt = new Map([[1, []]]); let expectedVersion = 2;
  for (const row of rows) {
    assert.equal(row.version, expectedVersion++);
    const before = ranking(positions).slice(0, 10); const previous = positions.get(row.user_id)?.amount || 0;
    const minimum = Math.max(100, previous ? previous + 10 : 0, before.length >= 10 ? before.at(-1).amount + 10 : 0);
    assert.ok(row.amount >= minimum, 'Accepted bid violated serial reference model');
    positions.set(row.user_id, { userId: row.user_id, amount: row.amount, version: row.version }); topAt.set(row.version, ranking(positions).slice(0, 10));
  }
  const successful = responses.filter(r => r.ok && !r.duplicate);
  assert.equal(rows.length, successful.length);
  const byId = new Map(rows.map(row => [row.id, row]));
  responses.forEach((r, i) => {
    if (r.ok) { const row = byId.get(r.bidId); assert.ok(row); assert.equal(row.amount, tasks[i].amount); assert.equal(row.user_id, tasks[i].userId); }
    else if (r.reason === 'BID_TOO_LOW') { assert.ok(tasks[i].amount < r.minimum); assert.ok(topAt.has(r.version)); }
    else assert.fail(`Unexpected contention rejection: ${r.reason}`);
  });
  const state = engine.snapshot(id); const expected = ranking(positions).slice(0, 10);
  assert.deepEqual(state.topN.map(({ userId, amount, version }) => ({ userId, amount, version })), expected);
  assert.equal(state.version, rows.length + 1); assert.equal(state.bidCount, rows.length);
  assert.equal(new Set(state.topN.map(p => p.userId)).size, state.topN.length);
  assert.ok(state.topN.length <= state.stock);
  assert.deepEqual(JSON.parse(engine.db.prepare('SELECT state FROM auctions WHERE id=?').get(id).state), engine.auctions.get(id));
  const storedPositions = engine.db.prepare('SELECT user_id,amount,version FROM positions WHERE auction_id=? ORDER BY user_id').all(id);
  assert.deepEqual(storedPositions.map(p => ({ ...p })), [...positions.values()].sort((a,b)=>a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0).map(p=>({user_id:p.userId,amount:p.amount,version:p.version})));
  return { acceptedEvents: rows.length, highest: state.highest, topN: expected, strictVersions: true, dbMatchesMemory: true, uniqueWinners: true, noOverselling: true };
}
export async function runContention({ attempts = 10000, concurrency = 128, persist = true } = {}) {
  if (concurrency > attempts || concurrency > 2000 || attempts > 100000) throw new Error('Use concurrency <= min(attempts, 2000), attempts <= 100000.');
  const temp = temporary(); let app; const clients = []; let logicalNow;
  try {
    app = await startServer({ dbPath: temp.dbPath, port: 0, userCapacity: 1000000, userRefill: 1000000, ipCapacity: 1000000, ipRefill: 1000000, antiMax: 0, maxConnections: 3000, now: () => logicalNow ?? Date.now() });
    const a = app.engine.create({ item: '10,000 bid contention', stock: 10, startingPrice: 100, minIncrement: 10, endsAt: Date.now() + 600000 }, { role: 'admin' }).state;
    await Promise.all(Array.from({ length: concurrency }, async (_, i) => { clients[i] = await client(app, { id: `bot-${i}`, name: `Bot ${i}`, role: 'bidder' }); }));
    const tasks = workload(attempts, concurrency); const responses = Array(attempts); const begin = performance.now();
    let inFlight = 0; let peakInFlight = 0;
    await Promise.all(clients.map(async (c, slot) => {
      for (let i = slot; i < attempts; i += concurrency) { inFlight++; peakInFlight = Math.max(peakInFlight, inFlight); responses[i] = await c.bid(a.id, tasks[i].amount, tasks[i].key); inFlight--; }
    }));
    const elapsedMs = performance.now() - begin; const rejectedByReason = {}; let accepted = 0, duplicates = 0;
    for (const r of responses) { if (r.duplicate) duplicates++; else if (r.ok) accepted++; else rejectedByReason[r.reason] = (rejectedByReason[r.reason] || 0) + 1; }
    const verification = verifyEngine(app.engine, a.id, responses, tasks);
    logicalNow = a.endsAt; app.engine.finalizeDue(); app.engine.finalizeDue();
    const orders = app.engine.db.prepare('SELECT * FROM orders WHERE auction_id=? ORDER BY rank').all(a.id);
    assert.deepEqual(orders.map(o=>[o.user_id,o.amount]), verification.topN.map(p=>[p.userId,p.amount]));
    const result = { status: 'PASS', executedAt: new Date().toISOString(), machine: machine(), transport: 'real WebSockets, ephemeral localhost server, disk-backed SQLite WAL FULL', attempts, connections: concurrency, configuredConcurrency: concurrency, peakInFlight, accepted, rejected: attempts - accepted - duplicates, rejectedByReason, duplicates, elapsedMs: Math.round(elapsedMs), attemptsPerSecond: Math.round(attempts / (elapsedMs / 1000)), rateLimits: 'Raised only in isolated benchmark to measure contention; production defaults unchanged', verification: { ...verification, persistedOrders: orders.length, repeatFinalizationSafe: true } };
    if (persist) save('contention.json', result); return result;
  } finally { for (const c of clients) c?.close(); if (app) await app.close(); temp.cleanup(); }
}
