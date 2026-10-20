import type { EngineState,NotificationLog } from '../engine/types.js';
import type { AmazonAdsPort } from '../api/port.js';
import { normalizeText } from '../api/tags.js';
import { calendarDaysBetween,toMarketplaceDate } from '../time/clock.js';
export async function verifyHarvests(state:EngineState,port:AmazonAdsPort,at:string,notify:(n:NotificationLog)=>void):Promise<EngineState>{
 let next=state;
 for(const p of state.pendingHarvests??[]){
  if(calendarDaysBetween(toMarketplaceDate(p.createdAt),toMarketplaceDate(at))>7){
   notify({at,campaignId:p.sourceCampaignId,type:'R15_VERIFY_TIMEOUT',details:{...p}});
   next={...next,pendingHarvests:(next.pendingHarvests??[]).filter(x=>x!==p)};continue;
  }
  try{
   const list=await port.listKeywords(p.destCampaignId,`verify:${p.keywordId}:${at}`);
   if(!list.some(e=>e.id===p.keywordId&&e.matchType==='EXACT'&&normalizeText(e.text)===p.query))continue;
   const existing=next.negatives?.[p.sourceCampaignId]??[];
   const n={campaignId:p.sourceCampaignId,text:p.query,harvestKeywordId:p.keywordId,matchType:'NEGATIVE_EXACT' as const};
   if(!existing.some(x=>normalizeText(x.text)===p.query)){
    const results=await port.createNegatives([n],`harvest-negative:${p.keywordId}:${p.sourceCampaignId}`);if(!results.every(x=>x.ok))continue;
    next={...next,negatives:{...next.negatives,[p.sourceCampaignId]:[...existing,n]}};
   }
   next={...next,pendingHarvests:(next.pendingHarvests??[]).filter(x=>x!==p),verifiedHarvests:[...(next.verifiedHarvests??[]),p]};
  }catch(error){if(!(error instanceof Error)||!/^429|^500/.test(error.message))throw error;}
 }
 return next;
}
