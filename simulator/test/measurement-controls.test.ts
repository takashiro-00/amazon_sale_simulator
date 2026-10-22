import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateScenario} from '../src/scenario/schema.js';
import {runAccountLoop} from '../src/runner/accountLoop.js';
import {measureRun} from '../src/montecarlo/metrics.js';
import {DEFAULT_CONFIG} from '../config/defaults.js';
import {measureLagControl,measureHourlySignal} from '../src/edge/controls.js';
import {summarizeRuns} from '../src/montecarlo/index.js';
const load=(name:string)=>validateScenario(JSON.parse(readFileSync(`scenarios/${name}.json`,'utf8')));
it('detects premature real-market decisions with immediate attribution as negative control',async()=>{
 const s=load('edge/premature-positive'),r=await runAccountLoop({scenario:s});
 const m=measureRun(s,DEFAULT_CONFIG,r).metrics.premature as Record<string,number>;
 expect(m.R12!+m.R13!+m.R06!).toBeGreaterThan(0);
 const evidence=measureLagControl(s,r);expect(evidence).toHaveLength(2);for(const e of evidence){expect(e.observed.orders).toBe(0);expect(e.mature.orders).toBeGreaterThan(0);expect(e.observed.clicks).toBe(e.mature.clicks);}
 s.attribution.lagDistribution={'0':1};const negative=await runAccountLoop({scenario:s});
 expect(measureRun(s,DEFAULT_CONFIG,negative).metrics.prematureTotal).toBe(0);
},30000);
it('marginal account varies decisions and percentiles across eight seeds',async()=>{
 const s={...load('marginal-account'),days:18},runs=[],signatures=new Set<string>();
 for(let seed=0;seed<8;seed++){const scenario={...s,seed},r=await runAccountLoop({scenario,config:{...DEFAULT_CONFIG,audit:{level:'matched'}}});runs.push(measureRun(scenario,DEFAULT_CONFIG,r));signatures.add(JSON.stringify(r.decisions.map(d=>[d.ruleId,d.objectRef,d.runId])));}
 expect(signatures.size).toBeGreaterThan(1);
 const summary=summarizeRuns(runs);expect(['acos','profit','timeToTier.to12','timeToTier.to25'].some(k=>summary.metrics[k]?.p5!==summary.metrics[k]?.p95)).toBe(true);
},120000);
it('hourly signal changes both factors and submits changed boundaries once',async()=>{
 const s=load('edge/hourly-signal'),r=await runAccountLoop({scenario:s});
 expect(r.hourlyAnalyses.filter(a=>a.after<a.before&&a.after<1).length).toBeGreaterThan(0);
 expect(r.hourlyAnalyses.filter(a=>a.after>a.before&&a.after>1).length).toBeGreaterThan(0);
 const evidence=measureHourlySignal(s,r);expect(evidence.minHourlyClicks).toBeGreaterThanOrEqual(40);expect(evidence.hourly.every(h=>h.days===28)).toBe(true);expect(evidence.budgetCappedHours).toBe(0);
 const calls=r.portCalls.filter(c=>c.op.startsWith('updateTargets')&&c.idempotencyKey.startsWith('R21B:'));
 expect(r.hourlyBoundaries.filter(b=>b.changes.length>0)).toHaveLength(calls.length);
 for(const boundary of r.hourlyBoundaries){const writes=calls.filter(c=>c.time===boundary.at);expect(writes).toHaveLength(boundary.changes.length?1:0);for(const change of boundary.changes)expect(change.after).not.toBe(change.before);}
 expect(calls.length).toBeGreaterThan(0);expect(new Set(calls.map(c=>c.idempotencyKey)).size).toBe(calls.length);
},30000);
