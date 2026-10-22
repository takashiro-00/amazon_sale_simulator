import type { RuleDefinition } from '../../engine/types.js';
import { zero, targetWindow, floor, propose, until } from './shared.js';
import { micros } from '../../domain/money.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const id=r.id,m=c.state.targets[id]!,t=c.thresholds[id]!,w=targetWindow(id,c,14,true);
 if(!w.eligible||w.clicks<t.N2||!zero(id,c,w.orders,14,true)||m.baseBidMicros<=floor(id,c))return null;
 return propose(id,c,{baseBidMicros:micros(Math.max(floor(id,c),Math.round(m.baseBidMicros*.8))),wasteFlagUntil:until(14,c),r12Count:m.r12Count+1,r12LastAt:c.clock.now()});
};
