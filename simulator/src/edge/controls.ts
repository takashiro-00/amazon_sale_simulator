import type {Scenario} from '../scenario/schema.js';
import {DEFAULT_CONFIG} from '../../config/defaults.js';
import {runAccountLoop} from '../runner/accountLoop.js';
import {queryFacts} from '../data/facts.js';
import {resolveWindow} from '../data/windows.js';
import {date,toMarketplaceDate} from '../time/clock.js';
type Run=Awaited<ReturnType<typeof runAccountLoop>>;
/** Freeze the decision's window and vary only knowledge time, never its state or clock. */
export function measureLagControl(s:Scenario,r:Run){
 const asOf=date(s.startDate,s.marketplace.zone).plus({days:s.days+15}).toUTC().toISO()!;
 return r.decisions.filter(d=>['R06','R12','R13'].includes(d.ruleId)).map(d=>{
  const at=d.runId.split('|')[0]!,today=toMarketplaceDate(at,s.marketplace),memory=d.ruleId==='R06'?d.before.campaignMemory[d.objectRef.id]!:d.before.targets[d.objectRef.id]!;
  const window=resolveWindow({kind:d.ruleId==='R13'?'rolling':'post',days:14,minRipeDays:1},today,{windowStartAt:d.ruleId==='R13'?d.before.targets[d.objectRef.id]!.createdAt!:memory.windowStartAt},DEFAULT_CONFIG);
  const totals=(knowledge:string)=>queryFacts(r.matureFacts,{entityRef:d.objectRef.id,from:window.from,to:window.to,asOf:knowledge,dailyOnly:true},DEFAULT_CONFIG).reduce((a,f)=>({clicks:a.clicks+f.clicks,orders:a.orders+f.orders,spend:a.spend+f.spendMicros/1e6,sales:a.sales+f.salesMicros/1e6}),{clicks:0,orders:0,spend:0,sales:0});
  return {ruleId:d.ruleId,objectRef:d.objectRef,at,window,observed:totals(at),mature:totals(asOf)};
 });
}
/** The final complete 28-day window ends at D-2, just as hourly analysis does. */
export function measureHourlySignal(s:Scenario,r:Run){
 const last=date(s.startDate,s.marketplace.zone).plus({days:s.days-1}),window=resolveWindow({kind:'rolling',days:28,minRipeDays:1},last.toISODate()!,{windowStartAt:'1900-01-01T00:00Z'},DEFAULT_CONFIG),cid=s.campaigns[0]!.id;
 const facts=queryFacts(r.matureFacts,{entityRef:cid,from:window.from,to:window.to,asOf:last.plus({days:16}).toUTC().toISO()!},DEFAULT_CONFIG).filter(f=>f.hour!==undefined&&f.placement===undefined);
 const hourly=Array.from({length:24},(_,hour)=>{const fs=facts.filter(f=>f.hour===hour);return {hour,days:new Set(fs.map(f=>f.marketplaceDate)).size,clicks:fs.reduce((n,f)=>n+f.clicks,0),orders:fs.reduce((n,f)=>n+f.orders,0)};});
 const calls=r.portCalls.filter(c=>c.op.startsWith('updateTargets')&&c.idempotencyKey.startsWith('R21B:'));
 return {window,hourly,minHourlyClicks:Math.min(...hourly.map(h=>h.clicks)),budgetCappedHours:facts.filter(f=>f.budgetCapped).length,R20:r.hourlyAnalyses.filter(a=>a.after<a.before&&a.after<1).length,R21:r.hourlyAnalyses.filter(a=>a.after>a.before&&a.after>1).length,R21B:calls.length,duplicateBoundaryWrites:calls.length-new Set(calls.map(c=>c.idempotencyKey)).size,changedBoundaries:r.hourlyBoundaries.filter(b=>b.changes.length>0).length,unchangedBoundaryWrites:calls.filter(c=>!r.hourlyBoundaries.find(b=>b.at===c.time)?.changes.length).length};
}
