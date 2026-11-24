# Flashroom — flash-auction engine

A local, real-time multi-item auction demo for Internet Computing CEP 1. Node.js,
plain JavaScript, WebSockets and durable SQLite transactions. No Docker, Redis,
PostgreSQL, Bash, frontend framework or external CDN.

## Run from VS Code or PowerShell

Use **Node 24 LTS** (minimum **22.13.0**) and npm. VS Code: **Terminal → New Terminal**.

```powershell
cd "E:\7th Semester\IC\IC_CEP\flash-auction-engine"
npm install
npm start
```

Leave that terminal running. Open **http://127.0.0.1:3000** in a browser. This is a
website, not a VS Code Live Server project. The Node server handles both the UI and
WebSockets. On the first run, three sample auctions are created in the real database.
There is no build step. No `.env` file is required.

For **CMD**, use `cd /d "E:\7th Semester\IC\IC_CEP\flash-auction-engine"`, then the
same `npm install` and `npm start` commands. If PowerShell blocks `npm.ps1`, use
`npm.cmd install` and `npm.cmd start`; no execution-policy change is needed.

### Record the live demo

1. Open **http://127.0.0.1:3000/demo.html**.
2. Click **Launch demo auction**. All four bidder panels join the same auction.
3. Click **Fire 12 bot bids**, or enter bids manually in each panel.
4. Click **Reconnect Ayesha** to show reconnection and snapshot recovery.
5. Place a bid in the last 10 seconds to extend the auction. After up to five
   extensions, stop bidding and watch the final winners appear.
6. Back in the main room, select **Demo Admin** to access the create-auction form.

The identity selector is deliberately **mock authentication**: anybody using this
local demo can select admin. No passwords, payments or real customer accounts exist.
Money is displayed in PKR and stored as integer paise. Each winning user gets one item.

Press **Ctrl+C** to stop. Bids survive restart in `data/auction.db` (SQLite WAL).
Do not run a second server against the same database. A process lock prevents it.

## Run checks in a second terminal

```powershell
npm test
npm run contention
npm run naive
npm run loadtest
npm run loadtest -- --clients=2000
npm run disaster
```

The tests and benchmarks use disposable databases and ephemeral ports, independently
of the app on port 3000. `npm run disaster` deletes **only its own temporary demo
database**, restores a verified backup and compares logical data. It does not delete
your normal auctions. Actual measured reports are in `docs/results/`.

| Command | Purpose |
|---|---|
| `npm test` | Node unit/integration tests, including actual HTTP/WebSockets |
| `npm run contention` | 10,000 attempts, 128 connections, max 128 in flight; serial-reference assertions |
| `npm run naive` | Same workload against intentionally unsafe REST and correct engine |
| `npm run loadtest` | Default 500 clients; final-10-second burst; measured latency and failures |
| `npm run loadtest -- --clients=2000` | Larger load, subject to machine limits |
| `npm run backup` | Back up the normal app database to `backups/` |
| `npm run backup:watch` | Snapshot every 30 seconds; Ctrl+C to stop scheduling |
| `npm run disaster` | Isolated deletion, restore, checksum verification, measured RPO boundary/RTO |

For a quick contention check: `npm run contention -- --attempts=1000 --concurrency=32`.
This overwrites the contention result file with the parameters actually run.

## Configuration

Optional: `Copy-Item .env.example .env` and edit `.env`. The main app and backup
scripts load it. Benchmarks deliberately use their own isolated test settings.
Set `PORT=3001` if 3000 is in use. Change both browser links accordingly.
Use a random `JWT_SECRET` of at least 32 characters if tokens should survive server
restart; otherwise the server generates an ephemeral signing key and the client
signs in again automatically. Do not commit `.env` or database/backup files.

## Scope and evidence

This is a **single-process teaching prototype**, not a demonstrated 50,000-bidder
production deployment. Persistent connections and race-free updates are implemented;
synchronous disk persistence limits throughput and blocks the event loop under load.
Benchmarks run server and generator in the same process over real localhost sockets;
they are not independent multi-machine capacity tests. Read [measured evidence](docs/results/SUMMARY.md).

**Bacula is design-only here.** Linux deployment configs under `docs/bacula/` have
not been executed. The executed recovery demo uses SQLite snapshots. If the examiner
requires an actual running Bacula job, this prototype does not demonstrate that.

Read [rules/API/state](docs/STATE.md), [architecture](docs/architecture.md),
[disaster recovery](docs/DR.md) and the [5–7 minute walkthrough](docs/DEMO_WALKTHROUGH.md).

## Troubleshooting

- **Unknown `node:sqlite` or experimental flag error:** upgrade to Node 24 LTS.
  Node 22.13 introduced unflagged SQLite support; early Node 22 releases do not meet
  this project's minimum. [Node SQLite documentation](https://nodejs.org/download/release/v22.23.0/docs/api/sqlite.html)
- **`EADDRINUSE`:** stop the earlier server with Ctrl+C or choose a different PORT.
- **Database already owned:** stop the other process. A stale lock is automatically
  removed if its recorded process no longer exists. Do not remove a live process's lock.
- **`BID_TOO_LOW`:** use the latest minimum shown; another user may have bid first.
- **`RATE_LIMITED` / `IP_RATE_LIMITED`:** wait for the bucket to refill, then submit a
  fresh intent. A retried engine idempotency key retains its original result.
- **All drops ended:** select Demo Admin and create another, or launch one in Demo studio.
- **Connection says reconnecting:** keep the Node terminal running; inspect its error.
- **SQLite write/storage failure:** the server stops accepting bids, exposes unhealthy
  status and logs the failure. Resolve storage availability, then restart and resync.
- **Slow load-test results:** expected on one process with durable synchronous writes.
  Business rejections and timeouts are reported separately, not hidden as successes.
