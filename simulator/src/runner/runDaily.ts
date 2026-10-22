import type { EngineState,Decision,NotificationLog,ObjectRef,RuleId,RuleContext } from '../engine/types.js';
import type { SimConfig } from '../../config/defaults.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import type { AmazonAdsPort } from '../api/port.js';
import type { Clock } from '../time/clock.js';
import { toMarketplaceDate,marketplaceHour } from '../time/clock.js';
import type { DerivedThresholds } from '../domain/params.js';
import { FactIndex,type MetricFact } from '../data/facts.js';
import { MetricsReader } from '../data/metrics.js';
import { AuditLog,configHash,stateDiff } from '../audit/log.js';
import { firstMatchWins,CAMPAIGN,PLACEMENT,TARGET,SEARCHTERM } from '../engine/priority.js';
import { registry } from '../rules/registry.js';
import { trackR09 } from '../rules/campaign/r09Tracker.js';
import { analyzeHours,type HourlyAnalysisRecord } from '../rules/hourly/analysis.js';
import { verifyHarvests } from './harvest.js';
import { executeDecision } from './executor.js';
import { reconcile } from './reconcile.js';
import { assertCampaignInvariants } from '../invariants/campaign.js';
import { assertTargetInvariants } from '../invariants/target.js';
export interface DailyInput {
 state:EngineState;port:AmazonAdsPort;clock:Clock;facts:readonly MetricFact[]|FactIndex;
 thresholds:Readonly<Record<string,DerivedThresholds>>;thresholdsByCampaign:Readonly<Record<string,DerivedThresholds>>;
 config?:SimConfig; submittedBids?:Readonly<Record<string,number>>;acknowledgedAt?:Readonly<Record<string,string>>;
 queries?:Readonly<Record<string,readonly string[]>>;harvestDestinations?:Readonly<Record<string,string>>;
}
/** Data in/data out. All scheduling uses the supplied clock and marketplace, never host TZ. */
export async function runDaily(i:DailyInput){
 const hourlyAnalyses:HourlyAnalysisRecord[]=[];
 const config=i.config??DEFAULT_CONFIG,at=i.clock.now(),today=toMarketplaceDate(at,config.marketplace),runId=`${at}|account`,hour=marketplaceHour(at,config.marketplace),audit=new AuditLog(),decisions:Decision[]=[],notifications:NotificationLog[]=[],sent=new Map(Object.entries(i.submittedBids??Object.fromEntries(Object.entries(i.state.targets).map(([id,m])=>[id,m.baseBidMicros])))),ackedAt=new Map(Object.entries(i.acknowledgedAt??{}));let state=i.state,waitSeconds=0;
 const reconciled=await reconcile({state,config,clock:i.clock,runId,port:i.port,sent,acknowledgedAt:ackedAt});state=reconciled.state;waitSeconds+=reconciled.waitSeconds;for(const [entity,time] of reconciled.acknowledgedAt)ackedAt.set(entity,time);notifications.push(...reconciled.notifications);
 const metrics=new MetricsReader(i.facts instanceof FactIndex?i.facts:new FactIndex(i.facts),at,config);
 const ctx=():RuleContext=>({state,config,clock:i.clock,today,runId,metrics,audit,decisions,thresholds:i.thresholds,thresholdsByCampaign:i.thresholdsByCampaign,paramsVersion:Object.values(i.thresholdsByCampaign).map(t=>t.paramsVersion).join(':'),notify:n=>notifications.push(n),manualReenabledCampaignIds:reconciled.manualReenabledCampaignIds,...(i.harvestDestinations?{harvestDestinations:i.harvestDestinations}:{})});
 const dispatch=async(ref:ObjectRef,ids:readonly RuleId[])=>{
  const notificationStart=notifications.length,d=firstMatchWins(ref,ids.map(id=>registry.find(r=>r.id===id)!),ctx());if(!d)return;
  const r=await executeDecision(d,{port:i.port,config,hour,thresholds:i.thresholds,sent});state=r.state;waitSeconds+=r.waitSeconds;
  for(const entity of r.acked)ackedAt.set(entity,at);
  if(r.failures.length){
   notifications.splice(notificationStart);notifications.push({at,campaignId:ref.campaignId??ref.id,type:'API_WRITE_FAILED',details:{ruleId:d.ruleId,failures:r.failures,waitSeconds:r.waitSeconds}});
   audit.append({runId,at,marketplaceDate:today,objectRef:ref,ruleId:d.ruleId,outcome:r.outcome==='PARTIAL_APPLY'?'PARTIAL_APPLY':'APPLY_FAILED',reasons:[...(d.ruleId==='R15'?['CREATE_FAILED']:[]),...r.failures.map(f=>`${f.entity}:${f.error}`)],inputsSnapshot:{asOf:metrics.asOf,paramsVersion:d.paramsVersion,configHash:configHash(config),now:at},...stateDiff(d.before,state),paramsVersion:d.paramsVersion});
   const index=decisions.indexOf(d);decisions.splice(index,1);
   if(r.acked.length){const applied={...d,after:state,baseBidTargetIds:d.baseBidTargetIds.filter(id=>state.targets[id]?.baseBidMicros!==d.before.targets[id]?.baseBidMicros)};if(d.zeroOrderWindows)Object.defineProperty(applied,"zeroOrderWindows",{value:d.zeroOrderWindows,enumerable:false});if(d.measurementReads)Object.defineProperty(applied,"measurementReads",{value:d.measurementReads,enumerable:false});decisions.push(applied);}
  }
 };
 const ids=Object.keys(state.campaigns).sort();
 for(const id of ids)if(state.campaigns[id]!.status==='ENABLED'&&(!state.campaignMemory[id]||reconciled.manualReenabledCampaignIds.includes(id)))await dispatch({group:'CAMPAIGN',id},['R01']);
 for(const id of ids){const m=state.campaignMemory[id];if(m){const history={...m.budgetByDate,[today]:state.campaigns[id]!.dailyBudgetMicros};state={...state,campaignMemory:{...state.campaignMemory,[id]:{...m,budgetByDate:Object.fromEntries(Object.entries(history).sort(([a],[b])=>a.localeCompare(b)).slice(-35))}}};}}
 for(const id of ids)if(state.campaignMemory[id])state=trackR09(id,ctx());
 for(const id of ids)if(state.campaigns[id]!.status==='ENABLED')await dispatch({group:'CAMPAIGN',id},CAMPAIGN);
 for(const id of ids)if(state.campaigns[id]!.status==='ENABLED')await dispatch({group:'PLACEMENT',id},PLACEMENT);
 for(const [id,e] of Object.entries(state.targetEntities))if(e.status==='ENABLED'&&state.campaigns[e.campaignId]!.status==='ENABLED')await dispatch({group:'TARGET',id,campaignId:e.campaignId},TARGET);
 state=await verifyHarvests(state,i.port,at,n=>notifications.push(n),config,seconds=>{waitSeconds+=seconds;});
 for(const [tid,e] of Object.entries(state.targetEntities))if(e.status==='ENABLED'&&state.campaigns[e.campaignId]!.status==='ENABLED')for(const query of new Set(i.queries?.[tid]??[]))await dispatch({group:'SEARCHTERM',id:`${tid}:search:${query}`,campaignId:e.campaignId,sourceTargetId:tid,query},SEARCHTERM);
 state=await verifyHarvests(state,i.port,at,n=>notifications.push(n),config,seconds=>{waitSeconds+=seconds;});state=analyzeHours(ctx(),undefined,r=>hourlyAnalyses.push(r));
 for(const id of ids){const m=state.campaignMemory[id];if(m){state={...state,campaignMemory:{...state.campaignMemory,[id]:{...m,budgetByDate:{...m.budgetByDate,[today]:state.campaigns[id]!.dailyBudgetMicros}}}};assertCampaignInvariants(state,id,config,undefined,at);}}
 // New harvest thresholds inherit destination parameters before validation.
 const thresholds={...i.thresholds};for(const [id,e] of Object.entries(state.targetEntities))thresholds[id]??=i.thresholdsByCampaign[e.campaignId]!;
 assertTargetInvariants(state,thresholds,decisions,at,config);
 return {state,decisions,notifications,hourlyAnalyses,audit:audit.events,submittedBids:Object.fromEntries(sent),acknowledgedAt:Object.fromEntries(ackedAt),waitSeconds};
}
