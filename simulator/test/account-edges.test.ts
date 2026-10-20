import { it,expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { firstMatchWins,TARGET } from '../src/engine/priority.js';
import { registry } from '../src/rules/registry.js';
import { FactIndex,type MetricFact } from '../src/data/facts.js';
import { MetricsReader } from '../src/data/metrics.js';
import { usd } from '../src/domain/money.js';
import { SimClock,dMinus } from '../src/time/clock.js';
import type { RuleContext } from '../src/engine/types.js';
function context():RuleContext{const c=fixture(3,1,5,.41);return {...c,metrics:new MetricsReader(new FactIndex([...c.metrics.facts('c','2026-10-01','2026-10-17'),...c.metrics.facts('c','2026-10-01','2026-10-17').map(f=>({...f,entityRef:'t'}))]),c.clock.now(),c.config)};}
it('B4 R07 wins same day, R11 skipped then runs on next eligible date; error policy diagnostic',()=>{
 const c=context();const d=firstMatchWins({group:'CAMPAIGN',id:'c'},[registry.find(r=>r.id==='R07')!],c)!;
 expect(d.ruleId).toBe('R07');expect(d.after.targets.t?.baseBidMicros).toBe(usd('.90'));
 expect(firstMatchWins({group:'TARGET',id:'t'},TARGET.map(id=>registry.find(r=>r.id===id)!),{...c,state:d.after})).toBeNull();expect(c.audit.events.filter(e=>e.objectRef.group==='TARGET').every(e=>e.outcome==='SKIPPED_CROSS_LEVEL')).toBe(true);
 const later={...c,state:d.after,runId:'later',today:'2026-10-23',clock:new SimClock('2026-10-23T07:00Z')};
 const fs:MetricFact[]=Array.from({length:3},(_,i)=>({entityRef:'t',marketplaceDate:dMinus(later.today,i+2),knownAt:later.clock.now(),impressions:100,clicks:5,orders:1,spendMicros:usd('10'),salesMicros:usd('15')}));
 const next=firstMatchWins({group:'TARGET',id:'t'},TARGET.map(id=>registry.find(r=>r.id===id)!),{...later,metrics:new MetricsReader(new FactIndex(fs),later.clock.now(),c.config)});expect(next?.ruleId).toBe('R11');expect(next?.after.targets.t?.baseBidMicros).toBe(usd('.72'));
 const err={...c,config:{...c.config,ambiguity:{...c.config.ambiguity,crossLevelBidPolicy:'error' as const}},state:{...d.after,targets:{t:{...d.after.targets.t!,bidCooldownUntil:null,windowStartAt:'2026-10-01T07:00Z'}}}};
 firstMatchWins({group:'TARGET',id:'t'},[registry.find(r=>r.id==='R11')!],err);expect(c.audit.events.at(-1)?.reasons).toContain('CROSS_LEVEL_BID_CONFLICT');
});
it('B5 waste floor is never raised by R14 during thirty days',()=>{const c=context();for(let day=0;day<30;day++){const now=new SimClock('2026-10-19T07:00Z');now.advanceHours(day*24);const today=now.now().slice(0,10);const m=c.state.targets.t!;const fs=c.metrics.facts('t','2026-10-01','2026-10-17').slice(0,7).map((f,i)=>({...f,marketplaceDate:dMinus(today,i+2),knownAt:now.now(),clicks:0,orders:0,impressions:0,spendMicros:usd('0'),salesMicros:usd('0')}));const state={...c.state,targets:{t:{...m,baseBidMicros:usd('.50'),wasteFlagUntil:'2026-11-20T08:00Z'}}};expect(firstMatchWins({group:'TARGET',id:'t'},TARGET.map(id=>registry.find(r=>r.id===id)!),{...c,runId:String(day),today,clock:now,state,metrics:new MetricsReader(new FactIndex(fs),now.now(),c.config)})).toBeNull();}});
