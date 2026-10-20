import { DEFAULT_CONFIG,type SimConfig } from '../../config/defaults.js';
import { attemptApi } from '../api/retry.js';
import { TransientServerError } from '../api/faultyPort.js';
import type { EngineState,NotificationLog } from '../engine/types.js';
import type { AmazonAdsPort } from '../api/port.js';
import { normalizeText } from '../api/tags.js';
import { calendarDaysBetween,toMarketplaceDate } from '../time/clock.js';
export async function verifyHarvests(state:EngineState,port:AmazonAdsPort,at:string,notify:(n:NotificationLog)=>void,config:SimConfig=DEFAULT_CONFIG,onWait?:(seconds:number)=>void):Promise<EngineState>{
 let next=state;
 for(const p of state.pendingHarvests??[]){
  if(calendarDaysBetween(toMarketplaceDate(p.createdAt),toMarketplaceDate(at))>7){
   notify({at,campaignId:p.sourceCampaignId,type:'R15_VERIFY_TIMEOUT',details:{...p}});
   next={...next,pendingHarvests:(next.pendingHarvests??[]).filter(x=>x!==p)};continue;
  }
  const failure=(error:string)=>notify({at,campaignId:p.sourceCampaignId,type:'API_WRITE_FAILED',details:{ruleId:'R15',phase:'verify',keywordId:p.keywordId,error}});
  const read=await attemptApi(()=>port.listKeywords(p.destCampaignId,`verify:${p.keywordId}:${at}`),config.api.maxAttempts);onWait?.(read.waitSeconds);if(!read.ok){failure(read.error);continue;}const list=read.value;
   if(!list.some(e=>e.id===p.keywordId&&e.matchType==='EXACT'&&normalizeText(e.text)===p.query))continue;
   const existing=next.negatives?.[p.sourceCampaignId]??[];
   const n={campaignId:p.sourceCampaignId,text:p.query,harvestKeywordId:p.keywordId,matchType:'NEGATIVE_EXACT' as const};
   if(!existing.some(x=>normalizeText(x.text)===p.query)){
    const write=await attemptApi(async()=>{const results=await port.createNegatives([n],`harvest-negative:${p.keywordId}:${p.sourceCampaignId}`);if(!results.every(x=>x.ok)){const error=results.find(x=>!x.ok)?.error;if(!error||/TRANSIENT/.test(error))throw new TransientServerError();throw new Error(error);}return results;},config.api.maxAttempts);onWait?.(write.waitSeconds);if(!write.ok){failure(write.error);continue;}
    next={...next,negatives:{...next.negatives,[p.sourceCampaignId]:[...existing,n]}};
   }
   next={...next,pendingHarvests:(next.pendingHarvests??[]).filter(x=>x!==p),verifiedHarvests:[...(next.verifiedHarvests??[]),p]};
 }
 return next;
}
