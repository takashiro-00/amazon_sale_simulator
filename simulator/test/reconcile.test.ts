import { it,expect } from 'vitest';
import { fixture } from './step4-fixture.js';
import { InMemoryFakePort } from '../src/api/port.js';
import { FaultyFakePort } from '../src/api/faultyPort.js';
import { reconcile } from '../src/runner/reconcile.js';
import { usd } from '../src/domain/money.js';
import { SimClock } from '../src/time/clock.js';
it('reads campaign and all target kinds from Amazon and accepts console drift preserving window anchor cooldown',async()=>{
 const c=fixture(),p=new InMemoryFakePort();await p.updateCampaign({...c.state.campaigns.c!,dailyBudgetMicros:usd('8')},'console');await p.updateTargets([{target:c.state.targetEntities.t!,bidMicros:usd('.80')}],'/sp/keywords','console');
 const r=await reconcile({...c,port:p,sent:new Map([['t',usd('1')]])});
 expect(r.state.campaigns.c?.dailyBudgetMicros).toBe(usd('8'));expect(r.state.targets.t?.baseBidMicros).toBe(usd('.80'));expect(r.state.targets.t?.anchorBidMicros).toBe(usd('1'));
 expect(r.state.targets.t?.windowStartAt).toBe(c.state.targets.t?.windowStartAt);expect(r.notifications[0]?.type).toBe('DRIFT_DETECTED');
});
it('trust-engine writes Amazon back and leaves engine unchanged',async()=>{
 const c=fixture(),p=new InMemoryFakePort();await p.updateCampaign({...c.state.campaigns.c!,dailyBudgetMicros:usd('8')},'console');
 const r=await reconcile({...c,config:{...c.config,ambiguity:{...c.config.ambiguity,driftPolicy:'trust-engine'}},port:p,sent:new Map()});
 expect(r.state).toEqual(c.state);expect((await p.getCampaigns(['c']))[0]?.dailyBudgetMicros).toBe(usd('5'));
});
it('stale reads never undo a recently acknowledged bid and frozen run reads survive replay',async()=>{
 const c=fixture(),inner=new InMemoryFakePort(),clock=new SimClock(c.clock.now()),p=new FaultyFakePort(inner,clock,1,{staleReadMinutes:30});
 await inner.updateCampaign(c.state.campaigns.c!,'seed');await inner.updateTargets([{target:c.state.targetEntities.t!,bidMicros:usd('1')}],'/sp/keywords','seed');
 const before=await p.getCampaigns(['c'],'daily:before');
 await p.updateCampaign({...c.state.campaigns.c!,dailyBudgetMicros:usd('8')},'new');
 expect(await p.getCampaigns(['c'],'daily:before')).toEqual(before);
 await p.updateTargets([{target:c.state.targetEntities.t!,bidMicros:usd('.8')}],'/sp/keywords','new');
 const state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.8')}}};
 const r=await reconcile({...c,state,port:p,sent:new Map([['t',usd('.8')]]),acknowledgedAt:new Map([['target:t',c.clock.now()],['campaign:c',c.clock.now()]])});
 expect(r.state.targets.t?.baseBidMicros).toBe(usd('.8'));expect(r.notifications).toEqual([]);
});
it('PAUSED_AUTO requires actual console enable before R01 confirmation',async()=>{
 const c=fixture(),p=new InMemoryFakePort(),state={...c.state,campaigns:{c:{...c.state.campaigns.c!,status:'PAUSED' as const}},campaignMemory:{c:{...c.state.campaignMemory.c!,tag:'PAUSED_AUTO' as const,requiresUserConfirmToEnable:true}}};
 await p.updateCampaign(state.campaigns.c!,'seed');
 expect((await reconcile({...c,state,port:p,sent:new Map()})).manualReenabledCampaignIds).toEqual([]);
 await p.updateCampaign({...state.campaigns.c!,status:'ENABLED'},'console');
 expect((await reconcile({...c,state,runId:'new',port:p,sent:new Map()})).manualReenabledCampaignIds).toEqual(['c']);
});
it('placement-only ack protects stale ToS read independently of campaign ack',async()=>{
 const c=fixture(),inner=new InMemoryFakePort(),clock=new SimClock(c.clock.now());await inner.updateCampaign(c.state.campaigns.c!,'seed');const p=new FaultyFakePort(inner,clock,1,{staleReadMinutes:30});await p.updatePlacement('c',50,'placement');
 const state={...c.state,campaigns:{c:{...c.state.campaigns.c!,topOfSearchPct:50}}};const r=await reconcile({...c,state,port:p,sent:new Map(),acknowledgedAt:new Map([['placement:c',clock.now()]])});expect(r.state.campaigns.c?.topOfSearchPct).toBe(50);expect(r.notifications).toEqual([]);
});
it('trust-engine retries partial target repair and reports permanent failure',async()=>{
 const c=fixture(),p=new InMemoryFakePort();await p.updateCampaign(c.state.campaigns.c!,'seed');await p.updateTargets([{target:c.state.targetEntities.t!,bidMicros:usd('.8')}],'/sp/keywords','console');let calls=0;
 class Broken extends InMemoryFakePort {override getCampaigns=p.getCampaigns.bind(p);override listTargets=p.listTargets.bind(p);override async updateTargets(){calls++;return [{id:'t',ok:false,error:'TRANSIENT_ITEM_ERROR'}];}}
 const r=await reconcile({...c,port:new Broken(),config:{...c.config,ambiguity:{...c.config.ambiguity,driftPolicy:'trust-engine'}},sent:new Map([['t',usd('1')]])});expect(calls).toBe(4);expect(r.notifications.some(n=>n.type==='API_WRITE_FAILED')).toBe(true);
});
