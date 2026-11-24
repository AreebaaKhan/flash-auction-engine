import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../src/server.js';
import { signToken } from '../src/auth.js';
import { temporary } from '../test/helpers.js';
import { argument, machine, save } from './benchmark.js';

const offered=argument('clients',500), rampMs=argument('ramp-ms',2000), duration=argument('duration',15);
if(offered>5000||duration<12||duration>120)throw new Error('Use at most 5000 clients and duration 12–120 seconds.');
const temp=temporary();const sockets=[];let app;let sampler;
try{
  app=await startServer({dbPath:temp.dbPath,port:0,antiMax:0,maxConnections:Math.max(3000,offered),maxConnectionsPerIp:Math.max(3000,offered),ipCapacity:1000000,ipRefill:1000000,userCapacity:1000,userRefill:1000});
  const a=app.engine.create({item:'Measured final-seconds burst',stock:10,startingPrice:100,minIncrement:10,endsAt:Date.now()+rampMs+duration*1000},{role:'admin'}).state;
  const pending=new Map();const latencies=[];const rejectedByReason={};let achieved=0,peakConnected=0,active=0,attempted=0,accepted=0,rejected=0,duplicates=0,timeouts=0,dropped=0,connectionFailures=0,protocolErrors=0,sequence=0,peakRss=0,peakInFlight=0;let finishing=false;
  const cpuStart=process.cpuUsage(),wallStart=performance.now();
  sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
  const connect=i=>new Promise(resolve=>{
    const ws=new WebSocket(app.url.replace('http:','ws:')+'/ws');sockets.push(ws);let ready=false,settled=false;
    const timeout=setTimeout(()=>{connectionFailures++;settled=true;ws.terminate();resolve();},10000);
    ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token:signToken({id:`load-${i}`,name:`Bot ${i}`,role:'bidder'},app.cfg.secret)})));
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome'){ready=true;achieved++;active++;peakConnected=Math.max(peakConnected,active);clearTimeout(timeout);settled=true;ws.send(JSON.stringify({type:'subscribe',auctionId:a.id}));resolve();}else if(m.type==='bid_result'){const entry=pending.get(m.requestId);if(entry){latencies.push(performance.now()-entry);pending.delete(m.requestId);}if(m.duplicate)duplicates++;else if(m.ok)accepted++;else{rejected++;rejectedByReason[m.reason]=(rejectedByReason[m.reason]||0)+1;}}else if(m.type==='error'){protocolErrors++;}});
    ws.on('error',()=>{if(!settled){clearTimeout(timeout);settled=true;connectionFailures++;resolve();}});
    ws.on('close',()=>{if(ready){active--;if(!finishing)dropped++;}if(!settled){clearTimeout(timeout);settled=true;connectionFailures++;resolve();}});
  });
  const batchSize=25; const connecting=[];
  for(let start=0;start<offered;start+=batchSize){for(let i=start;i<Math.min(offered,start+batchSize);i++)connecting.push(connect(i));await delay(rampMs/(offered/batchSize));}
  await Promise.all(connecting);
  await delay(Math.max(0,a.endsAt-10000-Date.now()));
  const burstStart=performance.now();let rounds=0;
  while(Date.now()<a.endsAt-200){
    for(const ws of sockets)if(ws.readyState===WebSocket.OPEN){const requestId=randomUUID();pending.set(requestId,performance.now());ws.send(JSON.stringify({type:'bid',auctionId:a.id,amount:100+(sequence++)*10,idempotencyKey:requestId,requestId}));attempted++;peakInFlight=Math.max(peakInFlight,pending.size);}
    rounds++;await delay(1000);
  }
  const burstMs=performance.now()-burstStart;const deadline=Date.now()+10000;
  while(pending.size&&Date.now()<deadline)await delay(50);timeouts=pending.size;pending.clear();
  finishing=true;const cpu=process.cpuUsage(cpuStart);const sorted=latencies.sort((a,b)=>a-b);const percentile=p=>sorted.length?Math.round(sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]*100)/100:null;
  const result={executedAt:new Date().toISOString(),machine:machine(),status:timeouts||protocolErrors||connectionFailures?'COMPLETED_WITH_ERRORS':'COMPLETED',offeredConnections:offered,achievedConnections:achieved,peakConnected,connectionFailures,droppedConnections:dropped,configuredRampMs:rampMs,auctionDurationSeconds:duration,rounds,attempted,accepted,rejected,rejectedByReason,duplicates,timeouts,protocolErrors,peakInFlight,latencyMs:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),samples:sorted.length},offeredAttemptsPerSecond:Math.round(attempted/(burstMs/1000)),acceptedBidsPerSecond:Math.round(accepted/(burstMs/1000)),peakCombinedRssMiB:Math.round(peakRss/1024/1024),cpuMs:{user:Math.round(cpu.user/1000),system:Math.round(cpu.system/1000)},totalDurationMs:Math.round(performance.now()-wallStart),conditions:'Server and generator share one Node process and machine; real localhost WebSockets, disk-backed SQLite FULL, raised rate limits, anti-sniping disabled to keep the final-10-second measurement fixed. Latency excludes requests that timed out; timeouts are reported separately. No 50k claim.'};
  result.serverCounters = { ...app.counters };
  result.serverPersistedBids = app.engine.db.prepare('SELECT count(*) AS n FROM bids').get().n;
  result.responseDrainTimeoutMs = 10000;
  save(`loadtest-${offered}.json`,result);console.log(JSON.stringify(result,null,2));
}finally{clearInterval(sampler);for(const ws of sockets)ws.terminate();if(app)await app.close();temp.cleanup();}
