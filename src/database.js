import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bids (id TEXT PRIMARY KEY, auction_id TEXT NOT NULL REFERENCES auctions(id), user_id TEXT NOT NULL, amount INTEGER NOT NULL, version INTEGER NOT NULL, accepted_at INTEGER NOT NULL, UNIQUE(auction_id, version));
    CREATE TABLE IF NOT EXISTS positions (auction_id TEXT NOT NULL REFERENCES auctions(id), user_id TEXT NOT NULL, amount INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(auction_id,user_id));
    CREATE TABLE IF NOT EXISTS outcomes (auction_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, amount INTEGER NOT NULL, result TEXT NOT NULL, PRIMARY KEY(auction_id,user_id,key));
    CREATE TABLE IF NOT EXISTS orders (auction_id TEXT NOT NULL REFERENCES auctions(id), user_id TEXT NOT NULL, amount INTEGER NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY(auction_id,user_id), UNIQUE(auction_id,rank));
    CREATE INDEX IF NOT EXISTS bids_auction ON bids(auction_id, version);
  `);
  return db;
}
export function acquireLock(path) {
  if (path === ':memory:') return () => {};
  const lock = `${resolve(path)}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  try {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); throw new Error(`Database is already owned by process ${pid}. Stop that server first.`); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    unlinkSync(lock);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const fd = openSync(lock, 'wx');
  writeFileSync(fd, String(process.pid)); closeSync(fd);
  return () => { try { unlinkSync(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function logicalData(db) {
  return {
    auctions: db.prepare('SELECT * FROM auctions ORDER BY id').all(),
    bids: db.prepare('SELECT * FROM bids ORDER BY auction_id, version').all(),
    positions: db.prepare('SELECT * FROM positions ORDER BY auction_id, user_id').all(),
    orders: db.prepare('SELECT * FROM orders ORDER BY auction_id, rank').all(),
    outcomes: db.prepare('SELECT * FROM outcomes ORDER BY auction_id, user_id, key').all()
  };
}
