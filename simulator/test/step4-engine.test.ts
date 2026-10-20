import { it, expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { firstMatchWins } from '../src/engine/priority.js';
import { registry } from '../src/rules/registry.js';
import { usd } from '../src/domain/money.js';
import type { RuleDefinition } from '../src/engine/types.js';
const rule = (id: string, evaluate: RuleDefinition['evaluate']): RuleDefinition => ({ ...registry.find(r=>r.id===id)!, evaluate });
it('placement-only proposal never silently changes base bids',()=>{
 const c=fixture();const r=rule('R18',(_,ctx)=>({proposedState:{...ctx.state,campaigns:{c:{...ctx.state.campaigns.c!,topOfSearchPct:100}}}}));
 expect(firstMatchWins({group:'PLACEMENT',id:'c'},[r],c)?.after.targets.t?.baseBidMicros).toBe(usd('1'));
});
it('G6 considers the maximum hourly multiplier rather than current hour',()=>{
 const c=fixture();const m=c.state.targets.t!;const ctx={...c,state:{...c.state,targets:{t:{...m,baseBidMicros:usd('.70'),hourlyFactor:{...m.hourlyFactor,12:1.5}}}}};
 const r=rule('R10',(_,x)=>({proposedState:{...x.state,targets:{t:{...x.state.targets.t!,baseBidMicros:usd('.84')}}}}));
 expect(firstMatchWins({group:'TARGET',id:'t'},[r],ctx)?.after.targets.t?.baseBidMicros).toBeLessThanOrEqual(usd('.72'));
});
it('campaign-first skips the entire target group before cooldown checks',()=>{
 const c=fixture();const r=registry.find(r=>r.id==='R07')!;const d=firstMatchWins({group:'CAMPAIGN',id:'c'},[rule('R07',(_,x)=>({proposedState:{...x.state,targets:{t:{...x.state.targets.t!,baseBidMicros:usd('.90')}}}}))],c)!;
 firstMatchWins({group:'TARGET',id:'t'},[registry.find(r=>r.id==='R11')!],{...c,state:d.after});
 expect(c.audit.events.at(-1)?.outcome).toBe('SKIPPED_CROSS_LEVEL');
});
it('new targets pass G6 using destination thresholds',()=>{
 const c=fixture();const r=rule('R15',(_,x)=>({proposedState:{...x.state,targets:{...x.state.targets,u:{...x.state.targets.t!,baseBidMicros:usd('2'),anchorBidMicros:usd('2')}},targetEntities:{...x.state.targetEntities,u:{...x.state.targetEntities.t!,id:'u',bidMicros:usd('2')}}}}));
 expect(firstMatchWins({group:'SEARCHTERM',id:'q',campaignId:'c'},[r],c)?.after.targets.u?.baseBidMicros).toBe(usd('1.08'));
});
it('target bid guard no-op never consumes R14 attempts or R12 counters',()=>{const c=fixture();const state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('1.08')}}};const r=rule('R14',(_,x)=>({proposedState:{...x.state,targets:{t:{...x.state.targets.t!,baseBidMicros:usd('1.2'),r14Count:1}}}}));expect(firstMatchWins({group:'TARGET',id:'t'},[r],{...c,state})).toBeNull();expect(c.audit.events.at(-1)?.outcome).toBe('SKIPPED_NOOP');});
