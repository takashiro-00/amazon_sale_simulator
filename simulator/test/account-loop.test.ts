import { it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario/schema.js';
import { runAccountLoop } from '../src/runner/campaignLoop.js';
import { ScriptedMarket } from '../src/market/scripted.js';
import { assertTargetInvariants } from '../src/invariants/target.js';
import { fixture } from './step4-fixture.js';
import { usd } from '../src/domain/money.js';
it('golden zero-order target: day 5 R12, day 7 R13 with hand-computed samples',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/zero-order.json','utf8')));s.days=12;const campaign=s.campaigns[0]!,t=campaign.targets[0]!;campaign.type='MANUAL';t.kind='KEYWORD';t.matchType='EXACT';t.bid=.8;t.text='bleeder';campaign.targets=[t,{...t,id:'winner',text:'winner',trueCvr:.3}];s.products[0]!.priceUsd=30;s.products[0]!.breakEvenAcos=.4;
 // days 0..3: 5 clicks x $.56 = $2.80/day. day 4: zero. day 5: 10 clicks/$5.60.
 // D5 sees D0..D3: 20/$11.20; D7 sees through D5: 30/$16.80 and 10 clicks since R12.
 const market=new ScriptedMarket(s,({day})=>{const clicks=day<=3?5:day===5?10:0;return {clicks:0,orders:0,spendUsd:0,salesUsd:0,targets:{[t.id]:{clicks,spendUsd:clicks*.56,orders:0,salesUsd:0,impressions:100},winner:{clicks:5,spendUsd:1,orders:1,salesUsd:30,impressions:100}}};});
 const r=await runAccountLoop({scriptedMarket:market});
 expect(r.timeline.filter(x=>x.targetId===t.id).map(x=>[x.day,x.ruleId])).toEqual([[5,'R12'],[7,'R13']]);expect(r.state.targetEntities[t.id]?.status).toBe('PAUSED');
});
it('target invariant checks every hourly bid and normalized duplicates',()=>{const c=fixture();expect(()=>assertTargetInvariants(c.state,c.thresholds,c.decisions,c.clock.now(),c.config)).not.toThrow();const state={...c.state,targets:{t:{...c.state.targets.t!,baseBidMicros:usd('.10')}}};expect(()=>assertTargetInvariants(state,c.thresholds,[],c.clock.now(),c.config)).toThrow('OUTBOUND_BID_RANGE');});
it('C4 product price drop below half anchor uses G6 and never sends outside new hard bounds',async()=>{
 const s=validateScenario(JSON.parse(readFileSync('scenarios/zero-order.json','utf8')));s.days=8;s.events=[{type:'priceChange',asin:s.products[0]!.asin,at:'2026-10-05T07:00Z',priceUsd:5}];
 const market=new ScriptedMarket(s,()=>({clicks:1,spendUsd:.2,orders:1,salesUsd:30}));const r=await runAccountLoop({scriptedMarket:market});
 expect(r.notifications.some(n=>n.type==='EMPTY_BID_RANGE')).toBe(true);expect(r.state.targets[s.campaigns[0]!.targets[0]!.id]?.baseBidMicros).toBe(usd('.20'));
 expect(r.decisions.some(d=>d.reasons?.includes('PARAMS_HARD_LIMIT'))).toBe(true);
});
it('manual bid edits go through console reconciliation and emit drift',async()=>{const s=validateScenario(JSON.parse(readFileSync('scenarios/zero-order.json','utf8')));s.days=4;const id=s.campaigns[0]!.targets[0]!.id;s.events=[{type:'manualEdit',at:'2026-10-02T08:00Z',entityId:id,field:'bid',value:.6}];const r=await runAccountLoop({scriptedMarket:new ScriptedMarket(s,()=>({clicks:0,spendUsd:0,orders:0,salesUsd:0}))});expect(r.notifications.some(n=>n.type==='DRIFT_DETECTED'&&n.details.targetId===id)).toBe(true);});
