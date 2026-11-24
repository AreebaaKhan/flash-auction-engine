# Project state

## Rules (established before implementation)

- A multi-unit ascending auction sells at most stock N items, one per distinct user.
- Keep each user's highest accepted bid. Highest N users win, paying their own bid.
- Amounts are integer minor units (paise); UI displays PKR. Range: 1 to 1,000,000,000.
- startingPrice and minIncrement are positive integer minor units. Stock is 1–100.
- Every bid is at least startingPrice. A returning user must raise their own previous
  accepted bid by minIncrement. When there are at least N positions, every bid must
  also reach the current Nth-highest amount + minIncrement. This includes incumbents.
- Before N distinct bidders exist, equal bids by different users are permitted.
  Ties rank by the earlier accepted position version, then user ID.
- Only the server clock controls deadlines. A bid at or after endsAt is rejected.
- A valid bid in the last 10 seconds adds 10 seconds to endsAt, at most five times.
  These values are configurable. Each accepted bid increments the auction version;
  creation starts at version 1 and finalization increments it once.
- Bid idempotency is scoped by auction/user/key and survives restart. The same key
  and amount returns its original outcome; a different amount produces a conflict.
- Finalization produces immutable orders once, including when a server restarts
  after an auction deadline. There are no payments or external fulfillment.
- Demo login intentionally allows selecting a mock identity, including admin.
  This is a local teaching prototype, not production authentication.

## Delivered topology and files

One Node process, built-in HTTP server, persistent WebSockets, SQLite WAL/FULL,
plain HTML/CSS/JS. No Docker/Redis/PostgreSQL services or host Bash dependency.

| Path | Role |
|---|---|
| `server.js` | Startup, first-run sample auctions, graceful Ctrl+C |
| `src/server.js` | HTTP routes, auth handshake, pushes, limits, heartbeat, metrics |
| `src/engine.js` | Synchronous bid/finalization transactions, rate limit, snapshots |
| `src/database.js` | Schema, WAL settings, process lock, logical backup dataset |
| `src/auth.js`, `src/config.js` | HMAC JWT/mock identities, environment settings |
| `public/` | Lobby, admin form, live auction, winners, 4-panel demo |
| `test/` | node:test coverage, isolated temporary fixtures |
| `scripts/backup.js`, `scripts/disaster-demo.js` | Executed SQLite recovery tools |
| `scripts/contention.js`, `scripts/naive.js`, `scripts/loadtest.js` | Actual measured evidence |
| `docs/results/` | Machine details, raw JSON results, comparison and summary |
| `docs/bacula/` | Linux Bacula config designs, NOT executed |
| `data/`, `backups/` | Runtime-only data; Git ignored |

## Run and configuration

From the repository: `npm install`, then `npm start`. Open
http://127.0.0.1:3000 or http://127.0.0.1:3000/demo.html. Node 24 LTS is recommended;
minimum 22.13.0 (unflagged node:sqlite). There are no frontend build steps.

| Variable | Default | Purpose |
|---|---|---|
| HOST / PORT | 127.0.0.1 / 3000 | Local HTTP and WS listener |
| DB_PATH | ./data/auction.db | SQLite source database |
| JWT_SECRET | Random on each startup | At least 32 chars when configured |
| MAX_CONNECTIONS | 3000 | Overall WS cap |
| MAX_CONNECTIONS_PER_IP | 2500 | Per-IP socket cap |
| USER_RATE_CAPACITY / USER_RATE_REFILL | 15 / 5 | Burst tokens / tokens per second |
| IP_RATE_CAPACITY / IP_RATE_REFILL | 1000 / 500 | Shared per-IP HTTP+WS request tokens |
| ANTI_SNIPE_WINDOW_MS / ANTI_SNIPE_EXTENSION_MS / ANTI_SNIPE_MAX | 10000 / 10000 / 5 | Extension rules copied into each new auction |
| BACKUP_KEEP / BACKUP_INTERVAL_MS | 10 / 30000 | Backup retention and watch interval |

Tests/benchmarks launch isolated servers and databases. Contention/load benchmarks
raise rate limits and disable anti-sniping explicitly to isolate the measured workload;
regular application defaults do not change. They do not load your .env settings.

## HTTP contracts

JSON request/response bodies. Protected routes use `Authorization: Bearer <token>`.

| Method and path | Contract |
|---|---|
| GET /api/users | Available mock users (`admin`, `ayesha`, `hamza`, `sara`, `bilal`) |
| POST /api/login | `{ "userId": "ayesha" }` returns `{token,user}` |
| GET /api/auctions | Authoritative snapshot array (UI uses WS pushes instead) |
| GET /api/auctions/:id | Current authoritative snapshot |
| POST /api/auctions | Admin only; `{item,stock,startingPrice,minIncrement,startsAt?,endsAt?}` |
| GET /health | 200 when ready, 503 after storage failure or during shutdown |
| GET /metrics | Text counters/gauges including attempts, accepted, rejected, duplicates, connections, RSS |

