import type { EngineState,Decision } from '../engine/types.js';
import type { DerivedThresholds } from '../domain/params.js';
import type { SimConfig } from '../../config/defaults.js';
import { normalizeText } from '../api/tags.js';
import { outboundBid } from '../rules/hourly/analysis.js';
import type { Hour } from '../domain/entities.js';
export function assertTargetInvariants(state:EngineState,thresholds:Readonly<Record<string,DerivedThresholds>>,decisions:readonly Decision[],at:string,config:SimConfig){
 const keywords=new Set<string>(),negatives=new Set<string>(),writes=new Set<string>();
 for(const d of decisions){
  for(const id of d.baseBidTargetIds){const key=JSON.stringify([d.runId,id]);if(writes.has(key))throw new Error('MULTIPLE_BASE_WRITES');writes.add(key);}
  if(d.ruleId==='R14'){const m=d.before.targets[d.objectRef.id]!;if(m.wasteFlagUntil&&Date.parse(m.wasteFlagUntil)>Date.parse(d.before===state?at:d.runId.split('|')[0]!))throw new Error('WASTE_R14_INCREASE');}
 }
 for(const [id,e] of Object.entries(state.targetEntities)){
  const m=state.targets[id]!,t=thresholds[id];if(!m||!t)throw new Error('MISSING_TARGET_THRESHOLDS');
  if(m.tagReductionFactor<.70||m.tagReductionFactor>1)throw new Error('TAG_REDUCTION_RANGE');
  if(m.baseBidMicros<t.Bid_min||(e.status==='ENABLED'&&m.baseBidMicros>t.Bid_max))throw new Error('OUTBOUND_BID_RANGE');
  for(let i=0;i<24;i++){const tos=state.campaigns[e.campaignId]!.topOfSearchPct,bid=outboundBid(m,i as Hour,t,tos,state.campaignMemory[e.campaignId]?.tag??'NORMAL');if(bid<t.Bid_min||bid>t.Bid_max)throw new Error('OUTBOUND_BID_RANGE');if(bid*(1+tos/100)>1.5*t.Bid_max+1e-6)throw new Error('OUTBOUND_TOS_CAP');}
  if(e.kind==='KEYWORD'){const key=JSON.stringify([e.campaignId,e.matchType,normalizeText(e.text)]);if(keywords.has(key))throw new Error('DUPLICATE_KEYWORD');keywords.add(key);}
 }
 for(const [cid,list] of Object.entries(state.negatives??{}))for(const n of list){const q=normalizeText(n.text),key=JSON.stringify([cid,q]);if(n.harvestKeywordId&&!(state.verifiedHarvests??[]).some(p=>p.keywordId===n.harvestKeywordId&&p.sourceCampaignId===cid&&p.query===q))throw new Error('UNVERIFIED_HARVEST_NEGATIVE');if(negatives.has(key))throw new Error('DUPLICATE_NEGATIVE');negatives.add(key);
  if((state.pendingHarvests??[]).some(p=>p.sourceCampaignId===cid&&p.query===q)&&!(state.verifiedHarvests??[]).some(p=>p.sourceCampaignId===cid&&p.query===q))throw new Error('UNVERIFIED_HARVEST_NEGATIVE');
 }
}
