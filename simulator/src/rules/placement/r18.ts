import type { RuleDefinition } from '../../engine/types.js';
import { placementWindow,propose,capAllows } from './shared.js';
import { ratio } from '../target/shared.js';
export const diagnose:NonNullable<RuleDefinition['diagnose']>=(r,c)=>capAllows(r.id,c,Math.min(100,c.state.campaigns[r.id]!.topOfSearchPct+10))?[]:['TOS_CAP'];
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const w=placementWindow(r.id,c),t=c.thresholdsByCampaign[r.id]!,pct=c.state.campaigns[r.id]!.topOfSearchPct;
 const compare=w.rest.clicks>=30?w.rest:w.all;
 const cv=compare.clicks?compare.orders/compare.clicks:0;
 if(!w.eligible||pct>=100||w.top.clicks<30||w.top.orders<3||w.top.orders/w.top.clicks<2*cv||!(ratio(w.top.acos)<=t.T_win)||!capAllows(r.id,c,Math.min(100,pct+10)))return null;
 return propose(r.id,c,Math.min(100,pct+10));
};
