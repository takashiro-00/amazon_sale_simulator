import type { RuleDefinition } from '../../engine/types.js';
import { targetWindow,floor,propose,ratio } from './shared.js';
import { micros } from '../../domain/money.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const m=c.state.targets[r.id]!,t=c.thresholds[r.id]!,w=targetWindow(r.id,c,30,true),a=ratio(w.acos);
 if(!w.eligible||w.clicks<c.config.thresholds.r10r11Clicks||w.orders<1||!(a>t.T_ok))return null;
 return propose(r.id,c,{baseBidMicros:micros(Math.max(floor(r.id,c),Math.round(m.baseBidMicros*Math.max(t.T_ok/a,.8))))});
};
