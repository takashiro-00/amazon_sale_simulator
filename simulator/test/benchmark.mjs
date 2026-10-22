// Run after npm run build. Timings exclude compilation and JSON serialization.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runScenario } from '../dist/src/market/driver.js';
import { validateScenario } from '../dist/src/scenario/schema.js';
const load = path => validateScenario(JSON.parse(readFileSync(path, 'utf8')));
const measure = s => {const start=performance.now();const result=runScenario(s);return {result,ms:performance.now()-start};};
const fixture=load('test/fixtures/golden-perf.json');
const perf=measure(fixture), replay=measure(fixture);
const hash=r=>createHash('sha256').update(JSON.stringify(r.facts)).digest('hex');
const many=load('scenarios/golden-winner.json');many.days=60;many.campaigns[0].targets=Array.from({length:20},(_,i)=>({...many.campaigns[0].targets[0],id:`t${i}`,text:`winner ${i}`}));
const large=measure(many), golden=measure(load('scenarios/golden-winner.json'));
const daily=new Map();for(const o of golden.result.truth){const rows=daily.get(o.marketplaceDate)??[];rows.push(o);daily.set(o.marketplaceDate,rows);}
const depletion=[...daily].map(([day,rows])=>({day,hour:rows.find(o=>o.result.budgetExhausted)?.hour}));
const output={node:process.version,fixture:{ms:perf.ms,facts:perf.result.facts.length,sha256:hash(perf.result),replaySha256:hash(replay.result)},large:{ms:large.ms,facts:large.result.facts.length},golden:{ms:golden.ms,facts:golden.result.facts.length,depletionDays13to18:depletion.filter(x=>x.hour>=13&&x.hour<=18).length,days:depletion.length,firstDay:[...daily.values()][0].map(o=>o.result.clicks),depletion}};
mkdirSync('out',{recursive:true});writeFileSync('out/benchmark.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
