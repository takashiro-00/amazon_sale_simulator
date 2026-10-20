import type { RuleContext,EngineState,NotificationLog } from '../engine/types.js';
import type { AmazonAdsPort } from '../api/port.js';
import { RateLimitError,TransientServerError } from '../api/faultyPort.js';
import { currentTag,applyTag } from '../api/tags.js';
import { micros } from '../domain/money.js';
import { marketplaceHour } from '../time/clock.js';
import { attemptApi,retryBatch } from '../api/retry.js';
export interface ReconcileInput extends Pick<RuleContext,'state'|'clock'|'config'|'runId'> { port:AmazonAdsPort; sent:Map<string,number>; acknowledgedAt?:ReadonlyMap<string,string>; }
export async function reconcile(i:ReconcileInput){
 let state=i.state;const notifications:NotificationLog[]=[],manualReenabledCampaignIds:string[]=[],now=i.clock.now(),key=`daily:${i.runId}`;
 const fresh=(entity:string)=>i.config.ambiguity.staleReadPolicy==='acknowledged-write-grace'&&Date.parse(now)-Date.parse(i.acknowledgedAt?.get(entity)??'1900-01-01')<i.config.api.staleReadGraceMinutes*60000;
 let waitSeconds=0;const acknowledgedAt=new Map(i.acknowledgedAt);
 const attempt=async<T>(fn:()=>Promise<T>,campaignId='account'):Promise<T|undefined>=>{const r=await attemptApi(fn,i.config.api.maxAttempts);waitSeconds+=r.waitSeconds;if(!r.ok){notifications.push({at:now,campaignId,type:'API_WRITE_FAILED',details:{phase:'reconcile',error:r.error}});return undefined;}return r.value;};
 const campaigns=await attempt(()=>i.port.getCampaigns(Object.keys(state.campaigns).sort(),key));
 for(let remote of campaigns??[]){
  const old=state.campaigns[remote.id]!,m=state.campaignMemory[remote.id],fields:string[]=[];
  if(fresh(`placement:${old.id}`))remote={...remote,topOfSearchPct:old.topOfSearchPct};
  for(const field of ['dailyBudgetMicros','status','name','topOfSearchPct'] as const)if(remote[field]!==old[field])fields.push(field);
  if(!fields.length||fresh(`campaign:${old.id}`))continue;
  if(i.config.ambiguity.driftPolicy==='trust-engine')await attempt(()=>i.port.updateCampaign(old,`reconcile:${i.runId}:campaign:${old.id}`));
  else{
   const tag=currentTag(remote.name),tier=i.config.budgetLadder.indexOf(remote.dailyBudgetMicros);
   // SPEC-AMBIGUITY: Off-ladder console budgets are normalized to the closest configured tier to preserve G7.
   const budgetTierIndex=tier>=0?tier:i.config.budgetLadder.reduce((best,v,n)=>Math.abs(v-remote.dailyBudgetMicros)<Math.abs(i.config.budgetLadder[best]!-remote.dailyBudgetMicros)?n:best,0);
   if(m?.tag==='PAUSED_AUTO'&&remote.status==='ENABLED')manualReenabledCampaignIds.push(old.id);
   const nextTag=m?.tag==='PAUSED_AUTO'&&!manualReenabledCampaignIds.includes(old.id)?'PAUSED_AUTO':tag;
   state={...state,campaigns:{...state.campaigns,[old.id]:{...remote,name:applyTag(remote.name,nextTag==='PAUSED_AUTO'?'NORMAL':nextTag),dailyBudgetMicros:i.config.budgetLadder[budgetTierIndex]!}},campaignMemory:m?{...state.campaignMemory,[old.id]:{...m,tag:nextTag,budgetTierIndex,preTagTierIndex:['MANAGE','ALERT'].includes(nextTag)?m.preTagTierIndex??m.budgetTierIndex:null,r06bPhase:nextTag==='NORMAL'?'NONE':m.r06bPhase}}:state.campaignMemory};
  }
  notifications.push({at:now,campaignId:old.id,type:'DRIFT_DETECTED',details:{fields,policy:i.config.ambiguity.driftPolicy}});
 }
 for(const cid of Object.keys(state.campaigns).sort()){
  const targets=await attempt(()=>i.port.listTargets(cid,`${key}:${cid}`));
  for(const remote of targets??[]){
   const e=state.targetEntities[remote.id],m=state.targets[remote.id];if(!e||!m)continue;
   const fields:string[]=[];const expected=i.sent.get(remote.id)??m.baseBidMicros;
   if(remote.bidMicros!==expected)fields.push('bidMicros');if(remote.status!==e.status)fields.push('status');
   if(!fields.length||fresh(`target:${e.id}`))continue;
   if(i.config.ambiguity.driftPolicy==='trust-engine'){const r=await retryBatch([{target:e,bidMicros:micros(expected)}],u=>u.target.id,pending=>i.port.updateTargets(pending,e.kind==='KEYWORD'?'/sp/keywords':'/sp/targets',`reconcile:${i.runId}:target:${e.id}`),i.config.api.maxAttempts);waitSeconds+=r.waitSeconds;if(r.failures.length)notifications.push({at:now,campaignId:cid,type:'API_WRITE_FAILED',details:{phase:'reconcile',targetId:e.id}});else acknowledgedAt.set(`target:${e.id}`,now);}
   else {const factor=state.campaignMemory[cid]?.tag==='NORMAL'?m.hourlyFactor[marketplaceHour(now,i.config.marketplace)]:Math.min(1,m.hourlyFactor[marketplaceHour(now,i.config.marketplace)]);
    state={...state,targetEntities:{...state.targetEntities,[e.id]:{...e,status:remote.status}},targets:{...state.targets,[e.id]:{...m,...(fields.includes('bidMicros')?{baseBidMicros:micros(Math.round(remote.bidMicros/factor))}:{})}}};i.sent.set(e.id,remote.bidMicros);
   }
   notifications.push({at:now,campaignId:cid,type:'DRIFT_DETECTED',details:{targetId:e.id,fields,policy:i.config.ambiguity.driftPolicy}});
  }
 }
 return {state,notifications,manualReenabledCampaignIds,waitSeconds,acknowledgedAt};
}
