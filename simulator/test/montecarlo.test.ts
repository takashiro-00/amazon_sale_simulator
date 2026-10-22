import { describe,it,expect } from 'vitest';
import { summarizeRuns,applyOverrides } from '../src/montecarlo/index.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
describe('Monte Carlo deterministic summaries',()=>{
 it('uses interpolated percentiles and excludes null unreached tiers',()=>{
  const summary=summarizeRuns([{seed:0,metrics:{profit:1,timeToTier:{to12:null}}},{seed:1,metrics:{profit:3,timeToTier:{to12:8}}},{seed:2,metrics:{profit:5,timeToTier:{to12:10}}}]);
  expect(summary.metrics.profit).toEqual({count:3,p5:1.2,p50:3,p95:4.8,mean:3,min:1,max:5});
  expect(summary.metrics['timeToTier.to12']?.count).toBe(2);
 });
 it('includes zero notifications in runs where an event did not occur',()=>{expect(summarizeRuns([{seed:0,metrics:{notifications:{ALERT:2}}},{seed:1,metrics:{notifications:{}}}]).metrics['notifications.ALERT']?.mean).toBe(1);});
 it('applies typed existing configuration paths without mutation',()=>{
  expect(applyOverrides(DEFAULT_CONFIG,['ambiguity.changeDayCountsAsPost=false']).ambiguity.changeDayCountsAsPost).toBe(false);
  expect(DEFAULT_CONFIG.ambiguity.changeDayCountsAsPost).toBe(true);
  expect(()=>applyOverrides(DEFAULT_CONFIG,['missing.value=3'])).toThrow();
 });
});

import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateScenario } from '../src/scenario/schema.js';
import { runMonteCarlo } from '../src/montecarlo/index.js';
it('runs three seeds deterministically across worker counts and writes comparison artifacts',async()=>{
 const scenario=validateScenario(JSON.parse(await readFile(new URL('../scenarios/full-account.json',import.meta.url),'utf8')));scenario.days=3;
 const out=await mkdtemp(join(tmpdir(),'sim-mc-'));
 try{const a=await runMonteCarlo({scenario,config:DEFAULT_CONFIG,seeds:3,workers:1,out,compare:['ambiguity.changeDayCountsAsPost=false']}),b=await runMonteCarlo({scenario,config:DEFAULT_CONFIG,seeds:3,workers:2});
 expect(a.runs).toEqual(b.runs);expect(a.runs).toHaveLength(3);expect(a.runs.every(r=>r.metrics.invariantViolations===0)).toBe(true);
 expect((await readFile(join(out,'runs.jsonl'),'utf8')).trim().split('\n')).toHaveLength(3);expect(JSON.parse(await readFile(join(out,'summary.json'),'utf8')).compare.override).toEqual(['ambiguity.changeDayCountsAsPost=false']);
 }finally{await rm(out,{recursive:true,force:true});}
},20000);

import { ScriptedMarket } from '../src/market/scripted.js';
import { runAccountLoop } from '../src/runner/accountLoop.js';
import { maturePremature } from '../src/montecarlo/metrics.js';
import { date } from '../src/time/clock.js';
import { micros } from '../src/domain/money.js';
it('reevaluates the original R12 window with mature orders and original decision state',async()=>{
 const s=validateScenario(JSON.parse(await readFile(new URL('../scenarios/zero-order.json',import.meta.url),'utf8')));s.days=12;
 const campaign=s.campaigns[0]!,t=campaign.targets[0]!;campaign.type='MANUAL';t.kind='KEYWORD';t.matchType='EXACT';t.bid=.8;t.text='bleeder';campaign.targets=[t,{...t,id:'winner',text:'winner',trueCvr:.3}];s.products[0]!.priceUsd=30;s.products[0]!.breakEvenAcos=.4;
 const r=await runAccountLoop({scriptedMarket:new ScriptedMarket(s,({day})=>{const clicks=day<=3?5:day===5?10:0;return {clicks:0,orders:0,spendUsd:0,salesUsd:0,targets:{[t.id]:{clicks,spendUsd:clicks*.56,orders:0,salesUsd:0},winner:{clicks:5,spendUsd:1,orders:1,salesUsd:30}}};})});
 const decision=r.decisions.find(d=>d.ruleId==='R12')!;expect(decision).toBeDefined();
 expect(maturePremature(s,DEFAULT_CONFIG,[decision],r.facts).premature.R12).toBe(0);
 const late=r.facts.filter(f=>f.entityRef===t.id&&f.hour===undefined&&!f.placement).map(f=>({...f,orders:1,salesMicros:micros(30e6),knownAt:date(s.startDate,s.marketplace.zone).plus({days:14}).toUTC().toISO()!}));
 expect(maturePremature(s,DEFAULT_CONFIG,[decision],[...r.facts,...late]).premature.R12).toBe(1);
});

