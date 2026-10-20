import type { RuleContext,EngineState } from '../../engine/types.js';
import type { TargetMemory,CampaignTag } from '../../domain/state.js';
import type { Hour } from '../../domain/entities.js';
import type { DerivedThresholds } from '../../domain/params.js';
import type { AmazonAdsPort,TargetEndpoint } from '../../api/port.js';
import { DEFAULT_CONFIG,type SimConfig } from '../../../config/defaults.js';
import { micros,roundBidToCent } from '../../domain/money.js';
import { resolveWindow } from '../../data/windows.js';
import { marketplaceHour,instant,hourlyBucket } from '../../time/clock.js';
/** The last cent inside the hard interval is used before rounding an outbound bid. */
export function outboundBid(m:TargetMemory,h:Hour,t:DerivedThresholds,tos:number,tag:CampaignTag){
 const f=tag!=='NORMAL'?Math.min(1,m.hourlyFactor[h]):m.hourlyFactor[h];
 const cap=Math.floor(Math.min(t.Bid_max,1.5*t.Bid_max/(1+tos/100))/10000)*10000;
 if(cap<t.Bid_min)throw new Error('EMPTY_BID_RANGE');
 return micros(Math.max(t.Bid_min,Math.min(cap,roundBidToCent(micros(Math.round(m.baseBidMicros*f))))));
}
export function analyzeHours(c:RuleContext,only?:"R20"|"R21"):EngineState{
 if(instant(c.clock.now()).setZone(c.config.marketplace.zone).weekday!==c.config.hourlyAnalysisWeekday)return c.state;
 const targets={...c.state.targets};
 for(const [id,e] of Object.entries(c.state.targetEntities)){
  if(e.status!=='ENABLED'||c.state.campaigns[e.campaignId]?.status!=='ENABLED')continue;
  // SPEC-AMBIGUITY: Campaign scope shares evidence, but caps factors separately for each target.
  const scope=c.config.ambiguity.hourlyScope==='campaign'?e.campaignId:id;
  const w=resolveWindow({kind:'rolling',days:28,minRipeDays:1},c.today,{windowStartAt:'1900-01-01T00:00Z'},c.config);
  const fs=c.metrics.granular(scope,w.from,w.to).filter(f=>f.hour!==undefined&&f.placement===undefined);
  const all=c.metrics.aggregate(fs),cv=all.clicks?all.orders/all.clicks:0,m=targets[id]!,t=c.thresholds[id]!,tos=c.state.campaigns[e.campaignId]!.topOfSearchPct;
  const factors={} as Record<Hour,number>;
  for(let i=0;i<24;i++){
   const h=i as Hour,a=c.metrics.aggregate(fs.filter(f=>f.hour===h));let factor=1;
   if(a.clicks>=c.config.thresholds.hourlyClicks){
    if(only!=='R21'&&a.orders/a.clicks<.5*cv)factor=Math.max(.70,t.Bid_min/m.baseBidMicros);
    else if(only!=='R20'&&c.state.campaignMemory[e.campaignId]?.tag==='NORMAL'&&a.orders>=2&&cv>0&&a.orders/a.clicks>=1.3*cv)factor=Math.min(1.15,t.Bid_max/m.baseBidMicros,1.5*t.Bid_max/(1+tos/100)/m.baseBidMicros);
   }
   factors[h]=factor;
  }
  targets[id]={...m,hourlyFactor:factors};
 }
 return {...c.state,targets};
}
export async function submitBoundary(at:string,state:EngineState,thresholds:Readonly<Record<string,DerivedThresholds>>,port:AmazonAdsPort,sent:Map<string,number>,done:Set<string>,config:SimConfig=DEFAULT_CONFIG){
 const bucket=hourlyBucket(at);if(done.has(bucket))return;
 const h=marketplaceHour(at,config.marketplace);
 for(const endpoint of ['/sp/keywords','/sp/targets'] as const){
  const updates=Object.entries(state.targetEntities).filter(([id,e])=>e.status==='ENABLED'&&state.campaigns[e.campaignId]?.status==='ENABLED'&&(e.kind==='KEYWORD'?'/sp/keywords':'/sp/targets')===endpoint).map(([id,target])=>({target,bidMicros:outboundBid(state.targets[id]!,h,thresholds[id]!,state.campaigns[target.campaignId]!.topOfSearchPct,state.campaignMemory[target.campaignId]?.tag??'NORMAL')})).filter(u=>sent.get(u.target.id)!==u.bidMicros);
  if(updates.length){const results=await port.updateTargets(updates,endpoint,`R21B:${bucket}:${endpoint}`);for(const result of results)if(result.ok)sent.set(result.id,updates.find(u=>u.target.id===result.id)!.bidMicros);}
 }
 done.add(bucket);
}
