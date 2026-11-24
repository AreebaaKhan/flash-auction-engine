# Measured correctness comparison

Executed 2026-11-24T20:18:37.657Z. 10000 attempts, 128 maximum in flight.

| Measurement | Unsafe REST + stale SQL update | Synchronous WebSocket engine |
|---|---:|---:|
| Accepted responses (unique) | 9104 | 9104 |
| Duplicate responses | 896 | 896 |
| Rejected requests | 0 | 0 |
| Persisted accepted count | 165 | 9104 |
| Lost accepted updates | 8939 | 0 |
| Correct top-N | false | true |

Same generated intents and concurrency, different observed interleavings. The baseline deliberately crosses an await with stale state; REST itself is not the defect. This is a correctness comparison, not a fair latency benchmark: naive has an injected delay and an in-memory SQLite row; correct has disk-backed transactional persistence.

A correctly implemented REST API can use atomic transactions and be correct. No claim about 50,000 connections is made. See comparison.json for machine details, winner lists and raw counts.
