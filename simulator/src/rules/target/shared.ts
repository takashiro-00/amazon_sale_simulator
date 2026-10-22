import { zeroOrders } from '../zeroOrders.js';
import type { RuleContext, Proposal } from '../../engine/types.js';
import type { TargetMemory } from '../../domain/state.js';
import { resolveWindow } from '../../data/windows.js';
import { micros } from '../../domain/money.js';
import { instant, toMarketplaceDate, calendarDaysBetween } from '../../time/clock.js';
export function targetWindow(id:string,ctx:RuleContext,days:number,post=false,minRipeDays=1,at?:string){
 const m=ctx.state.targets[id]!;
 const w=resolveWindow({kind:post?'post':'rolling',days,minRipeDays},ctx.today,{windowStartAt:at??(post?m.windowStartAt:m.createdAt??'1900-01-01T00:00Z')},ctx.config);
 return {...ctx.metrics.campaignWindow(id,w),eligible:w.eligible,w};
}
export const floor=(id:string,c:RuleContext)=>micros(Math.max(c.config.bid.min,c.state.targets[id]!.anchorBidMicros*c.config.bid.anchorMin));
export const active=(at:string|null,c:RuleContext)=>at!==null&&Date.parse(at)>Date.parse(c.clock.now());
export const age=(at:string,c:RuleContext)=>calendarDaysBetween(toMarketplaceDate(at,c.config.marketplace),c.today,c.config.marketplace.zone);
export const until=(days:number,c:RuleContext)=>instant(c.clock.now()).setZone(c.config.marketplace.zone).startOf('day').plus({days}).toUTC().toISO()!;
export function propose(id:string,c:RuleContext,patch:Partial<TargetMemory>):Proposal{return {proposedState:{...c.state,targets:{...c.state.targets,[id]:{...c.state.targets[id]!,...patch}}}};}
export const ratio=(a:{kind:string;v?:number})=>a.kind==='infinite'?Infinity:a.kind==='value'?a.v!:NaN;

export function zero(id:string,c:RuleContext,orders:number,days:number,post=false,start?:string){return zeroOrders(id,c,orders,{kind:post?'post':'rolling',days,minRipeDays:1},start??(post?c.state.targets[id]!.windowStartAt:c.state.targets[id]!.createdAt??'1900-01-01T00:00Z'),start?toMarketplaceDate(start,c.config.marketplace):undefined);}
