import type { RuleDefinition } from '../../engine/types.js';
import { toMarketplaceDate,dMinus } from '../../time/clock.js';
import { zero, targetWindow, floor } from './shared.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const id=r.id,m=c.state.targets[id]!,t=c.thresholds[id]!,w=targetWindow(id,c,14);
 const primary=c.metrics.recordedReads.at(-1)!;
 const since=m.r12LastAt?c.metrics.aggregate(c.metrics.facts(id,toMarketplaceDate(m.r12LastAt,c.config.marketplace),dMinus(c.today,c.config.maturityLagDays))):null;
 const sinceRead=m.r12LastAt?c.metrics.recordedReads.at(-1):undefined,guardStart=c.metrics.recordedReads.length;
 if(w.clicks<t.N3||w.orders!==0||w.spendMicros<2*t.CPA_target||!(c.config.v32.zeroOrderLagDays===2?c.metrics.zeroOrdersRobust(id,c.today):zero(id,c,w.orders,14))||
   !(m.baseBidMicros<=floor(id,c)||(m.r12Count>=1&&since&&since.clicks>=t.N2h&&(c.config.v32.zeroOrderLagDays===2?since.orders===0:zero(id,c,since.orders,30,true,m.r12LastAt!)))))return null;
 c.metrics.zeroOrderEvidence.push(primary);
 if(c.config.v32.zeroOrderLagDays===2){c.metrics.zeroOrderEvidence.push(...c.metrics.recordedReads.slice(guardStart));if(m.baseBidMicros>floor(id,c)&&sinceRead)c.metrics.zeroOrderEvidence.push(sinceRead);}
 const e=c.state.targetEntities[id]!;
 return {proposedState:{...c.state,targetEntities:{...c.state.targetEntities,[id]:{...e,status:'PAUSED'}}},notifications:[{at:c.clock.now(),campaignId:e.campaignId,type:'R13_PAUSED',details:{targetId:id}}]};
};
