import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, unlinkSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { Engine } from '../src/engine.js';
import { config } from '../src/config.js';
import { logicalData } from '../src/database.js';
import { temporary } from '../test/helpers.js';
import { backupDatabase, digest } from './backup.js';

const temp = temporary(); let engine;
try {
  const options = config({ dbPath: temp.dbPath, antiMax: 0, userCapacity: 100, userRefill: 100 });
  engine = new Engine(options);
  const admin = { id: 'admin', role: 'admin' };
  const sold = engine.create({ item: 'Recovery demonstration', stock: 3, startingPrice: 100, minIncrement: 10, endsAt: Date.now() + 500 }, admin).state;
  for (let i = 0; i < 12; i++) assert.equal(engine.bid(sold.id, { id: `bidder-${i % 4}`, name: `Bidder ${i % 4}` }, 100 + i * 10, `seed-${i}`).ok, true);
  const open = engine.create({ item: 'RPO boundary auction', stock: 2, startingPrice: 100, minIncrement: 10, endsAt: Date.now() + 86400000 }, admin).state;
  await delay(550); engine.finalizeDue();
  assert.equal(engine.snapshot(sold.id).winners.length, 3);
  const checkpoint = Date.now(); const backup = backupDatabase(temp.dbPath, join(temp.dir, 'backups'));
  const baseline = logicalData(engine.db); assert.equal(digest(baseline), backup.manifest.logicalSha256);
  await delay(50);
  const afterBackup = engine.bid(open.id, { id: 'late-bidder', name: 'After backup' }, 100, 'not-in-backup');
  assert.equal(afterBackup.ok, true);
  engine.close();
  const failureAt = Date.now(); const begin = performance.now();
  // Only these exact files inside the freshly-created disposable workspace can be deleted.
  for (const suffix of ['', '-wal', '-shm']) {
    const target = resolve(temp.dbPath + suffix);
    assert.equal(target.startsWith(resolve(temp.dir) + '\\') || target.startsWith(resolve(temp.dir) + '/'), true);
    if (existsSync(target)) unlinkSync(target);
  }
  assert.equal(existsSync(temp.dbPath), false);
  assert.equal(digest(readFileSync(backup.path)), backup.manifest.sha256);
  copyFileSync(backup.path, temp.dbPath);
  engine = new Engine(options);
  const restored = logicalData(engine.db);
  assert.deepEqual(restored, baseline);
  assert.equal(restored.bids.some(b => b.id === afterBackup.bidId), false);
  const result = { status: 'PASS', executedAt: new Date().toISOString(), scope: 'Isolated SQLite engine recovery; Bacula NOT executed', checkpointSha256: digest(baseline), restoredSha256: digest(restored), backupFileSha256: backup.manifest.sha256, counts: backup.manifest.counts, restoredCounts: Object.fromEntries(Object.entries(restored).map(([key, rows]) => [key, rows.length])), lostPostBackupBids: 1, checkpointAgeAtFailureMs: failureAt - checkpoint, postBackupBidAt: afterBackup.serverTime, measuredRtoMs: Math.round((performance.now() - begin) * 100) / 100, rtoDefinition: 'Database deletion begins to reopened engine and exact logical verification; excludes backup creation and user/browser reconnection' };
  mkdirSync('docs/results', { recursive: true }); writeFileSync('docs/results/disaster.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} finally { engine?.close(); temp.cleanup(); }
