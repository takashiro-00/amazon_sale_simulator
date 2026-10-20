import type { RuleDefinition } from '../../engine/types.js';
import { toMarketplaceDate,dMinus } from '../../time/clock.js';
import { targetWindow, floor } from './shared.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const id=r.id,m=c.state.targets[id]!,t=c.thresholds[id]!,w=targetWindow(id,c,14);
 const since=m.r12LastAt?c.metrics.aggregate(c.metrics.facts(id,toMarketplaceDate(m.r12LastAt,c.config.marketplace),dMinus(c.today,c.config.maturityLagDays))):null;
 if(w.clicks<t.N3||w.orders!==0||w.spendMicros<2*t.CPA_target||!c.metrics.zeroOrdersRobust(id,c.today)||
   !(m.baseBidMicros<=floor(id,c)||(m.r12Count>=1&&since&&since.clicks>=t.N2h&&since.orders===0)))return null;
 const e=c.state.targetEntities[id]!;
 return {proposedState:{...c.state,targetEntities:{...c.state.targetEntities,[id]:{...e,status:'PAUSED'}}},notifications:[{at:c.clock.now(),campaignId:e.campaignId,type:'R13_PAUSED',details:{targetId:id}}]};
};
