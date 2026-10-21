import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {summarizeRuns,compareSummaries,pairedRates} from '../dist/src/montecarlo/index.js';
const root='out/v32-truth',read=async p=>JSON.parse(await readFile(p,'utf8'));
const equal=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`MISMATCH:${label}`);};
const checks=[];
for(const name of ['P1-premature-population','storm','marginal','full']){
 const dir=`${root}/${name}`,summary=await read(`${dir}/summary.json`);
 const load=async file=>{const rows=(await readFile(`${dir}/${file}`,'utf8')).trim().split('\n').map(JSON.parse);
  equal(rows.map(r=>r.seed),Array.from({length:100},(_,i)=>i),`${name}:${file}:seeds`);
  for(const r of rows){
   // All pause actions in this matrix succeeded. Thus an R06/R13 evidence row is an actual permanent pause.
   if(r.metrics.apiFailures!==0||(r.metrics.notifications.API_WRITE_FAILED??0)!==0)throw new Error('REQUIRES_APPLIED_PAUSE_REPLAY');
   const counts=Object.fromEntries(['R06','R13','R12','R16','R17','R05B','R08'].map(id=>[id,0]));let pauses=0;
   if(!Array.isArray(r.zeroOrderEvidence))throw new Error('MISSING_DECISION_EVIDENCE');
   for(const d of r.zeroOrderEvidence){if(!d.windows.length)throw new Error('EMPTY_EVIDENCE');if(d.windows.some(w=>w.trueOrders>0)){counts[d.ruleId==='R05'?'R05B':d.ruleId]++;if(['R06','R13'].includes(d.ruleId))pauses++;}}
   equal(counts,r.metrics.wrongZeroOrder,`${name}:${r.seed}:truth`);equal(pauses,r.metrics.wrongZeroOrderPause,`${name}:${r.seed}:pause`);equal(Object.values(counts).reduce((a,b)=>a+b,0),r.metrics.wrongZeroOrderTotal,`${name}:${r.seed}:total`);
  }
  return rows;
 };
 const baseline=await load('runs.jsonl');equal(summarizeRuns(baseline).metrics,summary.metrics,`${name}:baseline`);equal(summarizeRuns(baseline).wrongZeroOrderPauseRunRate,summary.wrongZeroOrderPauseRunRate,`${name}:rate`);
 for(const v of summary.variants){const rows=await load(`${v.name}-runs.jsonl`);equal(summarizeRuns(rows),v.summary,`${name}:${v.name}:summary`);equal(compareSummaries(summary,v.summary),v.diff,`${name}:${v.name}:diff`);equal(pairedRates(baseline,rows),v.paired,`${name}:${v.name}:paired`);}
 for(const k of [3,5,8])if(!summary.variants.some(v=>v.name===`P1-K${k}`))throw new Error(`MISSING_K:${k}`);
 checks.push({name,seeds:baseline.length,variants:summary.variants.map(v=>v.name),pass:true});
}
const hashes=await read(`${root}/legacy-hashes.json`);if(hashes.length!==12||hashes.some(r=>!r.pass))throw new Error('LEGACY_HASH_MISMATCH');
const scenarios={};for(const n of ['edge/premature-population','edge/attribution-storm-account','marginal-account','full-account'])scenarios[n]=createHash('sha256').update(await readFile(`scenarios/${n}.json`)).digest('hex');
await writeFile(`${root}/validation.json`,JSON.stringify({checks,scenarios,legacy:hashes.length,validatedAt:new Date().toISOString()},null,2)+'\n');
console.log('PASS: four matrices, 100 paired seeds/config, truth from recorded windows, summaries/deltas/rates, 12 legacy hashes');
