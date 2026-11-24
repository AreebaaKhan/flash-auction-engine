# 5–7 minute recording walkthrough

## Before recording

Install Node 24 LTS. Open VS Code on this repository, then its integrated terminal.
Run `npm install` and `npm start`. Keep a second terminal available for tests.
Open http://127.0.0.1:3000 and http://127.0.0.1:3000/demo.html.
Benchmarks/recovery use isolated databases; your browser auction is unaffected.

## 0:00–0:40 — Problem and architecture

“The assignment asks for correct bidding during a final-seconds traffic spike. This
prototype uses persistent WebSockets, one synchronous decision function, and SQLite
transactions. A bid is saved before the client receives acceptance. The 50,000-user
target is not claimed as tested.” Show the component diagram in architecture.md.

## 0:40–2:10 — Real-time application

Show the lobby, switch light/dark theme, then select Demo Admin and show the create form.
Open Demo studio, set duration to 25 seconds and click Launch demo auction. Explain
“3 items, 4 distinct bidders; one item per winner.” Fire 12 bot bids and point out
the changing highest bid, leaderboard, counts and acceptance/rejection toasts.
Manually bid in the last 10 seconds to show extension. Reconnect Ayesha and show
the status changing back with a current snapshot. Stop bidding and show final winners.
For a shorter ending, use no more than one late bid and wait for its 10-second extension.

## 2:10–3:00 — Correctness and persistence

In the second terminal:

```powershell
npm test
npm run contention
```

Explain the 10,000 **attempts** and 128 actual connections. Show accepted, rejected
and duplicate counts, strictly increasing accepted versions, DB/memory agreement and
unique winners. If time is tight show the already-generated JSON while the run finishes.
Stop the main server with Ctrl+C, start it again with `npm start`, then refresh the
browser to show persisted auctions/winners (or let the open client reconnect).

## 3:00–3:50 — Unsafe comparison and measured scale

```powershell
npm run naive
npm run loadtest
```

Show docs/results/comparison.md and SUMMARY.md. Explain the deliberately stale
read/await/write race; REST is not inherently broken. Distinguish connection count
from bids/sec and read p95, business rejections, timeouts and dropped connections.
Mention that synchronous durable writes cause seconds of burst latency on this laptop.
The stored 2,000-client report is evidence of that run, not proof of 50,000 capacity.

## 3:50–5:30 — Disaster recovery (main evidence)

```powershell
npm run backup
npm run disaster
```

Show the manifest in backups, then the disaster output: matching checksums/counts,
restored orders, measured engine RTO and exactly one lost post-backup bid. Explain:
“The checkpoint restores exactly, but newer data is outside that backup's recovery point.”
The script destroys only its disposable demo database, not the normal browser database.

## 5:30–6:30 — Bacula and limitations

Show docs/DR.md diagram and docs/bacula configs. State explicitly:
“Bacula is a Linux deployment design here; it was not executed. The running recovery
demo uses SQLite snapshots. Same-laptop backups do not survive laptop loss.”
Explain the Director, File Daemon, Storage Daemon, Catalog and bconsole, plus an offsite
copy. End with one process/durable-write bottleneck and the future Redis Lua + multiple
WebSocket nodes design, without claiming that future design has been implemented.
