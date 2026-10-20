import type { ObjectRef,RuleContext,RuleDefinition } from '../../engine/types.js';
import { searchWindow,query } from './shared.js';
import { normalizeText } from '../../api/tags.js';
import { createTargetMemory } from '../../domain/state.js';
import { micros,roundBidToCent } from '../../domain/money.js';
import { hash } from '../../domain/hash.js';
import { instant } from '../../time/clock.js';
import { ratio } from '../target/shared.js';
export function destination(r:ObjectRef,c:RuleContext){const src=c.state.campaigns[r.campaignId!]!;const chosen=c.harvestDestinations?.[src.id];return chosen?c.state.campaigns[chosen]:Object.values(c.state.campaigns).find(x=>x.asin===src.asin&&x.type==='MANUAL');}
export const diagnose:NonNullable<RuleDefinition['diagnose']>=(r,c)=>destination(r,c)?[]:['NO_DESTINATION'];
export const evaluate:RuleDefinition['evaluate']=(r,c)=>{
 if(instant(c.clock.now()).setZone(c.config.marketplace.zone).weekday!==7)return null;
 const src=c.state.targetEntities[r.sourceTargetId!];if(!src||!(src.kind==='AUTO'||(src.kind==='KEYWORD'&&['BROAD','PHRASE'].includes(src.matchType??'EXACT'))))return null;
 const d=destination(r,c);if(!d)return null;
 const q=query(r);if(Object.values(c.state.targetEntities).some(e=>e.campaignId===d.id&&e.kind==='KEYWORD'&&e.matchType==='EXACT'&&normalizeText(e.text)===q))return null;
 const w=searchWindow(r,c),t=c.thresholdsByCampaign[d.id]!,sourceT=c.thresholdsByCampaign[r.campaignId!]!;
 if(w.orders<2||!(ratio(w.acos)<=sourceT.T_ok)||w.clicks===0)return null;
 const bid=roundBidToCent(micros(Math.max(t.Bid_min,Math.min(t.Bid_max,Math.round(w.spendMicros/w.clicks))))),id=`harvest:${hash([d.id,q])}`;
 const entity={id,campaignId:d.id,adGroupId:`${d.id}:group`,kind:'KEYWORD' as const,matchType:'EXACT' as const,text:q,status:'ENABLED' as const,bidMicros:bid};
 return {proposedState:{...c.state,targetEntities:{...c.state.targetEntities,[id]:entity},targets:{...c.state.targets,[id]:createTargetMemory(bid,c.clock.now(),c.config)},pendingHarvests:[...(c.state.pendingHarvests??[]),{query:q,sourceCampaignId:r.campaignId!,sourceTargetId:src.id,destCampaignId:d.id,keywordId:id,createdAt:c.clock.now()}]}};
};
