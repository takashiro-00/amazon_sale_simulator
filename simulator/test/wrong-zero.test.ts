import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {DEFAULT_CONFIG} from '../config/defaults.js';
import {validateScenario} from '../src/scenario/schema.js';
import {runAccountLoop} from '../src/runner/accountLoop.js';
import {measureRun} from '../src/montecarlo/metrics.js';
it('measures identical decisions independently of variant config with positive and immediate-lag controls',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/edge/premature-positive.json','utf8'))),r=await runAccountLoop({scenario:s});
 const a=measureRun(s,DEFAULT_CONFIG,r).metrics;
 expect(a.wrongZeroOrderTotal).toBeGreaterThan(0);
 expect(r.decisions.filter(d=>['R06','R12','R13','R16','R17','R08'].includes(d.ruleId)).every(d=>d.zeroOrderWindows?.length)).toBe(true);
 const b=measureRun(s,{...DEFAULT_CONFIG,v32:{...DEFAULT_CONFIG.v32,zeroOrderLagDays:8}},r).metrics;
 expect(b.wrongZeroOrder).toEqual(a.wrongZeroOrder);expect(b.wrongZeroOrderPause).toEqual(a.wrongZeroOrderPause);
 s.attribution.lagDistribution={'0':1};const immediate=await runAccountLoop({scenario:s});
 expect(measureRun(s,DEFAULT_CONFIG,immediate).metrics.wrongZeroOrderTotal).toBe(0);
},30000);
it('records action delay from the first spend/click threshold day',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/edge/premature-positive.json','utf8'))),r=await runAccountLoop({scenario:s});
 const m=measureRun(s,DEFAULT_CONFIG,r).metrics;
 expect(typeof m.actionDelayDays).toBe('number');expect(m.actionDelayDays).toBeGreaterThanOrEqual(2);
},30000);
it('exports decision windows and mature order counts for replay from Monte Carlo JSON',async()=>{
 const {runSeed}=await import('../src/montecarlo/metrics.js');
 const s=validateScenario(JSON.parse(readFileSync('scenarios/edge/premature-positive.json','utf8')));
 const run=JSON.parse(JSON.stringify(await runSeed(s,DEFAULT_CONFIG,s.seed)));
 expect(run.zeroOrderEvidence.length).toBeGreaterThan(0);
 expect(run.zeroOrderEvidence.some((d:{windows:{trueOrders:number}[]})=>d.windows.some(w=>w.trueOrders>0))).toBe(true);
},30000);
it('counts overlapping evidence once per decision and only actual permanent pauses',async()=>{
 const {fixture,run}=await import('./step4-fixture.js');const {wrongZeroOrders}=await import('../src/montecarlo/metrics.js');const {usd}=await import('../src/domain/money.js');
 const c=fixture(1,0,5),d=run('R06',c)!;expect(d).not.toBeNull();expect(d.zeroOrderWindows?.length).toBeGreaterThan(0);
 const s=validateScenario(JSON.parse(readFileSync('scenarios/edge/premature-positive.json','utf8')));
 const w=d.zeroOrderWindows![0]!,fact={entityRef:w.entity,marketplaceDate:w.to,knownAt:'2026-10-25T07:00:00Z',impressions:1,clicks:1,spendMicros:usd('1'),orders:1,salesMicros:usd('30')};
 const bad={...d,zeroOrderWindows:[w,w]};
 expect(wrongZeroOrders(s,[{...bad,ruleId:'R01'}],[fact]).wrongZeroOrderTotal).toBe(0);
 expect(wrongZeroOrders(s,[bad],[fact])).toMatchObject({wrongZeroOrderTotal:1,wrongZeroOrderPause:1});
 expect(wrongZeroOrders(s,[{...bad,after:bad.before}],[fact]).wrongZeroOrderPause).toBe(0);
 expect(wrongZeroOrders(s,[bad],[{...fact,marketplaceDate:'2026-01-01'}]).wrongZeroOrderTotal).toBe(0);
 expect(wrongZeroOrders(s,[bad],[fact,{...fact,knownAt:'2026-10-26T07:00:00Z',orders:0}]).wrongZeroOrderTotal).toBe(0);
});
it('excludes R05 positive-order branch from zero-order evidence',async()=>{
 const {fixture,run}=await import('./step4-fixture.js');const c=fixture(2,1,5,.9),d=run('R05',c);
 expect(d).not.toBeNull();expect(d?.zeroOrderWindows).toBeUndefined();
});
it('R13 floor branch excludes an unused since-R12 lookback',async()=>{
 const {fixture}=await import('./step4-fixture.js');const {firstMatchWins}=await import('../src/engine/priority.js');const {registry}=await import('../src/rules/registry.js');const {FactIndex}=await import('../src/data/facts.js');const {MetricsReader}=await import('../src/data/metrics.js');const {usd}=await import('../src/domain/money.js');const {wrongZeroOrders}=await import('../src/montecarlo/metrics.js');
 const c=fixture(0,0,5),facts=c.metrics.facts('c','2026-10-01','2026-10-17').map(f=>({...f,entityRef:'t',clicks:30}));
 const old={...facts[0]!,marketplaceDate:'2026-10-01',orders:0};facts.push(old);
 const ctx={...c,metrics:new MetricsReader(new FactIndex(facts),c.metrics.asOf,c.config),state:{...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.2'),r12Count:1,r12LastAt:'2026-10-01T07:00:00Z'}}}};
 const d=firstMatchWins({id:'t',group:'TARGET',campaignId:'c'},[registry.find(r=>r.id==='R13')!],ctx)!;
 expect(d).not.toBeNull();expect(d.zeroOrderWindows!.every(w=>w.from>='2026-10-04')).toBe(true);
 const s=validateScenario(JSON.parse(readFileSync('scenarios/edge/premature-positive.json','utf8')));
 expect(wrongZeroOrders(s,[d],[...facts,{...old,orders:1,knownAt:'2026-10-25T07:00:00Z'}]).wrongZeroOrderTotal).toBe(0);
});
