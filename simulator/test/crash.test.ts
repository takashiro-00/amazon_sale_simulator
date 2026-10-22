import { it,expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { runDaily } from '../src/runner/runDaily.js';
import { CrashingPort,CrashError } from '../src/api/crashingPort.js';
import { InMemoryFakePort } from '../src/api/port.js';
import { FactIndex } from '../src/data/facts.js';
import { usd } from '../src/domain/money.js';

it('E2 replay from pre-run snapshot at each crash point equals clean daily state and API with R12 only once',async()=>{
 const c=fixture(0,0,10,0),targets={...c.state.targets},targetEntities={...c.state.targetEntities};
 for(let n=0;n<8;n++){const id=`t${n}`;targets[id]=c.state.targets.t!;targetEntities[id]={...c.state.targetEntities.t!,id,text:id};}
 const state={...c.state,targets,targetEntities};
 const facts=Object.keys(targets).flatMap(id=>c.metrics.facts('c','2026-10-01','2026-10-17').map(f=>({...f,entityRef:id,clicks:10})));facts.push(...c.metrics.facts('c','2026-10-01','2026-10-17').map(f=>({...f,orders:1,spendMicros:usd('1'),salesMicros:usd('30')})));
 const input={state,config:c.config,clock:c.clock,facts,thresholds:Object.fromEntries(Object.keys(targets).map(id=>[id,c.thresholds.t!])),thresholdsByCampaign:c.thresholdsByCampaign};
 const seed=async()=>{const p=new InMemoryFakePort();await p.updateCampaign(state.campaigns.c!,'seed');for(const e of Object.values(targetEntities))await p.updateTargets([{target:e,bidMicros:usd('1')}],'/sp/keywords',`seed:${e.id}`);return p;};
 const clean=await seed(),expected=await runDaily({...input,port:clean}),writes=clean.idempotencyLog.filter(l=>!l.key.startsWith('seed')).length;
 expect(writes).toBeGreaterThan(5);expect(expected.decisions.some(d=>d.ruleId==='R12')).toBe(true);
 for(const n of new Set([1,2,5,Math.floor(writes/2),writes-1])){
  const inner=await seed(),p=new CrashingPort(inner,n);
  await expect(runDaily({...input,port:p})).rejects.toThrow(CrashError);p.disarm();
  const actual=await runDaily({...input,port:p});expect(actual.state).toEqual(expected.state);
  expect(await inner.getCampaigns(['c'])).toEqual(await clean.getCampaigns(['c']));expect(await inner.listTargets('c')).toEqual(await clean.listTargets('c'));
  expect(inner.idempotencyLog).toEqual(clean.idempotencyLog);
 }
});
