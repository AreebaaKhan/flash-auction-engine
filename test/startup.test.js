import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { temporary } from './helpers.js';

test('actual startup seeds three auctions and serves every offline UI asset', async () => {
  const temp = temporary();
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DB_PATH: temp.dbPath, JWT_SECRET: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let errors = ''; child.stderr.on('data', data => errors += data);
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out: ' + errors)), 10000);
      child.stdout.on('data', data => { const match = String(data).match(/Open (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('error', reject);
    });
    const auctions = await fetch(url + '/api/auctions').then(r => r.json()); assert.equal(auctions.length, 3);
    for (const path of ['/', '/demo.html', '/app.js', '/connection.js', '/demo.js', '/styles.css', '/favicon.svg', '/health']) assert.equal((await fetch(url + path)).status, 200, path);
  } finally { child.kill('SIGTERM'); await exited; temp.cleanup(); }
});
