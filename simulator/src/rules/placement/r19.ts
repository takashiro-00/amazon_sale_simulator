import type { RuleDefinition } from '../../engine/types.js';
import { placementWindow,propose } from './shared.js';
import { ratio } from '../target/shared.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const w=placementWindow(r.id,c),t=c.thresholdsByCampaign[r.id]!,pct=c.state.campaigns[r.id]!.topOfSearchPct;
 if(!w.eligible||pct<=0||w.top.clicks<20||!(ratio(w.top.acos)>t.T_bad)||w.top.spendMicros<2*t.CPA_target)return null;
 return propose(r.id,c,Math.max(0,pct-20));
};
