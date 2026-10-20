import {it,expect} from 'vitest';
import {fixture,run} from './step4-fixture.js';
import {AuditLog} from '../src/audit/log.js';
it('C3 five MANAGE NORMAL cycles restore base within one cent',()=>{
 let state=fixture(3).state;
 const initial=state.targets.t!.baseBidMicros;
 for(let cycle=0;cycle<5;cycle++){
  const bad=fixture(3,1,5,.41);const old=state.targets.t!;
  const managed=run('R07',{...bad,runId:`cycle:${cycle}:tag`,state:{...bad.state,targets:{t:{...old,bidCooldownUntil:null,windowStartAt:'2026-10-01T07:00Z'}}}})!;
  expect(managed.after.campaignMemory.c?.tag).toBe('MANAGE');state=managed.after;
  for(let step=0;step<8;step++){
   const good=fixture(3,1,5,.2);const m=state.campaignMemory.c!;
   const d=run('R09',{...good,runId:`cycle:${cycle}:restore:${step}`,audit:new AuditLog(),state:{...state,campaignMemory:{c:{...m,windowStartAt:'2026-10-01T07:00Z',taggedAt:'2026-10-01T07:00Z',graceUntil:null,cooldownUntil:{budget:null,placement:null},r09ConsecutivePasses:2}},targets:{t:{...state.targets.t!,bidCooldownUntil:null}}}});
   if(d)state=d.after;
   if(state.campaignMemory.c?.tag==='NORMAL'&&!state.campaignMemory.c.bidRestorePending)break;
  }
  expect(state.campaignMemory.c?.tag).toBe('NORMAL');expect(Math.abs(state.targets.t!.baseBidMicros-initial)).toBeLessThanOrEqual(10000);
 }
});
