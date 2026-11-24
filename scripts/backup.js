import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logicalData } from '../src/database.js';

export const digest = data => createHash('sha256').update(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)).digest('hex');
export function backupDatabase(source = process.env.DB_PATH || './data/auction.db', directory = './backups', options = {}) {
  const keep = Number(options.keep ?? process.env.BACKUP_KEEP ?? 10);
  if (!Number.isInteger(keep) || keep < 1 || keep > 1000) throw new Error('BACKUP_KEEP must be 1–1000.');
  source = resolve(source); directory = resolve(directory);
  if (!existsSync(source)) throw new Error('Database does not exist. Start the app and create an auction first.');
  mkdirSync(directory, { recursive: true });
  const filename = `snapshot-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.db`;
  const target = join(directory, filename); const temporary = target + '.tmp';
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try { sourceDb.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;'); sourceDb.prepare('VACUUM INTO ?').run(temporary); }
  finally { sourceDb.close(); }
  let data;
  const snapshot = new DatabaseSync(temporary, { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
    data = logicalData(snapshot);
  } finally { snapshot.close(); }
  renameSync(temporary, target);
  const manifest = { filename, createdAt: new Date().toISOString(), label: options.label || 'full', format: 'complete SQLite snapshot; not a block-level incremental backup', sha256: digest(readFileSync(target)), logicalSha256: digest(data), counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])) };
  writeFileSync(target + '.json.tmp', JSON.stringify(manifest, null, 2) + '\n'); renameSync(target + '.json.tmp', target + '.json');
  const manifests = readdirSync(directory).filter(f => /^snapshot-.*\.db\.json$/.test(f)).sort().reverse();
  for (const name of manifests.slice(keep)) { const dbPath = join(directory, name.slice(0, -5)); if (existsSync(dbPath)) unlinkSync(dbPath); unlinkSync(join(directory, name)); }
  return { path: target, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let run = 0;
  const execute = () => {
    try { const label = run++ % 5 === 0 ? 'full' : 'incremental-style schedule (complete copy)'; const destination = process.argv.find(a => a.startsWith('--destination='))?.slice(14); console.log(JSON.stringify(backupDatabase(undefined, destination, { label }), null, 2)); }
    catch (e) { console.error(e.message); if (!process.argv.includes('--watch')) process.exitCode = 1; }
  };
  execute();
  if (process.argv.includes('--watch')) {
    const interval = Number(process.env.BACKUP_INTERVAL_MS || 30000);
    if (!Number.isInteger(interval) || interval < 1000) throw new Error('BACKUP_INTERVAL_MS must be at least 1000.');
    console.log(`Backup schedule every ${interval} ms. Every file is a complete snapshot.`); setInterval(execute, interval);
  }
}
