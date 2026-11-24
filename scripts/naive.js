import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { argument, workload, runContention, save, machine } from './benchmark.js';

const attempts = argument('attempts', 10000), concurrency = argument('concurrency', 128);
if (concurrency < 2 || concurrency > 2000 || attempts > 100000) throw new Error('Use 2–2000 concurrency and at most 100000 attempts.');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE unsafe (id INTEGER PRIMARY KEY, state TEXT NOT NULL)');
db.prepare('INSERT INTO unsafe VALUES (1,?)').run(JSON.stringify({ bidCount: 0, version: 1, positions: {} }));
const acceptedEvents = []; const seen = new Map();
const server = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) { raw += chunk; if(raw.length > 4096) throw new Error('too large'); }
    const task = JSON.parse(raw); const key = `${task.userId}:${task.key}`;
    if (seen.has(key)) { res.end(JSON.stringify({ ...seen.get(key), duplicate: true })); return; }
    // Deliberately unsafe: the snapshot crosses an asynchronous boundary before UPDATE.
    const stale = JSON.parse(db.prepare('SELECT state FROM unsafe WHERE id=1').get().state);
    const top = Object.values(stale.positions).sort((a,b)=>b.amount-a.amount||a.version-b.version).slice(0,10);
    const previous = stale.positions[task.userId]?.amount || 0;
    const minimum = Math.max(100, previous ? previous + 10 : 0, top.length === 10 ? top.at(-1).amount + 10 : 0);
    await delay(3 + task.index % 7);
    if (task.amount < minimum) { const result = { ok:false, reason:'BID_TOO_LOW' }; seen.set(key,result); res.end(JSON.stringify(result)); return; }
    stale.bidCount++; stale.version++; stale.positions[task.userId] = { userId: task.userId, amount: task.amount, version: stale.version };
    db.prepare('UPDATE unsafe SET state=? WHERE id=1').run(JSON.stringify(stale));
    acceptedEvents.push(task); const result = { ok:true }; seen.set(key,result); res.end(JSON.stringify(result));
  } catch (e) { res.statusCode=400; res.end(JSON.stringify({ok:false,reason:e.message})); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let naive;
try {
  const tasks = workload(attempts,concurrency); const results=Array(attempts); const begin=performance.now();
  await Promise.all(Array.from({length:concurrency},async(_,slot)=>{for(let i=slot;i<attempts;i+=concurrency){const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',body:JSON.stringify(tasks[i])});assert.equal(response.status,200);results[i]=await response.json();}}));
  const final=JSON.parse(db.prepare('SELECT state FROM unsafe').get().state);
  const accepted=results.filter(r=>r.ok&&!r.duplicate).length; const duplicates=results.filter(r=>r.duplicate).length;
  const expected=new Map(); for(const t of acceptedEvents) if(t.amount>(expected.get(t.userId)||0))expected.set(t.userId,t.amount);
  const expectedTop=[...expected].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const actualTop=Object.values(final.positions).sort((a,b)=>b.amount-a.amount).slice(0,10).map(p=>[p.userId,p.amount]);
  naive={attempts,concurrency,accepted,duplicates,rejected:attempts-accepted-duplicates,persistedBidCount:final.bidCount,lostUpdates:accepted-final.bidCount,correctTopN:JSON.stringify(actualTop)===JSON.stringify(expectedTop),expectedTopN:expectedTop,actualTopN:actualTop,elapsedMs:Math.round(performance.now()-begin)};
  assert.ok(naive.lostUpdates>0,'Race not reproduced; do not claim a failure that was not observed.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
const correct=await runContention({attempts,concurrency,persist:false});
const result={executedAt:new Date().toISOString(),machine:machine(),naive,correct,interpretation:'Same generated intents and concurrency, different observed interleavings. The baseline deliberately crosses an await with stale state; REST itself is not the defect. This is a correctness comparison, not a fair latency benchmark: naive has an injected delay and an in-memory SQLite row; correct has disk-backed transactional persistence.'};
save('comparison.json',result);mkdirSync('docs/results',{recursive:true});
writeFileSync('docs/results/comparison.md',`# Measured correctness comparison\n\nExecuted ${result.executedAt}. ${attempts} attempts, ${concurrency} maximum in flight.\n\n| Measurement | Unsafe REST + stale SQL update | Synchronous WebSocket engine |\n|---|---:|---:|\n| Accepted responses (unique) | ${naive.accepted} | ${correct.accepted} |\n| Duplicate responses | ${naive.duplicates} | ${correct.duplicates} |\n| Rejected requests | ${naive.rejected} | ${correct.rejected} |\n| Persisted accepted count | ${naive.persistedBidCount} | ${correct.verification.acceptedEvents} |\n| Lost accepted updates | ${naive.lostUpdates} | 0 |\n| Correct top-N | ${naive.correctTopN} | true |\n\n${result.interpretation}\n\nA correctly implemented REST API can use atomic transactions and be correct. No claim about 50,000 connections is made. See comparison.json for machine details, winner lists and raw counts.\n`);
console.log(JSON.stringify({naive,correct:{attempts:correct.attempts,accepted:correct.accepted,duplicates:correct.duplicates,rejected:correct.rejected,verification:correct.verification}},null,2));
