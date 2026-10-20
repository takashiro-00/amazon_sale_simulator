import type { SimConfig } from '../../config/defaults.js';
import type { Scenario } from '../scenario/schema.js';
import { runAccountLoop } from '../runner/accountLoop.js';
import { FactIndex,queryFacts,type MetricFact } from '../data/facts.js';
import { MetricsReader } from '../data/metrics.js';
import { window as campaignWindow } from '../rules/campaign/shared.js';
import { registry } from '../rules/registry.js';
import { deriveThresholds } from '../domain/params.js';
import { micros } from '../domain/money.js';
import { date,SimClock,toMarketplaceDate } from '../time/clock.js';
import { productAt } from '../market/events.js';
import { AuditLog } from '../audit/log.js';
import type { RuleContext,Decision } from '../engine/types.js';
export type MetricValue=number|null|{[key:string]:MetricValue};
export interface MonteCarloRun {seed:string|number;metrics:Record<string,MetricValue>}
const measured=['R06','R13','R12','R16','R17','R05B','R08'] as const;
export function maturePremature(s:Scenario,config:SimConfig,decisions:readonly Decision[],facts:readonly MetricFact[]){
 const premature:Record<string,number>=Object.fromEntries(measured.map(id=>[id,0]));let prematurePause=0;
 const end=date(s.startDate,s.marketplace.zone).plus({days:s.days+15}).toUTC().toISO()!,index=new FactIndex(facts);
 for(const d of decisions){if(!(measured as readonly string[]).includes(d.ruleId)&&d.ruleId!=='R05')continue;
  const at=d.runId.split('|')[0]!,clock=new SimClock(at),byCampaign:RuleContext['thresholdsByCampaign']={};
  for(const c of Object.values(d.before.campaigns)){const p=productAt(s,c.asin,at);(byCampaign as Record<string,ReturnType<typeof deriveThresholds>['thresholds']>)[c.id]=deriveThresholds({asin:c.asin,priceMicros:micros(Math.round(p.priceUsd*1e6)),breakEvenAcos:p.breakEvenAcos,expCvr:p.expectedCvr},config).thresholds;}
  const context:RuleContext={state:d.before,config,clock,today:toMarketplaceDate(at,s.marketplace),runId:d.runId,thresholdsByCampaign:byCampaign,thresholds:Object.fromEntries(Object.values(d.before.targetEntities).map(t=>[t.id,byCampaign[t.campaignId]!])),metrics:new MetricsReader(index,end,config),audit:new AuditLog(),decisions:[],notify:()=>{},paramsVersion:d.paramsVersion};
  const label=d.ruleId==='R05'?'R05B':d.ruleId;
  if(d.ruleId==='R05'){const original={...context,metrics:new MetricsReader(index,at,config)};if(campaignWindow(d.objectRef.id,original,3).orders!==0)continue;}
  const stillMatches=registry.find(r=>r.id===d.ruleId)!.evaluate(d.objectRef,context)!==null&&(d.ruleId!=='R05'||campaignWindow(d.objectRef.id,context,3).orders===0);
  if(!stillMatches){premature[label]=(premature[label]??0)+1;if(d.ruleId==='R06'||d.ruleId==='R13')prematurePause++;}
 }
 return {premature,prematureTotal:Object.values(premature).reduce((a,b)=>a+b,0),prematurePause};
}
/** Count a union of physical target/query spend; campaign pauses expand to targets. */
export function measureWastedSpend(s:Scenario,config:SimConfig,decisions:readonly Decision[],daily:readonly MetricFact[]):number{
 const scopes=new Map<string,{day:string;n2:number}>();
 for(const d of decisions){if(!['R13','R16','R17','R06'].includes(d.ruleId))continue;
  const cid=d.objectRef.campaignId??(d.ruleId==='R06'?d.objectRef.id:d.before.targetEntities[d.objectRef.id]?.campaignId),c=cid?d.before.campaigns[cid]:undefined;if(!c)continue;
  const at=d.runId.split('|')[0]!,day=toMarketplaceDate(at,s.marketplace),p=productAt(s,c.asin,at),n2=deriveThresholds({asin:c.asin,priceMicros:micros(Math.round(p.priceUsd*1e6)),breakEvenAcos:p.breakEvenAcos,expCvr:p.expectedCvr},config).thresholds.N2;
  const ids=d.ruleId==='R06'?Object.values(d.before.targetEntities).filter(t=>t.campaignId===cid&&t.status==='ENABLED').map(t=>t.id):[d.objectRef.query?`${d.objectRef.sourceTargetId}:search:${d.objectRef.query}`:d.objectRef.id];
  for(const id of ids)if(!scopes.has(id)||scopes.get(id)!.day>day)scopes.set(id,{day,n2});
 }
 const fractions=new Map<string,number>();
 for(const [id,scope] of scopes){let clicks=0;for(const f of daily.filter(f=>f.entityRef===id&&f.marketplaceDate<scope.day).sort((a,b)=>a.marketplaceDate.localeCompare(b.marketplaceDate))){const before=clicks;clicks+=f.clicks;
  // SPEC-AMBIGUITY: wastedSpendThresholdPolicy=prorate-crossing-day allocates daily spend after the N2-th click proportionally.
  fractions.set(`${id}|${f.marketplaceDate}`,before>=scope.n2?1:Math.max(0,(clicks-scope.n2)/Math.max(1,f.clicks)));
 }}
 const targetIds=new Set(decisions.flatMap(d=>Object.keys(d.before.targetEntities))),byDay=new Map<string,MetricFact[]>();for(const f of daily){const list=byDay.get(f.marketplaceDate)??[];list.push(f);byDay.set(f.marketplaceDate,list);}
 let total=0;for(const [day,facts] of byDay)for(const f of facts){if(!targetIds.has(f.entityRef))continue;const targetFraction=fractions.get(`${f.entityRef}|${day}`)??0,queries=facts.filter(q=>q.entityRef.startsWith(`${f.entityRef}:search:`));let querySpend=0;
  for(const q of queries){querySpend+=q.spendMicros;total+=q.spendMicros*Math.max(targetFraction,fractions.get(`${q.entityRef}|${day}`)??0);}
  total+=Math.max(0,f.spendMicros-querySpend)*targetFraction;
 }return total/1e6;
}
export function measureRun(s:Scenario,config:SimConfig,r:Awaited<ReturnType<typeof runAccountLoop>>):MonteCarloRun{
 const mature=r.matureFacts,asOf=date(s.startDate,s.marketplace.zone).plus({days:s.days+15}).toUTC().toISO()!;
 const daily=queryFacts(mature,{asOf,dailyOnly:true},config),campaigns=new Map(s.campaigns.map(c=>[c.id,c])),directions=new Map<string,number>();let budget=0,bid=0;
 for(const d of r.decisions){for(const [id,c] of Object.entries(d.after.campaigns)){const old=d.before.campaigns[id];if(!old)continue;const direction=Math.sign(c.dailyBudgetMicros-old.dailyBudgetMicros);if(direction){if(directions.has(`c:${id}`)&&directions.get(`c:${id}`)!==direction)budget++;directions.set(`c:${id}`,direction);}}
  for(const id of d.baseBidTargetIds){const old=d.before.targets[id],after=d.after.targets[id];if(!old||!after)continue;const direction=Math.sign(after.baseBidMicros-old.baseBidMicros);if(direction){if(directions.has(`t:${id}`)&&directions.get(`t:${id}`)!==direction)bid++;directions.set(`t:${id}`,direction);}}
 }
 let spend=0,sales=0,profit=0;for(const f of daily){const c=campaigns.get(f.entityRef);if(!c)continue;spend+=f.spendMicros/1e6;sales+=f.salesMicros/1e6;profit+=(f.salesMicros*productAt(s,c.asin,date(f.marketplaceDate,s.marketplace.zone).toUTC().toISO()!).breakEvenAcos-f.spendMicros)/1e6;}
 const wastedSpend=measureWastedSpend(s,config,r.decisions,daily);
 // SPEC-AMBIGUITY: mcTierScope=first-campaign reports the first campaign to reach a tier.
 const tier=(amount:number)=>{if(s.campaigns.some(c=>c.budget>=amount))return 0;const matches=r.timeline.filter(t=>t.budget>=amount);return matches.length?Math.min(...matches.map(t=>t.day)):null;};
 const notifications:Record<string,number>={};for(const n of r.notifications)notifications[n.type]=(notifications[n.type]??0)+1;
 return {seed:s.seed,metrics:{...maturePremature(s,config,r.decisions,mature),flipFlops:{budget:budget*30/s.days,bid:bid*30/s.days},wastedSpend,timeToTier:{to12:tier(12),to25:tier(25)},spend,sales,acos:sales?spend/sales:null,profit,invariantViolations:0,apiFailures:r.portCalls.filter(c=>c.outcome!=='ok').length,driftEvents:notifications.DRIFT_DETECTED??0,notifications}};
}
export async function runSeed(scenario:Scenario,config:SimConfig,seed:string|number):Promise<MonteCarloRun>{const s={...scenario,seed},cfg={...config,audit:{level:'matched' as const}},r=await runAccountLoop({scenario:s,config:cfg});return measureRun(s,cfg,r);}
