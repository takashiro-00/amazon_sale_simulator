import type { RuleDefinition } from '../../engine/types.js';
import { targetWindow,propose,ratio } from './shared.js';
import { micros } from '../../domain/money.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const m=c.state.targets[r.id]!,t=c.thresholds[r.id]!,w=targetWindow(r.id,c,14),p=targetWindow(r.id,c,30,true,3);
 if(w.orders<3||!(ratio(w.acos)<=t.T_win)||!p.eligible||p.clicks<c.config.thresholds.r10r11Clicks||!(ratio(p.acos)<=t.T_win))return null;
 const bid=micros(Math.min(t.Bid_max,2*m.anchorBidMicros,Math.round(m.baseBidMicros*1.1)));
 return bid>m.baseBidMicros?propose(r.id,c,{baseBidMicros:bid}):null;
};
