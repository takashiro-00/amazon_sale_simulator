import type { RuleDefinition } from '../../engine/types.js';
import { targetWindow,propose,active,age,until } from './shared.js';
import { micros,usd } from '../../domain/money.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const m=c.state.targets[r.id]!,t=c.thresholds[r.id]!,w=targetWindow(r.id,c,7,false,7);
 // SPEC-AMBIGUITY: Expired low-impression flags restart the three-attempt cycle when configured.
 const count=c.config.ambiguity.r14CountResetAfterFlag&&m.lowImpressionFlagUntil&&!active(m.lowImpressionFlagUntil,c)?0:m.r14Count;
 if(active(m.wasteFlagUntil,c)||active(m.lowImpressionFlagUntil,c)||!w.eligible||!w.complete||w.impressions>=100||m.baseBidMicros>=Math.min(usd('.75'),t.Bid_max)||
 (w.clicks>=t.N2h&&w.orders===0)||count>=3||(m.r14LastAt&&age(m.r14LastAt,c)<7))return null;
 return propose(r.id,c,{baseBidMicros:micros(Math.round(m.baseBidMicros*1.15)),r14Count:count+1,r14LastAt:c.clock.now(),...(count===0?{lowImpressionFlagUntil:null}:{}),...(count===2?{lowImpressionFlagUntil:until(30,c)}:{})});
};
