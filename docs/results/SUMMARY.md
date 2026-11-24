# Executed evidence

Recorded on **25 November 2026, Asia/Karachi** (raw JSON uses UTC timestamps).
Machine: Windows 10.0.26300, Node **24.22.1**, Intel Core i7-1255U, 12 logical CPUs,
15.7 GiB RAM. Results describe this machine and these workloads only.

## Correctness and recovery

| Run | Actual result |
|---|---|
| `npm test` | **16 passed, 0 failed**; final duration 3272.7945 ms |
| `npm run contention` | **PASS**; 10,000 attempts, 128 sockets, peak 128 in flight |
| Contention outcomes | 9,080 accepted, 24 BID_TOO_LOW, 896 duplicate retries |
| Contention assertions | Serial accepted versions, reference top-N, DB/memory equality, 10 unique orders, no overselling, repeat-safe finalization |
| `npm run disaster` | **PASS**; restored 2 auctions, 12 bids, 4 positions and 3 orders; logical hashes match |
| Recovery boundary | Exactly 1 post-backup bid absent after restore |
| Measured engine RTO | **18.04 ms**; file deletion to reopened engine + logical verification |
| Checkpoint age at simulated failure | **128 ms**, deliberately short demo interval |

The final test suite includes JWT tamper/expiry handling, actual startup and static
asset delivery, HTTP/WS integration, cross-client push, reconnect/resync, idempotency,
stock/tie/price validation, rate limits, automatic finalization, rollback on a database
error, restart recovery and VACUUM INTO backup/retention. A fake browser WebSocket
unit test also checks retry-key preservation and independent ACK handling.
See [contention.json](contention.json), [disaster.json](disaster.json) and [tests.json](tests.json).

RTO here does not include host replacement, backup creation, npm installation or a
browser reconnect. Exact checkpoint recovery is not a zero-RPO guarantee.

## Unsafe REST comparison

The comparison is a separate 10,000-attempt run with 128 concurrency. Its observed
accepted count differs from the standalone contention run because of scheduling.

| Measurement | Unsafe baseline | Correct engine |
|---|---:|---:|
| Unique accepted responses | 9,104 | 9,104 |
| Duplicate responses | 896 | 896 |
| Persisted accepted count | 165 | 9,104 |
| Lost accepted updates | **8,939** | **0** |
| Correct top-N | **false** | **true** |

See [comparison.md](comparison.md) and [comparison.json](comparison.json). The unsafe
baseline intentionally uses an async delay with a stale SQL row; REST is not inherently
incorrect. Different storage and an injected delay make this a correctness demonstration,
not a fair throughput benchmark between protocols.

## Load measurements after broadcast serialization improvement

| Measurement | 500 clients | 2,000 clients |
|---|---:|---:|
| Achieved/peak connections | 500 | 2,000 |
| Connection failures / dropped connections | 0 / 0 | 0 / 0 |
| Bid attempts | 4,000 | 14,000 |
| Accepted responses | 1,712 | 1,983 |
| Business rejections | 2,288 | 4,087 |
| BID_TOO_LOW / ENDED | 1,917 / 371 | 3,551 / 536 |
| Unanswered at drain timeout | **0** | **7,930** |
| p50 bid-response latency | 2,574.44 ms | 10,210.39 ms |
| p95 bid-response latency | 4,770.78 ms | 11,805.40 ms |
| p99 bid-response latency | 4,875.67 ms | 11,937.41 ms |
| Accepted bids/sec over offered burst | 163 | 199 |
| Peak combined process RSS | 98 MiB | 197 MiB |
| Outcome | All requests received responses | **Overload; not healthy capacity** |

Sources: [loadtest-500.json](loadtest-500.json), [loadtest-2000.json](loadtest-2000.json).
Original pre-optimization runs are retained as `loadtest-*-initial.json`; they are
not hidden or represented as passes. The initial 2,000-client run timed out all requests.

Conditions: real localhost WebSockets; server and generator in the **same Node
process**; durable disk-backed SQLite WAL/FULL; rate limits raised; anti-sniping disabled;
subscriptions receive live state; 10-second response-drain window after the offered
burst. Each request is not a separate connection. Offered rounds are affected by the
shared event loop, so these are not independently controlled open-loop production tests.

Latency percentiles include responses actually received, including business rejections;
timed-out requests are excluded from percentiles but explicitly counted. At 2,000 clients,
the server processed 8,170 attempts before the measurement ended, persisted 1,983 bids,
and had 6,187 rejections; some rejection responses were still queued when the client
drain deadline expired. The reported client and server counts therefore differ.
No claim is made that a timeout necessarily means a bid was never committed.

The 500-client run also has seconds of latency and deadline rejections: it demonstrates
correctness and the persistence bottleneck, not a production low-latency service.
Neither run proves 50,000-bidder support or linear scaling by adding nodes.

## Verification limits

- **TESTED:** Node startup, all delivered HTTP assets, engine, real WebSocket flows,
  reconnect protocol, persistence/recovery, measured contention/comparison/load commands.
- **NOT VERIFIED visually:** browser automation could not initialize (unknown/expired
  runtime continuation, two attempts). No screenshot or manual browser pass is claimed.
- **NOT RUN:** Bacula daemons/jobs/restoration, independent load-generator host,
  external networks, TLS, offsite recovery, multi-node deployment, 50,000 connections,
  long-duration soak tests and long-running backup-watch scheduling.
