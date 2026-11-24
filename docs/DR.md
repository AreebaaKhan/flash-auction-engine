# Disaster recovery

## What is executed

`npm run backup` uses SQLite `VACUUM INTO` to create a consistent database snapshot,
including committed WAL data, while the app can be running. It verifies SQLite integrity,
writes a SHA-256 file hash and a deterministic logical-data hash, then applies retention.
`VACUUM INTO` is a consistent snapshot operation, not a raw live database-file copy.
[SQLite VACUUM documentation](https://sqlite.org/lang_vacuum.html)

The default destination is `./backups/`; `--destination=<absolute-path>` overrides it.
Default retention is 10 snapshots, configurable via BACKUP_KEEP. A `.db.json` manifest
describes each backup and counts auctions, bids, positions, outcomes and orders.

`npm run backup:watch` snapshots every 30 seconds. Its first run and every fifth
subsequent interval are labeled full; other runs are labeled **incremental-style
schedule (complete copy)**. These are all independent complete SQLite files. There is
no real delta/incremental backup implementation in the Node script.

| Schedule | Implemented? | Meaning |
|---|---|---|
| Manual `npm run backup` | TESTED | Complete consistent SQLite snapshot |
| 30-second `backup:watch` interval | Implemented; long-running schedule not soak-tested | Complete copies; rotating labels do not change format |
| Bacula Full weekly / Differential daily / Incremental hourly | NOT RUN | Linux deployment design |

## Destructive demonstration, isolated from your app

Run `npm run disaster`. It creates a fresh OS temporary directory and:

1. Seeds two auctions and 12 bids, closes one auction and records three winner orders.
2. Takes and verifies a SQLite backup; records the logical checksum and counts.
3. Accepts one additional bid **after** the backup checkpoint.
4. Closes the engine and deletes only the demo database and its own WAL/SHM files.
5. Verifies the backup file hash and copies that backup into a fresh live database path.
6. Reopens the engine and asserts exact equality to the backed-up logical data.
7. Confirms the post-backup bid is absent and prints the measured timing and counts.

Temporary resources are cleaned up. The normal `data/auction.db` is untouched.
Evidence is saved to `docs/results/disaster.json`. This is an engine/data recovery test,
not a full laptop rebuild or measured browser reconnection exercise.

**RPO** describes the recovery point/data-loss window. The demo reports checkpoint age
at simulated failure and proves one post-backup bid is lost. Do not say “zero RPO”
because the restored checkpoint matches. With a healthy 30-second schedule, a nominal
RPO target is around 30 seconds plus job time; missed jobs increase it.

**RTO** is measured from database deletion beginning through reopening the engine and
successful data verification. Backup preparation is outside this interval. A broader
operational target (e.g. restoring service within five minutes) is a proposed target,
not proven by this short local file-restoration timing.

## Manual restoration of the normal database

Stop the application with Ctrl+C. Preserve the damaged database, WAL and SHM together
in a separate directory before replacing anything. Select a known backup, verify its
SHA-256 against the matching manifest, and restore it as `data/auction.db` into a clean
directory without stale WAL/SHM files. Start the app and check auctions and winners.
Do not replace an open database, and do not copy only a live `.db` while ignoring its WAL.
Keep the original files until restoration has been verified.

## Bacula deployment design — NOT executed in this prototype

The examiner's requested Bacula deployment is represented by configs in `docs/bacula/`.
They are **designed for deployment on a Linux server; NOT executed in this prototype**.
No Bacula job IDs or successful Bacula restore claims are fabricated.

```mermaid
flowchart LR
  Console[bconsole: operator console] --> Director[Director: schedules and jobs]
  Director <--> Catalog[(PostgreSQL Bacula catalog)]
  Director --> FD[File Daemon on application host]
  Director --> SD[Storage Daemon on backup host]
  App[Node + SQLite] -->|ClientRunBeforeJob: backup.js| Snapshots[/srv/flashroom/backups]
  Snapshots --> FD
  FD -->|backup data| SD
  SD --> Media[Separate backup storage]
  Media --> Offsite[Encrypted offsite copy]
  SD -->|restore files| FD
```

Director schedules/supervises jobs; FD reads the application host's prepared snapshots;
SD writes backup media; Catalog indexes jobs/files/media; bconsole requests backups
and restores. [Bacula Director reference](https://www.bacula.org/15.0.x-manuals/en/main/Configuring_Director.html)

The example assumes `/srv/flashroom`, Node at `/usr/bin/node`, and an off-host SD/Director.
Install compatible Bacula packages and initialize the PostgreSQL catalog schema;
create directories and service-user permissions; replace all CHANGE_ME secrets;
configure network rules and TLS; validate each daemon configuration with the installed
version before use. `ClientRunBeforeJob` invokes backup.js on the application host
using an absolute source and destination. It must fail the backup job if preparation
fails. The weekly full is Sunday 01:00, differential Monday–Saturday 01:00, and
incremental every hour at minute 05. Retention is 60 days, with bounded media capacity.
New snapshot filenames mean Bacula incrementals still transfer whole new SQLite files.

Provision a separate catalog-backup job, securely retain Director/SD/FD configs and
restore bootstrap information, and test restoring the catalog before depending on it.
The supplied examples do not implement this bootstrap/catalog disaster test.

## 3-2-1 and offsite copies

Keep three copies of data, on two independent media/storage systems, with one offsite.
For example: application SSD, a separate backup server managed by Bacula, and an
encrypted offsite copy in another location/object store. Protect keys separately,
monitor failed jobs, verify hashes, and rehearse a restore from the offsite copy.
Backups under `./backups` on the same laptop **do not survive laptop loss**, theft,
disk destruction or malware that can erase both copies. This prototype does not
claim to implement 3-2-1 protection or offsite storage.
