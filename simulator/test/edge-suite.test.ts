import {it,expect} from 'vitest';
import {evaluateAccountEdges} from '../src/edge/suite.js';
import {runAccountLoop} from '../src/runner/accountLoop.js';
import {validateScenario} from '../src/scenario/schema.js';
import {readFileSync} from 'node:fs';
it('edge checks reject duplicate per-run target bid decisions and record measures',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/full-account.json','utf8')));s.days=3;
 const r=await runAccountLoop({scenario:s});const rows=evaluateAccountEdges(r,s);
 expect(rows.find(x=>x.id==='B4')?.status).toBe('PASS');expect(rows.find(x=>x.id==='C2')?.metrics).toHaveProperty('targets');
 const d={...r.decisions[0]!,baseBidTargetIds:[s.campaigns[0]!.targets[0]!.id]};
 const broken={...r,decisions:[...r.decisions,d,d]};expect(evaluateAccountEdges(broken,s).find(x=>x.id==='B4')?.status).toBe('FAIL');
 expect(rows.find(x=>x.id==='A2')?.metrics).toHaveProperty('decisions');
 expect(evaluateAccountEdges({...r,decisions:[{...r.decisions[0]!,asOf:'2099-01-01T00:00:00Z'}]},s).find(x=>x.id==='A2')?.status).toBe('FAIL');
});
it('edge measurement files retain every metric and invariant failures',async()=>{
 const {writeEdgeResults}=await import('../src/edge/suite.js');
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const out=mkdtempSync(join(tmpdir(),'edge-results-'));
 try{writeEdgeResults(out,[{id:'A1',type:'MEASURE',status:'MEASURE',pass:null,metrics:{premature:{R06:2}},explanation:'Mature reevaluation'}]);expect(JSON.parse(readFileSync(join(out,'A1.json'),'utf8')).metrics.premature.R06).toBe(2);}finally{rmSync(out,{recursive:true});}
});
it('D2 uses exactly the fourteen dates after tagging and excludes incomplete tails',async()=>{
 const {measureRecovery}=await import('../src/edge/suite.js');const {date}=await import('../src/time/clock.js');const {micros}=await import('../src/domain/money.js');
 const s=validateScenario(JSON.parse(readFileSync('scenarios/full-account.json','utf8')));s.days=30;const r=await runAccountLoop({scenario:{...s,days:3}}),cid=s.campaigns[0]!.id;
 const d={...r.decisions[0]!,ruleId:'R07' as const,runId:'2026-10-05T07:00:00.000Z|account',objectRef:{group:'CAMPAIGN' as const,id:cid}};
 const facts=Array.from({length:14},(_,i)=>({entityRef:cid,marketplaceDate:date('2026-10-06').plus({days:i}).toISODate()!,knownAt:'2026-10-21T07:00:00Z',impressions:100,clicks:10,orders:1,spendMicros:micros(1e6),salesMicros:micros(10e6)}));
 expect(measureRecovery(s,{decisions:[d],facts})).toMatchObject({luckyBaseline:1,eligibleR07:1,excluded:0});expect(measureRecovery(s,{decisions:[d],facts:facts.slice(1)})).toMatchObject({luckyBaseline:0,eligibleR07:0,excluded:1});
});
it('A5 deduplicates capped target hours and A6 observes hourly analysis rather than daily decisions',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/full-account.json','utf8')));s.days=3;const r=await runAccountLoop({scenario:s});const targetId=s.campaigns[0]!.targets[0]!.id;
 const f={entityRef:targetId,marketplaceDate:s.startDate,hour:0 as const,hourBucket:'2026-10-01T07:00:00.000Z',impressions:0,clicks:0,orders:0,spendMicros:0 as import('../src/domain/money.js').Micros,salesMicros:0 as import('../src/domain/money.js').Micros,knownAt:'2026-10-02T10:00:00Z',budgetCapped:true};
 const facts=[f,{...f,knownAt:'2026-10-03T10:00:00Z'},{...f,entityRef:s.campaigns[0]!.id},{...f,entityRef:targetId+':search:q'},{...f,placement:'TOP' as const}];
 const result=Object.assign({...r,facts,matureFacts:facts},{hourlyAnalyses:[{at:'2026-10-05T07:00:00Z',targetId,hour:0,before:1,after:.7,clicks:0,impressions:0},{at:'2026-10-05T07:00:00Z',targetId,hour:1,before:1,after:1.15,clicks:50,impressions:1000}]});
 const rows=evaluateAccountEdges(result,s);expect(rows.find(x=>x.id==='A5')?.metrics).toMatchObject({budgetCappedHours:1,missingDataHours:1,r20Reductions:1,r20MissingDataReductions:1});expect(rows.find(x=>x.id==='A6')?.metrics).toMatchObject({R20:1,R21:1});
});
it('B2 labels measured window spend separately from the product Spend_zero threshold',async()=>{
 const {measureZeroOrderWindow}=await import('../src/edge/suite.js');const {micros}=await import('../src/domain/money.js');const {date}=await import('../src/time/clock.js');const s=validateScenario(JSON.parse(readFileSync('scenarios/full-account.json','utf8')));s.days=3;const r=await runAccountLoop({scenario:s}),cid=s.campaigns[0]!.id;
 const d={...r.decisions[0]!,runId:'2026-10-08T07:00:00.000Z|account',before:r.state,objectRef:{group:'CAMPAIGN' as const,id:cid}};
 const facts=Array.from({length:5},(_,i)=>({entityRef:cid,marketplaceDate:date('2026-10-01').plus({days:i}).toISODate()!,knownAt:'2026-10-06T07:00:00Z',impressions:100,clicks:5,orders:0,spendMicros:micros(5e6),salesMicros:micros(0)}));
 expect(measureZeroOrderWindow(s,d,facts)).toMatchObject({Spend_zero:21,windowZeroSpend:25,spendZero:25});
});