Create defaults: startsAt=server now; endsAt=startsAt+180 seconds. Maximum ending
horizon seven days; maximum item length 100. Timestamps are Unix milliseconds.

## WebSocket contracts

Connect `/ws`. No credentials in URL. Within five seconds send:

```json
{"type":"auth","token":"<JWT>"}
```

Server sends `welcome` with user, epoch, serverTime and instance `node-1`, then
`catalog` with compact auction summaries. Subscribe to one auction per socket:

```json
{"type":"subscribe","auctionId":"<id>","requestId":"request-1"}
{"type":"bid","auctionId":"<id>","amount":105000,"idempotencyKey":"intent-1","requestId":"request-2"}
```

- `snapshot`: `{type,requestId,state}` on subscription/reconnection.
- `state`: `{type,state}` coalesced after changes (75 ms interval).
- `catalog`: `{type,auctions,epoch}` initially and after changed auctions.
- `clock`: `{type,serverTime,epoch}` pushed once per second; no client HTTP polling.
- `bid_result`: `{type,requestId,auctionId,ok,reason,...}`. Success includes bidId,
  amount, version, serverTime, endsAt, extended, duplicate. Semantic rejection includes
  minimum/version/time when applicable. Retry responses retain their original values.
- `error`: `{type,reason,requestId?}` for transport/message/IP errors.

State fields: `id,item,stock,startingPrice,minIncrement,startsAt,endsAt,originalEndsAt,
version,status,topN,bidCount,highest,extensions,history,winners,antiWindowMs,
antiExtensionMs,antiMax,epoch,serverTime` and `finalizedAt` when ended.
Stored status is open/ended; UI derives Upcoming, Live, Ending soon, Finalizing.
topN members have `{userId,name,amount,version}`; winner entries add rank.

Versions advance only on accepted bids and finalization. State with lower/equal
version is ignored within one epoch, except an equal authoritative snapshot may
populate a newly selected/empty view. A fresh boot epoch resets version tracking.
Bid results are processed independently. Reconnect retries keep original idempotency
keys. Identity changes discard the prior identity's pending intents.

## Transaction and idempotency boundaries

All accepted records (bid, position, auction JSON/version, saved outcome) commit in
one synchronous SQLite transaction. Memory is published afterward. No async boundary
exists inside bid/finalization. Startup reloads SQLite and resumes overdue closure.
A PID file protects the single-owner assumption. Do not run clustered workers.

Well-formed semantic outcomes for existing auctions are saved in SQLite, including
RATE_LIMITED, BID_TOO_LOW, NOT_STARTED and ENDED. Same key + different amount gives
IDEMPOTENCY_CONFLICT. Malformed input, missing auctions, invalid authentication and
transport-level IP errors are not stored as bid outcomes. User bucket checking happens
after lookup, so duplicate retries do not spend another engine token (IP limits still apply).
Rate-limit buckets reset on process restart; idempotency data does not.

## Actual verification

The measured runs and verification limits are recorded in [results/SUMMARY.md](results/SUMMARY.md).
`npm test`, `npm run contention`, `npm run naive`, `npm run disaster`, and 500/2000-client
load runs have been executed on Windows with Node 24.22.1. A 2000-client run overloads
this implementation; report its timeouts, do not label it a healthy capacity result.
Browser automation failed at tool initialization; visual rendering/interaction has
not been manually verified. HTTP assets, real WS flows and browser connection logic
are tested. Bacula daemons/jobs, TLS, external networks and 50,000 connections are NOT RUN.

## Known limitations and handoff

This final single-phase scope supersedes the earlier Docker/Redis/two-phase plans.
SQLite synchronous FULL favors durability/correctness over throughput and can block
the event loop for seconds under load. One process, one local disk and one hot auction
limit capacity. No data is sent to an external service except the requested Git push.
The load generator shares a process with the server, and cannot prove distributed capacity.
Backups remain on the same machine; they are not 3-2-1 protection. Watch labels do not
implement delta backups. The Bacula Linux configs are deployment examples only.
Mock admin selection, no payment processing, no production authentication/TLS/failover,
wall-clock deadlines, no long-term data retention and a 1000-auction cap are intentional.
If future work reintroduces multiple Node processes, replace the in-process atomicity
assumption with a shared atomic decision mechanism and explicit recovery guarantees.