import { fixture,run as runRule } from './step4-fixture.js';
it('counts only R05B zero-order decisions and does not accept mature R05A as the same condition',async()=>{
 const s=validateScenario(JSON.parse(await readFile(new URL('../scenarios/zero-order.json',import.meta.url),'utf8')));s.days=30;s.products[0]!.asin='A';s.campaigns[0]!.asin='A';
 const ctx=fixture(3,0,5),at=ctx.clock.now(),original={...ctx,runId:`${at}|account`};
 const d=runRule('R05',original)!;expect(d).toBeDefined();
 const facts=ctx.metrics.facts('c','2026-10-01','2026-10-19');
 expect(maturePremature(s,DEFAULT_CONFIG,[d],facts).premature.R05B).toBe(0);
 const late=facts.map(f=>({...f,orders:1,salesMicros:micros(1e6),knownAt:'2026-10-25T07:00:00.000Z'}));
 expect(maturePremature(s,DEFAULT_CONFIG,[d],[...facts,...late]).premature.R05B).toBe(1);
 const a=fixture(3,1,5,1),da=runRule('R05',{...a,runId:`${a.clock.now()}|account`})!;expect(da).toBeDefined();
 expect(maturePremature(s,DEFAULT_CONFIG,[da],a.metrics.facts('c','2026-10-01','2026-10-19')).premature.R05B).toBe(0);
});

import { measureWastedSpend } from '../src/montecarlo/metrics.js';
import type { Decision } from '../src/engine/types.js';
import type { MetricFact } from '../src/data/facts.js';
it('counts physical wasted spend once across target, term, and campaign actions',async()=>{
 const s=validateScenario(JSON.parse(await readFile(new URL('../scenarios/zero-order.json',import.meta.url),'utf8')));s.products[0]!.asin='A';s.campaigns[0]!.asin='A';const c=fixture();
 const decision=(ruleId:Decision['ruleId'],objectRef:Decision['objectRef']):Decision=>({runId:'2026-10-19T07:00:00.000Z|account',ruleId,objectRef,before:c.state,after:c.state,baseBidTargetIds:[],paramsVersion:c.paramsVersion});
 const actions=[decision('R13',{group:'TARGET',id:'t',campaignId:'c'}),decision('R16',{group:'SEARCHTERM',id:'t:search:q',sourceTargetId:'t',query:'q',campaignId:'c'}),decision('R06',{group:'CAMPAIGN',id:'c'})];
 const fact=(entityRef:string,clicks:number,spend:number):MetricFact=>({entityRef,marketplaceDate:'2026-10-15',impressions:100,clicks,orders:0,salesMicros:micros(0),spendMicros:micros(spend*1e6),knownAt:'2026-10-16T10:00:00.000Z'});
 const facts=[fact('t',40,20),fact('t:search:q',40,20),fact('c',40,20)];
 expect(measureWastedSpend(s,DEFAULT_CONFIG,actions,facts)).toBe(10);
 expect(measureWastedSpend(s,DEFAULT_CONFIG,[actions[2]!],facts)).toBe(10);
});

import { compareSummaries } from '../src/montecarlo/index.js';
it('comparison includes notifications that occur only in one configuration',()=>{
 const a=summarizeRuns([{seed:0,metrics:{notifications:{ALERT:2}}}]),b=summarizeRuns([{seed:0,metrics:{notifications:{DRIFT:1}}}]);
 expect(compareSummaries(a,b)['notifications.ALERT']?.mean).toBe(-2);
 expect(compareSummaries(a,b)['notifications.DRIFT']?.mean).toBe(1);
});
