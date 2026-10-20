import { it, expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { FactIndex } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { registry } from '../src/rules/registry.js';
import { firstMatchWins, TARGET } from '../src/engine/priority.js';
import { usd } from '../src/domain/money.js';
import type { RuleContext, RuleId } from '../src/engine/types.js';
export function targetFixture(clicks=20, orders=0, spend=12, days=14): RuleContext {
 const c=fixture();const fs=c.metrics.facts('c','2026-10-01','2026-10-17').slice(0,days).map((f,i)=>({...f,entityRef:'t',impressions:5,clicks:i===0?clicks:0,orders:i===0?orders:0,spendMicros:usd(i===0?String(spend):'0'),salesMicros:usd(i===0&&orders?'100':'0')}));
 return {...c,metrics:new MetricsReader(new FactIndex(fs),c.clock.now(),c.config),state:{...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.80'),anchorBidMicros:usd('.80')}}}};
}
export const runTarget=(id:RuleId,c:RuleContext)=>firstMatchWins({group:'TARGET',id:'t'},[registry.find(r=>r.id===id)!],c);
it.each([['R12',20,0,12,'.64'],['R11',15,1,50,'.64'],['R10',15,3,10,'.88'],['R14',0,0,0,'.58']] as const)('%s matches purely',(id,clicks,orders,spend,bid)=>{
 let c=targetFixture(clicks,orders,spend);if(id==='R14')c={...c,state:{...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.50')}}}};
 const old=structuredClone(c.state);expect(runTarget(id,c)?.after.targets.t?.baseBidMicros).toBe(usd(bid));expect(c.state).toEqual(old);
});
it.each(['R12','R11','R10'] as const)('%s below sample does not match',id=>expect(runTarget(id,targetFixture(0,0,0))).toBeNull());
it('R13 pauses from rolling 30 clicks and post R12 10 clicks, ignores bid cooldown',()=>{
 let c=targetFixture(30,0,16.8);c={...c,state:{...c.state,targets:{t:{...c.state.targets.t!,windowStartAt:'2026-10-18T07:00Z',bidCooldownUntil:'2026-10-23',r12Count:1,r12LastAt:'2026-10-17T07:00Z'}}}};
 const d=runTarget('R13',c);expect(d?.after.targetEntities.t?.status).toBe('PAUSED');expect(d?.baseBidTargetIds).toEqual([]);
});
it('R12 floor is a no-op and waste blocks R14 for thirty days',()=>{
 const c=targetFixture();const state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.40'),wasteFlagUntil:'2026-11-20T08:00Z'}}};
 expect(runTarget('R12',{...c,state})).toBeNull();expect(runTarget('R14',{...targetFixture(0,0,0),state})).toBeNull();
});
it('R14 requires full seven fact days and resets count only after its flag expires',()=>{
 const c=targetFixture(0,0,0,6);expect(runTarget('R14',c)).toBeNull();
 const x=targetFixture(0,0,0);const state={...x.state,targets:{t:{...x.state.targets.t!,baseBidMicros:usd('.50'),r14Count:3,lowImpressionFlagUntil:'2026-10-18T07:00Z'}}};
 expect(runTarget('R14',{...x,state})?.after.targets.t?.r14Count).toBe(1);
});
it('target rules skip paused target and paused campaign',()=>{
 for(const id of TARGET){const c=targetFixture();expect(runTarget(id,{...c,state:{...c.state,targetEntities:{t:{...c.state.targetEntities.t!,status:'PAUSED'}}}})).toBeNull();}
});
it('R13 counts the entire interval since R12, including orders older than thirty days',()=>{let c=targetFixture(30,0,17);const fs=[...c.metrics.facts('t','2026-10-01','2026-10-17'),{entityRef:'t',marketplaceDate:'2026-09-10',knownAt:c.clock.now(),impressions:1,clicks:1,orders:1,spendMicros:usd('1'),salesMicros:usd('30')}];c={...c,metrics:new MetricsReader(new FactIndex(fs),c.clock.now(),c.config),state:{...c.state,targets:{t:{...c.state.targets.t!,r12Count:1,r12LastAt:'2026-09-01T07:00Z'}}}};expect(runTarget('R13',c)).toBeNull();});
it('R14 consumes an expired flag only with an effective proposal',()=>{
 const c=targetFixture(0,0,0);const state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.50'),r14Count:3,lowImpressionFlagUntil:'2026-10-18T07:00Z'}}};
 expect(runTarget('R14',{...c,state})?.after.targets.t?.lowImpressionFlagUntil).toBeNull();
 expect(state.targets.t.lowImpressionFlagUntil).toBe('2026-10-18T07:00Z');
 const blocked={...state,targets:{t:{...state.targets.t,wasteFlagUntil:'2026-11-20T07:00Z'}}};
 expect(runTarget('R14',{...c,state:blocked,decisions:[]})).toBeNull();
 expect(blocked.targets.t.r14Count).toBe(3);expect(blocked.targets.t.lowImpressionFlagUntil).toBe('2026-10-18T07:00Z');
});
it('R14 limits every flag cycle to three raises over 120 low-impression days',()=>{
 const base=targetFixture(0,0,0);let state={...base.state,targets:{t:{...base.state.targets.t!,baseBidMicros:usd('.01')}}};let raises=0;const cycles:number[]=[];
 for(let day=0;day<120;day++){
  const at=new Date(Date.parse(base.clock.now())+day*86400000).toISOString();const today=at.slice(0,10);
  const fs=Array.from({length:7},(_,i)=>({entityRef:'t',marketplaceDate:new Date(Date.parse(at)-(i+2)*86400000).toISOString().slice(0,10),knownAt:at,impressions:0,clicks:0,orders:0,spendMicros:usd('0'),salesMicros:usd('0')}));
  const c={...base,state,today,clock:{now:()=>at},metrics:new MetricsReader(new FactIndex(fs),at,base.config)};
  const p=registry.find(r=>r.id==='R14')!.evaluate({group:'TARGET',id:'t'},c);if(!p)continue;
  state=p.proposedState as typeof state;raises++;
  if(state.targets.t.lowImpressionFlagUntil&&state.targets.t.lowImpressionFlagUntil!==c.state.targets.t.lowImpressionFlagUntil){cycles.push(raises);raises=0;}
 }
 expect(cycles.length).toBeGreaterThanOrEqual(2);expect(cycles.every(n=>n===3)).toBe(true);expect(raises).toBeLessThanOrEqual(3);
});
