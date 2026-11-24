import { randomUUID } from 'node:crypto';
import { openDatabase, acquireLock, transaction } from './database.js';

export const MAX_AMOUNT = 1_000_000_000;
const validMoney = n => Number.isSafeInteger(n) && n >= 1 && n <= MAX_AMOUNT;
const rank = (a, b) => b.amount - a.amount || a.version - b.version || a.userId.localeCompare(b.userId);
export class TokenBucket {
  constructor(capacity, refill) { this.capacity = capacity; this.refill = refill; this.entries = new Map(); }
  take(key, now = Date.now()) {
    const previous = this.entries.get(key) || { tokens: this.capacity, time: now };
    const tokens = Math.min(this.capacity, previous.tokens + Math.max(0, now - previous.time) * this.refill / 1000);
    this.entries.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, time: now });
    return tokens >= 1;
  }
  prune(now = Date.now()) { for (const [key, entry] of this.entries) if (now - entry.time > 300000) this.entries.delete(key); }
}

export class Engine {
  constructor(options) {
    this.options = options; this.now = options.now || Date.now;
    this.release = acquireLock(options.dbPath);
    try { this.db = openDatabase(options.dbPath); } catch (e) { this.release(); throw e; }
    this.epoch = randomUUID(); this.auctions = new Map(); this.positions = new Map();
    this.bucket = new TokenBucket(options.userCapacity, options.userRefill);
    this.dirty = new Set(); this.closed = false;
    for (const row of this.db.prepare('SELECT state FROM auctions').all()) { const state = JSON.parse(row.state); this.auctions.set(state.id, state); this.positions.set(state.id, new Map()); }
    for (const row of this.db.prepare('SELECT * FROM positions').all()) this.positions.get(row.auction_id)?.set(row.user_id, row.amount);
    this.q = {
      insertAuction: this.db.prepare('INSERT INTO auctions VALUES (?,?,?)'),
      updateAuction: this.db.prepare('UPDATE auctions SET version=?,state=? WHERE id=?'),
      outcome: this.db.prepare('SELECT amount,result FROM outcomes WHERE auction_id=? AND user_id=? AND key=?'),
      saveOutcome: this.db.prepare('INSERT INTO outcomes VALUES (?,?,?,?,?)'),
      bid: this.db.prepare('INSERT INTO bids VALUES (?,?,?,?,?,?)'),
      position: this.db.prepare('INSERT INTO positions VALUES (?,?,?,?) ON CONFLICT(auction_id,user_id) DO UPDATE SET amount=excluded.amount,version=excluded.version'),
      order: this.db.prepare('INSERT INTO orders VALUES (?,?,?,?) ON CONFLICT DO NOTHING')
    };
    this.finalizeDue();
  }
  create(input, user) {
    if (user?.role !== 'admin') return { ok: false, reason: 'FORBIDDEN' };
    if (!input || typeof input !== 'object') return { ok: false, reason: 'INVALID_AUCTION' };
    const now = this.now();
    const { item, stock, startingPrice, minIncrement } = input;
    const startsAt = input.startsAt ?? now;
    const endsAt = input.endsAt ?? startsAt + 180000;
    if (typeof item !== 'string' || item.trim().length < 2 || item.length > 100 || !Number.isInteger(stock) || stock < 1 || stock > 100 || !validMoney(startingPrice) || !validMoney(minIncrement) || !Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || endsAt <= Math.max(startsAt, now) || endsAt - now > 7 * 86400000) return { ok: false, reason: 'INVALID_AUCTION' };
    if (this.auctions.size >= 1000) return { ok: false, reason: 'AUCTION_LIMIT' };
    const a = { id: randomUUID(), item: item.trim(), stock, startingPrice, minIncrement, startsAt, endsAt, originalEndsAt: endsAt, version: 1, status: 'open', topN: [], bidCount: 0, highest: 0, extensions: 0, history: [], winners: [], antiWindowMs: this.options.antiWindowMs, antiExtensionMs: this.options.antiExtensionMs, antiMax: this.options.antiMax };
    this.q.insertAuction.run(a.id, a.version, JSON.stringify(a));
    this.auctions.set(a.id, a); this.positions.set(a.id, new Map()); this.dirty.add(a.id);
    return { ok: true, state: this.snapshot(a.id) };
  }
  snapshot(id) {
    const a = this.auctions.get(id); if (!a) return null;
    return { ...structuredClone(a), epoch: this.epoch, serverTime: this.now() };
  }
  list() { return [...this.auctions.keys()].reverse().map(id => this.snapshot(id)); }
  // This entire operation is synchronous. COMMIT precedes publishing state or ACK.
  bid(id, user, amount, key) {
    if (!user || !/^[a-zA-Z0-9_-]{1,64}$/.test(user.id)) return { ok: false, reason: 'UNAUTHORIZED' };
    if (typeof id !== 'string' || id.length > 100 || !validMoney(amount) || typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(key)) return { ok: false, reason: 'INVALID_BID' };
    const old = this.q.outcome.get(id, user.id, key);
    if (old) return old.amount === amount ? { ...JSON.parse(old.result), duplicate: true } : { ok: false, reason: 'IDEMPOTENCY_CONFLICT' };
    const a = this.auctions.get(id);
    if (!a) return { ok: false, reason: 'NOT_FOUND' };
    const now = this.now();
    const previous = this.positions.get(id).get(user.id);
    const threshold = a.topN.length >= a.stock ? a.topN.at(-1).amount + a.minIncrement : a.startingPrice;
    const minimum = Math.max(a.startingPrice, threshold, previous === undefined ? 0 : previous + a.minIncrement);
    let reason;
    if (!this.bucket.take(user.id, now)) reason = 'RATE_LIMITED';
    else if (a.status === 'ended' || now >= a.endsAt) reason = 'ENDED';
    else if (now < a.startsAt) reason = 'NOT_STARTED';
    else if (amount < minimum) reason = 'BID_TOO_LOW';
    if (reason) {
      const result = { ok: false, reason, minimum, version: a.version, serverTime: now };
      this.q.saveOutcome.run(id, user.id, key, amount, JSON.stringify(result));
      return result;
    }
    const next = structuredClone(a); next.version++; next.bidCount++;
    const bid = { userId: user.id, name: user.name || user.id, amount, version: next.version };
    next.topN = [...next.topN.filter(p => p.userId !== user.id), bid].sort(rank).slice(0, a.stock);
    next.highest = next.topN[0].amount;
    const extended = a.endsAt - now <= a.antiWindowMs && a.extensions < a.antiMax && a.antiExtensionMs > 0;
    if (extended) { next.endsAt += a.antiExtensionMs; next.extensions++; }
    next.history = [...a.history, { amount, time: now, userId: user.id }].slice(-30);
    const result = { ok: true, reason: 'ACCEPTED', bidId: randomUUID(), version: next.version, amount, serverTime: now, endsAt: next.endsAt, extended, duplicate: false };
    transaction(this.db, () => {
      this.q.bid.run(result.bidId, id, user.id, amount, next.version, now);
      this.q.position.run(id, user.id, amount, next.version);
      this.q.updateAuction.run(next.version, JSON.stringify(next), id);
      this.q.saveOutcome.run(id, user.id, key, amount, JSON.stringify(result));
    });
    this.auctions.set(id, next); this.positions.get(id).set(user.id, amount); this.dirty.add(id);
    return result;
  }
  finalizeDue() {
    const now = this.now();
    for (const [id, a] of this.auctions) {
      if (a.status === 'ended' || now < a.endsAt) continue;
      const next = { ...a, version: a.version + 1, status: 'ended', finalizedAt: now, winners: a.topN.map((p, i) => ({ ...p, rank: i + 1 })) };
      transaction(this.db, () => {
        for (const winner of next.winners) this.q.order.run(id, winner.userId, winner.amount, winner.rank);
        this.q.updateAuction.run(next.version, JSON.stringify(next), id);
      });
      this.auctions.set(id, next); this.dirty.add(id);
    }
    this.bucket.prune(now);
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); this.release(); } }
}
