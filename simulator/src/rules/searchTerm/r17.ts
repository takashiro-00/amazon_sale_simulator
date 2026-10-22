import type { RuleDefinition } from '../../engine/types.js';
import { zero, searchWindow,negative,negativeExists,exactExists,query } from './shared.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 if(negativeExists(r,c)||exactExists(r,c))return null;
 const w=searchWindow(r,c),t=c.thresholdsByCampaign[r.campaignId!]!;
 return w.clicks>=t.N17&&w.spendMicros>=2.5*t.CPA_target&&zero(r,c,w.orders)?negative(r,c):null;
};
