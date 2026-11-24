import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { config } from '../src/config.js';
import { temporary } from './helpers.js';
const admin = { id: 'admin', role: 'admin' };
const user = id => ({ id, name: id, role: 'bidder' });
function fixture(options = {}) { let clock = 100000; const e = new Engine(config({ dbPath: ':memory:', now: () => clock, userCapacity: 100, userRefill: 100, antiMax: 0, ...options })); return { e, setTime: t => clock = t, create: (extra = {}) => e.create({ item: 'Test auction', stock: 2, startingPrice: 100, minIncrement: 10, startsAt: 100000, endsAt: 200000, ...extra }, admin).state }; }

test('multi-stock cutoff, own minimum, deterministic ties, unique winners', () => {
  const { e, create, setTime } = fixture(); try {
    const a = create(); assert.equal(e.bid(a.id, user('a'), 200, '1').ok, true);
    assert.equal(e.bid(a.id, user('b'), 100, '1').ok, true);
    assert.equal(e.bid(a.id, user('c'), 110, '1').ok, true); // Below global highest, valid for stock 2.
    assert.equal(e.bid(a.id, user('a'), 205, '2').reason, 'BID_TOO_LOW');
    assert.equal(e.bid(a.id, user('a'), 210, '3').ok, true);
    assert.equal(e.bid(a.id, user('b'), 119, '2').reason, 'BID_TOO_LOW');
    assert.deepEqual(e.snapshot(a.id).topN.map(p => p.userId), ['a', 'c']);
    setTime(200000); assert.equal(e.bid(a.id, user('d'), 999, '1').reason, 'ENDED'); e.finalizeDue(); e.finalizeDue();
    assert.equal(e.snapshot(a.id).version, 6); assert.equal(e.db.prepare('SELECT count(*) n FROM orders').get().n, 2);
    assert.equal(new Set(e.snapshot(a.id).winners.map(w => w.userId)).size, 2);
  } finally { e.close(); }
});
test('equal prices before stock fills rank by accepted version', () => {
  const { e, create } = fixture(); try { const a = create({ stock: 3 }); for (const id of ['z', 'b', 'a']) assert.equal(e.bid(a.id, user(id), 100, 'same').ok, true); assert.deepEqual(e.snapshot(a.id).topN.map(p => p.userId), ['z', 'b', 'a']); } finally { e.close(); }
});
test('validation, authorization, opening time and integer money', () => {
  const { e, create, setTime } = fixture(); try {
    assert.equal(e.create({}, user('a')).reason, 'FORBIDDEN'); assert.equal(e.create(null, admin).reason, 'INVALID_AUCTION');
    const a = create({ startsAt: 110000 }); assert.equal(e.bid(a.id, user('a'), 100, 'x').reason, 'NOT_STARTED');
    setTime(110000); for (const n of [NaN, Infinity, -1, 0, 1.2, 1000000001, '100']) assert.equal(e.bid(a.id, user('a'), n, 'bad').reason, 'INVALID_BID');
    assert.equal(e.bid(undefined, user('a'), 100, 'x').reason, 'INVALID_BID');
    assert.equal(e.bid(a.id, null, 100, 'x').reason, 'UNAUTHORIZED');
    assert.equal(e.bid(a.id, user('a'), 100, 'new').ok, true);
  } finally { e.close(); }
});
test('idempotency caches outcomes and scopes to user and payload', () => {
  const { e, create } = fixture(); try {
    const a = create(); const first = e.bid(a.id, user('a'), 100, 'key');
    assert.deepEqual(e.bid(a.id, user('a'), 100, 'key'), { ...first, duplicate: true });
    assert.equal(e.bid(a.id, user('a'), 110, 'key').reason, 'IDEMPOTENCY_CONFLICT');
    assert.equal(e.bid(a.id, user('b'), 100, 'key').ok, true);
    const rejection = e.bid(a.id, user('c'), 100, 'low'); assert.equal(rejection.reason, 'BID_TOO_LOW');
    assert.equal(e.bid(a.id, user('c'), 100, 'low').duplicate, true); assert.equal(e.snapshot(a.id).bidCount, 2);
  } finally { e.close(); }
});
test('token bucket refills and duplicate retries do not spend tokens', () => {
  const { e, create, setTime } = fixture({ userCapacity: 1, userRefill: 1 }); try {
    const a = create(); assert.equal(e.bid(a.id, user('a'), 100, '1').ok, true);
    assert.equal(e.bid(a.id, user('a'), 100, '1').duplicate, true);
    assert.equal(e.bid(a.id, user('a'), 110, '2').reason, 'RATE_LIMITED');
    setTime(101000); assert.equal(e.bid(a.id, user('a'), 110, '3').ok, true);
  } finally { e.close(); }
});
test('anti-sniping uses server time, increments end and honors maximum', () => {
  const { e, create, setTime } = fixture({ antiMax: 2, antiWindowMs: 10000, antiExtensionMs: 10000 }); try {
    const a = create({ endsAt: 105000 }); assert.equal(e.bid(a.id, user('a'), 100, '1').extended, true);
    setTime(110000); assert.equal(e.bid(a.id, user('a'), 110, '2').extended, true);
    setTime(120000); assert.equal(e.bid(a.id, user('a'), 120, '3').extended, false);
    assert.equal(e.snapshot(a.id).endsAt, 125000); assert.equal(e.snapshot(a.id).extensions, 2);
  } finally { e.close(); }
});
test('failed database commit leaves memory and all bid tables unchanged', () => {
  const { e, create } = fixture(); try {
    const a = create(); e.db.exec("CREATE TRIGGER fail_bid BEFORE INSERT ON bids BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;");
    assert.throws(() => e.bid(a.id, user('a'), 100, '1'), /simulated storage failure/);
    assert.equal(e.snapshot(a.id).version, 1); assert.equal(e.db.prepare('SELECT count(*) n FROM positions').get().n, 0); assert.equal(e.db.prepare('SELECT count(*) n FROM outcomes').get().n, 0);
  } finally { e.close(); }
});
test('restart resumes overdue finalization once and preserves idempotency', () => {
  const temp = temporary(); let e; try {
    let clock = 1000; const options = config({ dbPath: temp.dbPath, now: () => clock, antiMax: 0 });
    e = new Engine(options); const a = e.create({ item: 'Restart', stock: 1, startingPrice: 100, minIncrement: 10, endsAt: 2000 }, admin).state;
    e.bid(a.id, user('a'), 100, 'key'); const epoch = e.epoch; e.close(); clock = 3000;
    e = new Engine(options); assert.notEqual(e.epoch, epoch); assert.equal(e.snapshot(a.id).status, 'ended'); assert.equal(e.snapshot(a.id).version, 3);
    assert.equal(e.bid(a.id, user('a'), 100, 'key').duplicate, true); e.close(); e = new Engine(options);
    assert.equal(e.db.prepare('SELECT count(*) n FROM orders').get().n, 1); assert.equal(e.snapshot(a.id).version, 3);
  } finally { e?.close(); temp.cleanup(); }
});
