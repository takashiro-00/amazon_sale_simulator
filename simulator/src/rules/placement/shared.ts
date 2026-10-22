import type { RuleContext, Proposal } from '../../engine/types.js';
import { resolveWindow } from '../../data/windows.js';
export function placementWindow(id:string,c:RuleContext){
 const m=c.state.campaignMemory[id]!;
 // SPEC-AMBIGUITY: Placement uses its own post-change origin, capped at 14 days with seven ripe days.
 const spec=c.config.ambiguity.placementWindow==='post14-min7'?{kind:'post' as const,days:14,minRipeDays:7}:null;
 const w=resolveWindow(spec!,c.today,{windowStartAt:m.lastChangeAt.placement??m.createdAt},c.config);
 const facts=c.metrics.granular(id,w.from,w.to);
 return {eligible:w.eligible,top:c.metrics.aggregate(facts.filter(f=>f.hour===undefined&&f.placement==='TOP')),rest:c.metrics.aggregate(facts.filter(f=>f.hour===undefined&&f.placement==='REST_OF_SEARCH')),all:c.metrics.campaignWindow(id,w)};
}
export function propose(id:string,c:RuleContext,pct:number):Proposal{return {proposedState:{...c.state,campaigns:{...c.state.campaigns,[id]:{...c.state.campaigns[id]!,topOfSearchPct:pct}},campaignMemory:{...c.state.campaignMemory,[id]:{...c.state.campaignMemory[id]!,tosBoostPct:pct}}}};}
export function capAllows(id:string,c:RuleContext,pct:number){return Object.entries(c.state.targetEntities).filter(([,e])=>e.campaignId===id&&e.status==='ENABLED').every(([tid])=>{
 const m=c.state.targets[tid]!,t=c.thresholds[tid]??c.thresholdsByCampaign[id]!;
 const h=c.config.ambiguity.tosCapIncludesHourly?Math.max(...Object.values(m.hourlyFactor)):1;
 return m.baseBidMicros*h*(1+pct/100)<=c.config.bid.tosCap*t.Bid_max;
});}
