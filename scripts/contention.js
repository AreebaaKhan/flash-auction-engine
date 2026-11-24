import { argument, runContention } from './benchmark.js';
console.log(JSON.stringify(await runContention({ attempts: argument('attempts', 10000), concurrency: argument('concurrency', 128) }), null, 2));
