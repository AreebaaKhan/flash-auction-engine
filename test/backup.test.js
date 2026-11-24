import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Engine } from '../src/engine.js';
import { config } from '../src/config.js';
import { backupDatabase, digest } from '../scripts/backup.js';
import { temporary } from './helpers.js';
import { logicalData } from '../src/database.js';

test('VACUUM INTO captures live WAL, verifies checksum and applies retention', () => {
  const temp = temporary(); const e = new Engine(config({ dbPath: temp.dbPath }));
  try {
    const a = e.create({ item: 'Backup test', stock: 1, startingPrice: 100, minIncrement: 10 }, { role: 'admin' }).state;
    e.bid(a.id, { id: 'a', name: 'A' }, 100, 'key');
    const output = join(temp.dir, 'backups');
    const first = backupDatabase(temp.dbPath, output, { keep: 1 });
    assert.equal(first.manifest.sha256, digest(readFileSync(first.path)));
    const db = new DatabaseSync(first.path, { readOnly: true }); try { assert.deepEqual(logicalData(db), logicalData(e.db)); } finally { db.close(); }
    backupDatabase(temp.dbPath, output, { keep: 1 }); assert.equal(readdirSync(output).filter(f => f.endsWith('.db')).length, 1);
  } finally { e.close(); temp.cleanup(); }
});
