import { startServer } from './src/server.js';

try {
  const app = await startServer();
  if (app.engine.auctions.size === 0) {
    const now = Date.now();
    for (const [item, stock, startingPrice, endsAt, startsAt] of [
      ['Studio Headphones', 3, 100000, now + 180000, now],
      ['Everyday Smartwatch', 2, 250000, now + 300000, now],
      ['Pocket Digital Camera', 1, 500000, now + 420000, now + 60000]
    ]) app.engine.create({ item, stock, startingPrice, minIncrement: 5000, startsAt, endsAt }, { role: 'admin' });
  }
  console.log(`\n  FLASHROOM · live auctions\n  Open ${app.url}\n  Four-bidder demo: ${app.url}/demo.html\n  Local mock authentication · SQLite WAL · Ctrl+C to stop\n`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) { console.error(`Startup failed: ${error.message}\nUse Node 24 LTS. If port 3000 is busy, set PORT=3001 in .env.`); process.exitCode = 1; }
