import type { AmazonAdsPort } from '../api/port.js';
import { RateLimitError,TransientServerError } from '../api/faultyPort.js';
import type { Decision,EngineState } from '../engine/types.js';
import type { SimConfig } from '../../config/defaults.js';
import type { DerivedThresholds } from '../domain/params.js';
import type { Hour } from '../domain/entities.js';
import { stateEqual } from '../engine/priority.js';
import { normalizeText } from '../api/tags.js';
import { outboundBid } from '../rules/hourly/analysis.js';
import { isApiError,isTransientApiError } from '../api/retry.js';
export { isApiError } from '../api/retry.js';
export interface WriteOperation { kind:'updateCampaign'|'updatePlacement'|'updateTargets'|'createKeywords'|'createNegatives'; entity:string; key:string; apply:(port:AmazonAdsPort)=>Promise<boolean>; }
export interface WritePlan { decision:Decision; operations:readonly WriteOperation[]; }
export interface ExecuteOptions { port:AmazonAdsPort; config:SimConfig; hour:Hour; thresholds:Readonly<Record<string,DerivedThresholds>>; sent?:Map<string,number>; }
/** One target per operation makes partial retries preserve the entity's stable key. */
export function createWritePlan(d:Decision,o:ExecuteOptions):WritePlan {
 const operations:WriteOperation[]=[],root=`${d.runId}:${d.objectRef.id}:${d.ruleId}`;
 for(const [id,c] of Object.entries(d.after.campaigns)){
  const old=d.before.campaigns[id]!;
  if(!stateEqual({...old,topOfSearchPct:c.topOfSearchPct},c))operations.push({kind:'updateCampaign',entity:`campaign:${id}`,key:`${root}:campaign:${id}`,apply:async p=>{await p.updateCampaign({...c,topOfSearchPct:old.topOfSearchPct},`${root}:campaign:${id}`);return true;}});
  if(old.topOfSearchPct!==c.topOfSearchPct)operations.push({kind:'updatePlacement',entity:`placement:${id}`,key:`${root}:placement:${id}`,apply:async p=>{await p.updatePlacement(id,c.topOfSearchPct,`${root}:placement:${id}`);return true;}});
 }
 for(const [id,e] of Object.entries(d.after.targetEntities)){
  const created=!d.before.targetEntities[id];
  if(!created&&!d.baseBidTargetIds.includes(id)&&e.status===d.before.targetEntities[id]!.status)continue;
  const bid=created?d.after.targets[id]!.baseBidMicros:outboundBid(d.after.targets[id]!,o.hour,o.thresholds[id]!,Math.max(d.before.campaigns[e.campaignId]?.topOfSearchPct??0,d.after.campaigns[e.campaignId]!.topOfSearchPct),d.after.campaignMemory[e.campaignId]?.tag??'NORMAL');
  const key=`${root}:target:${id}`;
  operations.push({kind:created?'createKeywords':'updateTargets',entity:`target:${id}`,key,apply:async p=>{
   const r=created?await p.createKeywords([{...e,bidMicros:bid}],key):await p.updateTargets([{target:e,bidMicros:bid}],e.kind==='KEYWORD'?'/sp/keywords':'/sp/targets',key);
   const result=r.find(x=>x.id===id);if(!result?.ok){if(result?.error&&!/TRANSIENT|429|5\d\d/.test(result.error))throw new Error(result.error);return false;}
   o.sent?.set(id,bid);return true;
  }});
 }
 for(const [id,list] of Object.entries(d.after.negatives??{}))for(const n of list){
  if((d.before.negatives?.[id]??[]).some(x=>normalizeText(x.text)===normalizeText(n.text)))continue;
  const entity=`negative:${id}:${normalizeText(n.text)}`,key=`${root}:${entity}`;
  operations.push({kind:'createNegatives',entity,key,apply:async p=>{const r=await p.createNegatives([n],key);if(r[0]?.error&&!/TRANSIENT|429|5\d\d/.test(r[0].error))throw new Error(r[0].error);return !!r[0]?.ok;}});
 }
 return {decision:d,operations};
}
export async function executeDecision(d:Decision,o:ExecuteOptions){
 const plan=createWritePlan(d,o),acked=new Set<string>(),failures:{entity:string;error:string}[]=[];let waitSeconds=0;
 for(const op of plan.operations){
  for(let attempt=1;attempt<=o.config.api.maxAttempts;attempt++){
   try{if(await op.apply(o.port)){acked.add(op.entity);break;}if(attempt===o.config.api.maxAttempts)failures.push({entity:op.entity,error:'TRANSIENT_ITEM_ERROR'});}
   catch(e){if(!isApiError(e))throw e;if(e instanceof RateLimitError)waitSeconds+=e.retryAfterSeconds;
    if(!isTransientApiError(e)||attempt===o.config.api.maxAttempts){failures.push({entity:op.entity,error:String(e)});break;}
   }
  }
 }
 let state:EngineState=d.after;
 if(failures.length){
  const campaigns={...d.after.campaigns},campaignMemory={...d.after.campaignMemory},targets={...d.after.targets},targetEntities={...d.after.targetEntities},negatives={...d.after.negatives};
  for(const {entity} of failures){
   if(entity.startsWith('campaign:')){const id=entity.slice(9);campaigns[id]={...d.before.campaigns[id]!,topOfSearchPct:acked.has(`placement:${id}`)?d.after.campaigns[id]!.topOfSearchPct:d.before.campaigns[id]!.topOfSearchPct};if(d.before.campaignMemory[id])campaignMemory[id]=d.before.campaignMemory[id]!;else delete campaignMemory[id];const old=d.before.campaignMemory[id],next=d.after.campaignMemory[id];if(old&&next&&acked.has(`placement:${id}`))campaignMemory[id]={...old,cooldownUntil:{...old.cooldownUntil,placement:next.cooldownUntil.placement},lastChangeAt:{...old.lastChangeAt,placement:next.lastChangeAt.placement},windowStartAt:next.windowStartAt,tosBoostPct:next.tosBoostPct};}
   if(entity.startsWith('placement:')){const id=entity.slice(10);campaigns[id]={...campaigns[id]!,topOfSearchPct:d.before.campaigns[id]!.topOfSearchPct};const old=d.before.campaignMemory[id],m=campaignMemory[id];if(old&&m)campaignMemory[id]={...m,cooldownUntil:{...m.cooldownUntil,placement:old.cooldownUntil.placement},lastChangeAt:{...m.lastChangeAt,placement:old.lastChangeAt.placement},windowStartAt:old.windowStartAt,tosBoostPct:old.tosBoostPct};}
   if(entity.startsWith('target:')){const id=entity.slice(7);if(d.before.targets[id]){targets[id]=d.before.targets[id]!;targetEntities[id]=d.before.targetEntities[id]!;}else{delete targets[id];delete targetEntities[id];}}
   if(entity.startsWith('negative:'))for(const [id,list] of Object.entries(negatives))negatives[id]=list.filter(n=>`negative:${id}:${normalizeText(n.text)}`!==entity);
  }
  for(const [id,m] of Object.entries(campaignMemory))if(m.tag==='NORMAL'&&d.ruleId==='R09')campaignMemory[id]={...m,bidRestorePending:Object.entries(targets).some(([tid,t])=>targetEntities[tid]?.campaignId===id&&t.tagReductionFactor<1)};
  state={...d.after,campaigns,campaignMemory,targets,targetEntities,negatives,pendingHarvests:(d.after.pendingHarvests??[]).filter(p=>targetEntities[p.keywordId])};
 }
 return {state,plan,acked:[...acked],failures,waitSeconds,outcome:failures.length?(acked.size?'PARTIAL_APPLY' as const:'APPLY_FAILED' as const):'APPLIED' as const};
}
