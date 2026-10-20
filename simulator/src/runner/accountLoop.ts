import { DEFAULT_CONFIG,type SimConfig } from '../../config/defaults.js';
import type { Scenario,ScenarioTarget } from '../scenario/schema.js';
import type { EngineState,Decision,RuleContext,NotificationLog,ObjectRef,RuleId } from '../engine/types.js';
import type { Target,Hour } from '../domain/entities.js';
import { createTargetMemory } from '../domain/state.js';
import { micros,roundBidToCent } from '../domain/money.js';
import { deriveThresholds,type DerivedThresholds } from '../domain/params.js';
import { date,SimClock,calendarDaysBetween } from '../time/clock.js';
import { MarketDriver,harvestedTruth,applyManualEdits,type EntityView } from '../market/driver.js';
import { ScriptedMarket } from '../market/scripted.js';
import { MemoryFactSink } from '../market/reporting.js';
import { eventContext,productAt } from '../market/events.js';
import { FactIndex,type MetricFact } from '../data/facts.js';
import { MetricsReader } from '../data/metrics.js';
import { firstMatchWins,CAMPAIGN,TARGET,PLACEMENT,SEARCHTERM,stateEqual } from '../engine/priority.js';
import { registry } from '../rules/registry.js';
import { trackR09 } from '../rules/campaign/r09Tracker.js';
import { AuditLog, configHash } from '../audit/log.js';
import { FaultyFakePort,RateLimitError,TransientServerError } from '../api/faultyPort.js';
import { InMemoryFakePort,type BatchResult } from '../api/port.js';
import { normalizeText } from '../api/tags.js';
import { analyzeHours,outboundBid,submitBoundary } from '../rules/hourly/analysis.js';
import { verifyHarvests } from './harvest.js';
import { assertCampaignInvariants } from '../invariants/campaign.js';
import { assertTargetInvariants } from '../invariants/target.js';
export interface AccountTimeline { day:number;date:string;campaignId:string;ruleId:RuleId;targetId?:string;query?:string;tos:number;bid?:number;status:string;budget:number;tag:string; }
export async function runAccountLoop(options:{scenario?:Scenario;scriptedMarket?:ScriptedMarket;days?:number;config?:SimConfig;runHour?:number}){
 const s=options.scenario??options.scriptedMarket?.scenario;if(!s)throw new Error('SCENARIO_REQUIRED');
 const config=options.config??DEFAULT_CONFIG,runHour=options.runHour??0,days=options.days??s.days;
 if(!Number.isInteger(runHour)||runHour<0||runHour>23||days<1)throw new Error('INVALID_RUN_OPTIONS');
 const start=date(s.startDate,config.marketplace.zone),end=start.plus({days}),clock=new SimClock(start.toUTC().toISO()!);
 const market=options.scriptedMarket??new MarketDriver(s,new MemoryFactSink());
 const port=new FaultyFakePort(new InMemoryFakePort(),clock,s.seed,()=>eventContext(s,clock.now()).apiFault);
 const facts:MetricFact[]=[],index=new FactIndex(),audit=new AuditLog(),decisions:Decision[]=[],notifications:NotificationLog[]=[],timeline:AccountTimeline[]=[];
 let state:EngineState={campaigns:{},campaignMemory:{},targets:{},targetEntities:{},negatives:{},pendingHarvests:[],verifiedHarvests:[]};
 const truth=new Map<string,ScenarioTarget>(),sent=new Map<string,number>(),boundaries=new Set<string>(),runDates=new Set<string>(),pendingEnable=new Set<string>();
 const initialBids:Record<string,number>={};
 port.configure({});
 for(const c of s.campaigns){
  const campaign={id:c.id,asin:c.asin,type:c.type,targetingKind:c.type==='AUTO'?'AUTO' as const:'KEYWORD' as const,status:c.status,name:c.name,dailyBudgetMicros:micros(Math.round(c.budget*1e6)),topOfSearchPct:c.topOfSearchPct};
  state={...state,campaigns:{...state.campaigns,[c.id]:campaign}};await port.updateCampaign(campaign,`seed:${c.id}`);
  for(const t of c.targets){const bid=roundBidToCent(micros(Math.round(t.bid*1e6))),entity:Target={id:t.id,campaignId:c.id,adGroupId:`${c.id}:group`,kind:t.kind,text:normalizeText(t.text),status:t.status,bidMicros:bid,...(t.kind==='KEYWORD'?{matchType:t.matchType??'EXACT'}:{})};
   truth.set(t.id,structuredClone(t));initialBids[t.id]=bid/1e6;sent.set(t.id,bid);
   state={...state,targets:{...state.targets,[t.id]:createTargetMemory(bid,clock.now(),config)},targetEntities:{...state.targetEntities,[t.id]:entity}};
   if(t.kind==='KEYWORD')await port.createKeywords([entity],`seed:${t.id}`);else await port.updateTargets([{target:entity,bidMicros:bid}],'/sp/targets',`seed:${t.id}`);
  }
 }
 const thresholds:Record<string,DerivedThresholds>={},thresholdsByCampaign:Record<string,DerivedThresholds>={};
 const refresh=()=>{for(const c of Object.values(state.campaigns)){const p=productAt(s,c.asin,clock.now()),result=deriveThresholds({asin:c.asin,priceMicros:micros(Math.round(p.priceUsd*1e6)),breakEvenAcos:p.breakEvenAcos,expCvr:p.expectedCvr},config);thresholdsByCampaign[c.id]=result.thresholds;for(const warning of result.warnings)if(!notifications.some(n=>n.campaignId===c.id&&n.type==='PRODUCT_INFEASIBLE'))notifications.push({at:clock.now(),campaignId:c.id,type:'PRODUCT_INFEASIBLE',details:{warning}});}for(const [id,e] of Object.entries(state.targetEntities))thresholds[id]=thresholdsByCampaign[e.campaignId]!;};
 const view=():EntityView=>({negatives:state.negatives??{},campaigns:s.campaigns.map(c=>({...c,...{name:state.campaigns[c.id]!.name,status:state.campaigns[c.id]!.status,budget:state.campaigns[c.id]!.dailyBudgetMicros/1e6,topOfSearchPct:state.campaigns[c.id]!.topOfSearchPct},targets:Object.entries(state.targetEntities).filter(([,e])=>e.campaignId===c.id).map(([id,e])=>({...truth.get(id)!,id,kind:e.kind,text:e.text,status:e.status,...(e.matchType?{matchType:e.matchType}:{}),bid:(sent.get(id)??state.targets[id]!.baseBidMicros)/1e6}))}))});
 const retry=async<T>(fn:()=>Promise<T>):Promise<T>=>{for(let attempt=0;;attempt++){try{const r=await fn();if(Array.isArray(r)&&r.some(x=>x&&typeof x==='object'&&'ok'in x&&!x.ok)){if(attempt<3)continue;throw new Error('API_PARTIAL_BATCH_EXHAUSTED');}return r;}catch(e){if(attempt>=3||!(e instanceof RateLimitError||e instanceof TransientServerError))throw e;}}};
 let previous=start.minus({hours:1}).toUTC().toISO()!;
 for(let at=start;at<end;at=at.plus({hours:1})){
  const iso=at.toUTC().toISO()!,today=at.toISODate()!;clock.advanceHours((Date.parse(iso)-Date.parse(clock.now()))/3600000);port.configure(eventContext(s,iso).apiFault);refresh();
  const context=():RuleContext=>({state,config,clock,today,runId:`${iso}|account`,thresholds,thresholdsByCampaign,metrics:new MetricsReader(index,iso,config),audit,decisions,notify:n=>notifications.push(n),paramsVersion:Object.values(thresholdsByCampaign).map(t=>t.paramsVersion).join(':'),manualReenabledCampaignIds:[...pendingEnable],harvestDestinations:Object.fromEntries(s.campaigns.filter(c=>c.harvestDestinationCampaignId).map(c=>[c.id,c.harvestDestinationCampaignId!]))});
  const manual=view();applyManualEdits(s,manual,previous,iso);
  for(const c of manual.campaigns){const old=state.campaigns[c.id]!;if(old.status==='PAUSED'&&c.status==='ENABLED')pendingEnable.add(c.id);
   if(old.status!==c.status||old.name!==c.name||old.dailyBudgetMicros!==Math.round(c.budget*1e6)){const campaign={...old,status:c.status,name:c.name,dailyBudgetMicros:micros(Math.round(c.budget*1e6))};await retry(()=>port.updateCampaign(campaign,`manual:${iso}:${c.id}`));state={...state,campaigns:{...state.campaigns,[c.id]:campaign}};}
   for(const t of c.targets){
    const e=state.targetEntities[t.id]!,m=state.targets[t.id]!,requested=roundBidToCent(micros(Math.round(t.bid*1e6)));
    if(e.status!==t.status||sent.get(t.id)!==requested){
     const changedBid=sent.get(t.id)!==requested;
     const entity={...e,status:t.status};
     if(changedBid){
      const d=firstMatchWins({group:'TARGET',id:t.id,campaignId:c.id},[{...registry.find(r=>r.id==='R10')!,cooldownGate:null,blockedByTag:[],evaluate:(_,ctx)=>({proposedState:{...ctx.state,targetEntities:{...ctx.state.targetEntities,[t.id]:entity},targets:{...ctx.state.targets,[t.id]:{...m,baseBidMicros:micros(Math.round(requested/m.hourlyFactor[at.hour as Hour]))}}},reasons:['MANUAL_EDIT']})}],{...context(),runId:`${iso}|manual`});
      if(d)state=d.after;
     }
     state={...state,targetEntities:{...state.targetEntities,[t.id]:entity}};
     const bid=outboundBid(state.targets[t.id]!,at.hour as Hour,thresholds[t.id]!,state.campaigns[c.id]!.topOfSearchPct,state.campaignMemory[c.id]?.tag??'NORMAL');
     await retry(()=>port.updateTargets([{target:entity,bidMicros:bid}],e.kind==='KEYWORD'?'/sp/keywords':'/sp/targets',`manual:${iso}:${t.id}`));sent.set(t.id,bid);
    }
   }
  }
  // Product hard limits take precedence over the soft anchor band after parameter changes.
  for(const [id,m] of Object.entries(state.targets)){const t=thresholds[id]!;if(m.anchorBidMicros*.5>t.Bid_max&&!notifications.some(n=>n.type==='EMPTY_BID_RANGE'&&n.details.targetId===id))notifications.push({at:iso,campaignId:state.targetEntities[id]!.campaignId,type:'EMPTY_BID_RANGE',details:{targetId:id,anchor:m.anchorBidMicros,Bid_max:t.Bid_max}});
   if((m.baseBidMicros>t.Bid_max||m.baseBidMicros<t.Bid_min)&&state.targetEntities[id]!.status==='ENABLED'){
    const d=firstMatchWins({group:'HOURLY',id},[{...registry.find(r=>r.id==='R21B')!,evaluate:(_,c)=>({proposedState:{...c.state,targets:{...c.state.targets,[id]:{...m,baseBidMicros:t.Bid_max}}},reasons:['PARAMS_HARD_LIMIT']})}],{...context(),runId:`${iso}|params`});
    if(d)state=d.after;
   }
  }
  index.update(facts);

  const apply=async(d:Decision|null)=>{
   if(!d)return;
   const cid=d.objectRef.group==='CAMPAIGN'||d.objectRef.group==='PLACEMENT'?d.objectRef.id:d.objectRef.campaignId??d.after.targetEntities[d.objectRef.id]!.campaignId;
   const key=`${d.runId}:${d.objectRef.id}:${d.ruleId}`;
   const created=d.baseBidTargetIds.filter(id=>!d.before.targets[id]);
   if(created.length){
    try{await retry(()=>port.createKeywords(created.map(id=>({...d.after.targetEntities[id]!,bidMicros:d.after.targets[id]!.baseBidMicros})),key));}
    catch(e){decisions.splice(decisions.indexOf(d),1);audit.append({runId:d.runId,at:iso,marketplaceDate:today,objectRef:d.objectRef,ruleId:d.ruleId,outcome:'ERROR',reasons:['CREATE_FAILED',String(e)],inputsSnapshot:{reads:[],paramsVersion:d.paramsVersion,configHash:configHash(config),now:iso},before:{},after:{},paramsVersion:d.paramsVersion});return;}
    for(const id of created){const p=d.after.pendingHarvests!.find(p=>p.keywordId===id)!,src=truth.get(p.sourceTargetId)!;truth.set(id,{...harvestedTruth(src,p.query),id,bid:d.after.targets[id]!.baseBidMicros/1e6,status:'ENABLED',kind:'KEYWORD',matchType:'EXACT',text:p.query});sent.set(id,d.after.targets[id]!.baseBidMicros);initialBids[id]=d.after.targets[id]!.anchorBidMicros/1e6;thresholds[id]=thresholdsByCampaign[p.destCampaignId]!;}
   }
   for(const [id,c] of Object.entries(d.after.campaigns)){const old=d.before.campaigns[id]!;if(old.topOfSearchPct!==c.topOfSearchPct)await retry(()=>port.updatePlacement(id,c.topOfSearchPct,key));if(!stateEqual({...old,topOfSearchPct:c.topOfSearchPct},c))await retry(()=>port.updateCampaign(c,key));}
   for(const [id,list] of Object.entries(d.after.negatives??{})){const added=list.filter(n=>!(d.before.negatives?.[id]??[]).some(x=>normalizeText(x.text)===normalizeText(n.text)));if(added.length)await retry(()=>port.createNegatives(added,key));}
   const changed=Object.entries(d.after.targetEntities).filter(([id,e])=>!created.includes(id)&&(d.baseBidTargetIds.includes(id)||e.status!==d.before.targetEntities[id]?.status));
   for(const [id,e] of changed){const bid=outboundBid(d.after.targets[id]!,at.hour as Hour,thresholds[id]!,d.after.campaigns[e.campaignId]!.topOfSearchPct,d.after.campaignMemory[e.campaignId]?.tag??'NORMAL');await retry(()=>port.updateTargets([{target:e,bidMicros:bid}],e.kind==='KEYWORD'?'/sp/keywords':'/sp/targets',`${key}:${id}`));sent.set(id,bid);}
   state=d.after;
   for(const id of Object.keys(state.campaignMemory))assertCampaignInvariants(state,id,config,undefined,iso);
   assertTargetInvariants(state,thresholds,decisions,iso,config);
   const e=state.targetEntities[d.objectRef.id],campaign=state.campaigns[cid]!;
   timeline.push({day:calendarDaysBetween(s.startDate,today),date:today,campaignId:cid,ruleId:d.ruleId,...(e?{targetId:e.id,bid:state.targets[e.id]!.baseBidMicros/1e6}:{}),...(d.objectRef.query?{query:d.objectRef.query}:{}),tos:campaign.topOfSearchPct,status:e?.status??campaign.status,budget:campaign.dailyBudgetMicros/1e6,tag:state.campaignMemory[cid]?.tag??'NORMAL'});
  };
  const dispatch=async(ref:ObjectRef,ids:readonly RuleId[])=>apply(firstMatchWins(ref,ids.map(id=>registry.find(r=>r.id===id)!),context()));
  if(at.hour===runHour&&!runDates.has(today)){
   runDates.add(today);const ids=Object.keys(state.campaigns).sort();
   for(const id of ids)if(state.campaigns[id]!.status==='ENABLED'&&(!state.campaignMemory[id]||pendingEnable.has(id)))await dispatch({group:'CAMPAIGN',id},['R01']);
   for(const id of ids){const m=state.campaignMemory[id];if(m){const history={...m.budgetByDate,[today]:state.campaigns[id]!.dailyBudgetMicros};state={...state,campaignMemory:{...state.campaignMemory,[id]:{...m,budgetByDate:Object.fromEntries(Object.entries(history).sort(([a],[b])=>a.localeCompare(b)).slice(-35))}}};}}
   for(const id of ids)if(state.campaignMemory[id])state=trackR09(id,context());
   for(const id of ids)if(state.campaigns[id]!.status==='ENABLED')await dispatch({group:'CAMPAIGN',id},CAMPAIGN);
   for(const id of ids)if(state.campaigns[id]!.status==='ENABLED')await dispatch({group:'PLACEMENT',id},PLACEMENT);
   for(const [id,e] of Object.entries(state.targetEntities))if(e.status==='ENABLED'&&state.campaigns[e.campaignId]!.status==='ENABLED')await dispatch({group:'TARGET',id,campaignId:e.campaignId},TARGET);
   state=await verifyHarvests(state,port,iso,n=>notifications.push(n));
   for(const [tid,e] of Object.entries(state.targetEntities))if(e.status==='ENABLED'&&state.campaigns[e.campaignId]!.status==='ENABLED'){
    const queries=new Set((truth.get(tid)?.searchTerms??[]).map(t=>normalizeText(t.query)));
    for(const query of queries)await dispatch({group:'SEARCHTERM',id:`${tid}:search:${query}`,campaignId:e.campaignId,sourceTargetId:tid,query},SEARCHTERM);
   }
   state=await verifyHarvests(state,port,iso,n=>notifications.push(n));
   state=analyzeHours(context());
   for(const id of ids){const m=state.campaignMemory[id];if(m)state={...state,campaignMemory:{...state.campaignMemory,[id]:{...m,budgetByDate:{...m.budgetByDate,[today]:state.campaigns[id]!.dailyBudgetMicros}}}};}
   pendingEnable.clear();
  }
  await submitBoundary(iso,state,thresholds,port,sent,boundaries,config);
  assertTargetInvariants(state,thresholds,decisions,iso,config);
  for(const [id,bid] of sent){const e=state.targetEntities[id]!;if(e.status==='PAUSED')continue;const t=thresholds[id]!,tos=state.campaigns[e.campaignId]!.topOfSearchPct;if(bid<t.Bid_min||bid>t.Bid_max||bid*(1+tos/100)>1.5*t.Bid_max+1e-6)throw new Error('ACKNOWLEDGED_BID_INVARIANT');}
  facts.push(...market.step(iso,view()).facts);previous=iso;
 }
 const targets=Object.entries(state.targetEntities).map(([id,e])=>({id,text:e.text,initialBid:initialBids[id]!,finalBid:state.targets[id]!.baseBidMicros/1e6,status:e.status,decay:state.targets[id]!.baseBidMicros/state.targets[id]!.anchorBidMicros-1,stalledDays:calendarDaysBetween((state.targets[id]!.lastBidChangeAt??state.targets[id]!.createdAt??start.toUTC().toISO()!).slice(0,10),end.toISODate()!)}));
 return {state,facts,audit:audit.events,decisions,notifications,timeline,targets,portCalls:port.calls};
}
export function accountTimelineMarkdown(result:Awaited<ReturnType<typeof runAccountLoop>>){return '| day | date | campaign | target | search term | rule | base bid | ToS | status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'+result.timeline.map(t=>`| ${t.day} | ${t.date} | ${t.campaignId} | ${t.targetId??''} | ${t.query??''} | ${t.ruleId} | ${t.bid??''} | ${t.tos}% | ${t.status} |`).join('\n')+'\n\n## Targets\n\n| target | initial bid | final bid | status | decay vs anchor | stalled days |\n| --- | --- | --- | --- | --- | --- |\n'+result.targets.map(t=>`| ${t.id} | $${t.initialBid.toFixed(2)} | $${t.finalBid.toFixed(2)} | ${t.status} | ${(t.decay*100).toFixed(1)}% | ${t.stalledDays} |`).join('\n')+'\n';}
