import { runDaily } from './runDaily.js';
import { DEFAULT_CONFIG,type SimConfig } from '../../config/defaults.js';
import type { Scenario,ScenarioTarget } from '../scenario/schema.js';
import type { EngineState,Decision,RuleContext,NotificationLog,RuleId } from '../engine/types.js';
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
import { firstMatchWins } from '../engine/priority.js';
import { registry } from '../rules/registry.js';
import { AuditLog } from '../audit/log.js';
import { FaultyFakePort } from '../api/faultyPort.js';
import { InMemoryFakePort } from '../api/port.js';
import { normalizeText } from '../api/tags.js';
import { submitBoundary,type HourlyAnalysisRecord } from '../rules/hourly/analysis.js';
import { assertTargetInvariants } from '../invariants/target.js';
export interface AccountTimeline { day:number;date:string;campaignId:string;ruleId:RuleId;targetId?:string;query?:string;tos:number;bid?:number;status:string;budget:number;tag:string; }
export async function runAccountLoop(options:{scenario?:Scenario;scriptedMarket?:ScriptedMarket;days?:number;config?:SimConfig;runHour?:number}){
 const s=options.scenario??options.scriptedMarket?.scenario;if(!s)throw new Error('SCENARIO_REQUIRED');
 const config=options.config??DEFAULT_CONFIG,runHour=options.runHour??0,days=options.days??s.days;
 if(!Number.isInteger(runHour)||runHour<0||runHour>23||days<1)throw new Error('INVALID_RUN_OPTIONS');
 const start=date(s.startDate,config.marketplace.zone),end=start.plus({days}),clock=new SimClock(start.toUTC().toISO()!);
 const market=options.scriptedMarket??new MarketDriver(s,new MemoryFactSink());
 const inner=new InMemoryFakePort(),port=new FaultyFakePort(inner,clock,s.seed,()=>eventContext(s,clock.now()).apiFault);
 const hourlyAnalyses:HourlyAnalysisRecord[]=[];
 const hourlyBoundaries:{at:string;changes:{targetId:string;before:number|undefined;after:number}[]}[]=[];
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
 let acknowledgedAt:Record<string,string>={},waitSeconds=0;
 let previous=start.minus({hours:1}).toUTC().toISO()!;
 for(let at=start;at<end;at=at.plus({hours:1})){
  const iso=at.toUTC().toISO()!,today=at.toISODate()!;clock.advanceHours((Date.parse(iso)-Date.parse(clock.now()))/3600000);port.configure(eventContext(s,iso).apiFault);refresh();
  const context=():RuleContext=>({state,config,clock,today,runId:`${iso}|account`,thresholds,thresholdsByCampaign,metrics:new MetricsReader(index,iso,config),audit,decisions,notify:n=>notifications.push(n),paramsVersion:Object.values(thresholdsByCampaign).map(t=>t.paramsVersion).join(':'),manualReenabledCampaignIds:[...pendingEnable],harvestDestinations:Object.fromEntries(s.campaigns.filter(c=>c.harvestDestinationCampaignId).map(c=>[c.id,c.harvestDestinationCampaignId!]))});
  // Console edits mutate only Amazon. Reconciliation owns all engine changes.
  const amazonView=async()=>{const v=view();const cs=await inner.getCampaigns(Object.keys(state.campaigns));for(const c of v.campaigns){const remote=cs.find(x=>x.id===c.id);if(remote)Object.assign(c,{name:remote.name,status:remote.status,budget:remote.dailyBudgetMicros/1e6,topOfSearchPct:remote.topOfSearchPct});const ts=await inner.listTargets(c.id);for(const t of c.targets){const remote=ts.find(x=>x.id===t.id);if(remote)Object.assign(t,{bid:remote.bidMicros/1e6,status:remote.status});}}return v;};
  const manual=await amazonView(),beforeManual=structuredClone(manual);applyManualEdits(s,manual,previous,iso);
  for(const c of manual.campaigns){const before=beforeManual.campaigns.find(x=>x.id===c.id)!;if(c.status!==before.status||c.name!==before.name||c.budget!==before.budget){const remote=(await inner.getCampaigns([c.id]))[0]!;await inner.updateCampaign({...remote,status:c.status,name:c.name,dailyBudgetMicros:micros(Math.round(c.budget*1e6))},`console:${iso}:${c.id}`);}
   for(const t of c.targets){const old=before.targets.find(x=>x.id===t.id)!;if(t.bid!==old.bid||t.status!==old.status)await inner.updateTargets([{target:{...state.targetEntities[t.id]!,status:t.status},bidMicros:roundBidToCent(micros(Math.round(t.bid*1e6)))}],t.kind==='KEYWORD'?'/sp/keywords':'/sp/targets',`console:${iso}:${t.id}`);}
  }
  // Product hard limits take precedence over the soft anchor band after parameter changes.
  for(const [id,m] of Object.entries(state.targets)){const t=thresholds[id]!;if(m.anchorBidMicros*.5>t.Bid_max&&!notifications.some(n=>n.type==='EMPTY_BID_RANGE'&&n.details.targetId===id))notifications.push({at:iso,campaignId:state.targetEntities[id]!.campaignId,type:'EMPTY_BID_RANGE',details:{targetId:id,anchor:m.anchorBidMicros,Bid_max:t.Bid_max}});
   if((m.baseBidMicros>t.Bid_max||m.baseBidMicros<t.Bid_min)&&state.targetEntities[id]!.status==='ENABLED'){
    const d=firstMatchWins({group:'HOURLY',id},[{...registry.find(r=>r.id==='R21B')!,evaluate:(_,c)=>({proposedState:{...c.state,targets:{...c.state.targets,[id]:{...m,baseBidMicros:t.Bid_max}}},reasons:['PARAMS_HARD_LIMIT']})}],{...context(),runId:`${iso}|params`});
    if(d)state=d.after;
   }
  }
  index.update(facts);

  if(at.hour===runHour&&!runDates.has(today)){
   runDates.add(today);
   const result=await runDaily({state,port,clock,config,facts:index,thresholds,thresholdsByCampaign,submittedBids:Object.fromEntries(sent),acknowledgedAt,queries:Object.fromEntries([...truth].map(([id,t])=>[id,t.searchTerms.map(x=>normalizeText(x.query))])),harvestDestinations:Object.fromEntries(s.campaigns.filter(c=>c.harvestDestinationCampaignId).map(c=>[c.id,c.harvestDestinationCampaignId!]))});
   state=result.state;hourlyAnalyses.push(...result.hourlyAnalyses);acknowledgedAt=result.acknowledgedAt;waitSeconds+=result.waitSeconds;
   sent.clear();for(const [id,bid] of Object.entries(result.submittedBids))sent.set(id,bid);
   for(const event of result.audit)audit.append(event);decisions.push(...result.decisions);notifications.push(...result.notifications);
   for(const [id,e] of Object.entries(state.targetEntities))if(!truth.has(id)){const p=state.pendingHarvests?.find(p=>p.keywordId===id)??state.verifiedHarvests?.find(p=>p.keywordId===id);if(!p)throw new Error('MISSING_HARVEST_TRUTH');const src=truth.get(p.sourceTargetId)!;truth.set(id,{...harvestedTruth(src,p.query),id,bid:state.targets[id]!.baseBidMicros/1e6,status:'ENABLED',kind:'KEYWORD',matchType:'EXACT',text:p.query});initialBids[id]=state.targets[id]!.anchorBidMicros/1e6;thresholds[id]=thresholdsByCampaign[p.destCampaignId]!;}
   for(const d of result.decisions){const e=d.after.targetEntities[d.objectRef.id],cid=d.objectRef.group==='CAMPAIGN'||d.objectRef.group==='PLACEMENT'?d.objectRef.id:d.objectRef.campaignId??e!.campaignId,campaign=d.after.campaigns[cid]!;
    timeline.push({day:calendarDaysBetween(s.startDate,today),date:today,campaignId:cid,ruleId:d.ruleId,...(e?{targetId:e.id,bid:d.after.targets[e.id]!.baseBidMicros/1e6}:{}),...(d.objectRef.query?{query:d.objectRef.query}:{}),tos:campaign.topOfSearchPct,status:e?.status??campaign.status,budget:campaign.dailyBudgetMicros/1e6,tag:d.after.campaignMemory[cid]?.tag??'NORMAL'});
   }
  }
  const beforeBoundary=new Map(sent);
  await submitBoundary(iso,state,thresholds,port,sent,boundaries,config,r=>{waitSeconds+=r.waitSeconds;for(const id of r.acked)acknowledgedAt[`target:${id}`]=iso;for(const id of r.failures)notifications.push({at:iso,campaignId:state.targetEntities[id]!.campaignId,type:'API_WRITE_FAILED',details:{ruleId:'R21B',targetId:id}});});
  hourlyBoundaries.push({at:iso,changes:[...sent].filter(([id,bid])=>beforeBoundary.get(id)!==bid).map(([targetId,after])=>({targetId,before:beforeBoundary.get(targetId),after}))});
  assertTargetInvariants(state,thresholds,decisions,iso,config);
  for(const [id,bid] of sent){const e=state.targetEntities[id]!;if(e.status==='PAUSED')continue;const t=thresholds[id]!,tos=state.campaigns[e.campaignId]!.topOfSearchPct;if(bid<t.Bid_min||bid>t.Bid_max||bid*(1+tos/100)>1.5*t.Bid_max+1e-6)throw new Error('ACKNOWLEDGED_BID_INVARIANT');}
  facts.push(...market.step(iso,await amazonView()).facts);previous=iso;
 }
 const targets=Object.entries(state.targetEntities).map(([id,e])=>({id,text:e.text,initialBid:initialBids[id]!,finalBid:state.targets[id]!.baseBidMicros/1e6,status:e.status,decay:state.targets[id]!.baseBidMicros/state.targets[id]!.anchorBidMicros-1,stalledDays:calendarDaysBetween((state.targets[id]!.lastBidChangeAt??state.targets[id]!.createdAt??start.toUTC().toISO()!).slice(0,10),end.toISODate()!)}));
 const matureFacts=market instanceof MarketDriver?[...facts,...market.flush(end.plus({days:15}).toUTC().toISO()!)]:[...facts];
 return {state,facts,matureFacts,hourlyAnalyses,hourlyBoundaries,truth:market instanceof MarketDriver?market.truth:[],waitSeconds,audit:audit.events,decisions,notifications,timeline,targets,portCalls:port.calls};
}
export function accountTimelineMarkdown(result:Awaited<ReturnType<typeof runAccountLoop>>){return '| day | date | campaign | target | search term | rule | base bid | ToS | status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'+result.timeline.map(t=>`| ${t.day} | ${t.date} | ${t.campaignId} | ${t.targetId??''} | ${t.query??''} | ${t.ruleId} | ${t.bid??''} | ${t.tos}% | ${t.status} |`).join('\n')+'\n\n## Targets\n\n| target | initial bid | final bid | status | decay vs anchor | stalled days |\n| --- | --- | --- | --- | --- | --- |\n'+result.targets.map(t=>`| ${t.id} | $${t.initialBid.toFixed(2)} | $${t.finalBid.toFixed(2)} | ${t.status} | ${(t.decay*100).toFixed(1)}% | ${t.stalledDays} |`).join('\n')+'\n';}
