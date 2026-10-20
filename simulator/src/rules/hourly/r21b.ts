import type { RuleDefinition } from '../../engine/types.js';
import { outboundBid } from './analysis.js';
import { marketplaceHour } from '../../time/clock.js';
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 const e=c.state.targetEntities[r.id],m=c.state.targets[r.id];if(!e||!m||e.status!=='ENABLED'||!c.submittedBids||c.state.campaigns[e.campaignId]?.status!=='ENABLED')return null;
 const bid=outboundBid(m,marketplaceHour(c.clock.now(),c.config.marketplace),c.thresholds[r.id]!,c.state.campaigns[e.campaignId]!.topOfSearchPct,c.state.campaignMemory[e.campaignId]?.tag??'NORMAL');
 return c.submittedBids[r.id]===bid?null:{proposedState:c.state,outboundTargets:[{target:e,bidMicros:bid}]};
};
