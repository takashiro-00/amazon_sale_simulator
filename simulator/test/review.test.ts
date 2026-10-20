import {it,expect} from "vitest";
import {DEFAULT_CONFIG as c} from "../config/defaults.js";
import * as b from "../src/domain/budgetLadder.js";
import * as tags from "../src/api/tags.js";
import {usd} from "../src/domain/money.js";
import {registry} from "../src/rules/registry.js";
import {clampBid} from "../src/guards/bid.js";
import {deriveThresholds} from "../src/domain/params.js";
import {createTargetMemory} from "../src/domain/state.js";
import {isInCooldown,applyResetOnEffectiveChange} from "../src/engine/cooldown.js";
import {resolveWindow} from "../src/data/windows.js";
it("review 1 exact budget ladder and multiplication",()=>{
 const ladder=["5","8","10","12","14.40","17.28","20.74","24.88","25"].map(usd);
 expect(c.budgetLadder).toEqual(ladder);
 expect(c.budgetLadder[b.stepUp(7,c)]).toBe(usd("25"));
 expect(b.stepUp(8,c)).toBe(8);
 let current=usd("12");
 for(const next of ladder.slice(4)){current=b.budgetMultiplyStep(current);expect(current).toBe(next);}
 expect(b.budgetMultiplyStep(current)).toBe(current);
});
const rows=[
["R01","daily",null,null,null,null],["R02","daily","budget",2,"rolling",3],
["R03","daily","budget",2,"rolling",3],["R04","daily","budget",2,"rolling",3],
["R04B","daily","budget",3,"rolling",7],["R05","daily","budget",2,"rolling",3],
["R06","daily",null,null,"post",14],["R06B","daily","status",7,"rolling",14],
["R07","every3Days","budget",3,"rolling",7],["R08","every3Days","budget",3,"rolling",3],
["R09","every3Days","budget",3,"rolling",7],["R10","daily","bid",3,"rolling",14],
["R11","daily","bid",3,"post",30],["R12","daily","bid",5,"post",14],
["R13","daily",null,null,"rolling",14],["R14","daily","bid",7,"rolling",7],
["R15","weeklySunday",null,null,"rolling",14],["R16","daily",null,null,"rolling",14],
["R17","daily",null,null,"rolling",14],["R18","daily","placement",7,"rolling",14],
["R19","daily","placement",7,"rolling",14],["R20","weekly",null,null,"rolling",28],
["R21","weekly",null,null,"rolling",28],["R21B","hourBoundary",null,null,null,null],
] as const;
it.each(rows)("review 2 metadata %s",(id,schedule,cooldownKind,cooldownDays,kind,days)=>{
 const r=registry.find(r=>r.id===id)!;
 const blocked:string[]=["R02","R03","R04","R04B","R10","R14","R18","R21"].includes(id)?["MANAGE","ALERT"]:[];
 if(r.group==="CAMPAIGN"&&id!=="R01")blocked.push("PAUSED_AUTO");
 expect([r.schedule,r.cooldownGate,r.cooldownSets,r.windowDays,r.blockedByTag])
 .toEqual([schedule,["R06B","R07","R08","R09"].includes(id)?null:cooldownKind,
 id==="R06B"?[{kind:"budget",days:2},{kind:"bid",days:3}]:["R07","R09"].includes(id)?[{kind:"budget",days:3},{kind:"bid",days:3}]:cooldownKind?[{kind:cooldownKind,days:cooldownDays}]:[],kind?{kind,days}:null,blocked]);
 expect(r.evaluate({group:r.group,id:"x"},{} as never)).toBeNull();
});
it("review 3 remove tags independently of escalation",()=>{
 for(const tag of ["ALERT","MANAGE"] as const){
 expect(tags.applyTag("["+tag+"] Camp","NORMAL")).toBe("Camp");
 expect(tags.removeTag("["+tag+"] Camp")).toBe("Camp");
 expect(tags.canOverwrite(tag,"NORMAL")).toBe(true);
 }
 expect(tags.escalateTag("[ALERT][MANAGE] Camp","MANAGE")).toBe("[ALERT] Camp");
});
const thresholds=deriveThresholds({asin:"A",priceMicros:usd("30"),breakEvenAcos:.4},c).thresholds;
const guard=(old:string,next:string,extra={})=>clampBid({oldBase:usd(old),proposedBase:usd(next),anchor:usd("1"),thresholds,tosPct:0,hourlyFactor:1,ruleId:"R10",...extra});
it("review 4 recovery, no-op and empty hard range",()=>{
 expect(guard(".30",".33")).toMatchObject({base:usd(".33"),reasons:expect.arrayContaining(["OUTSIDE_ANCHOR_BAND_RECOVERING"])});
 expect(guard(".30",".24").base).toBe(usd(".30"));
 expect(guard("3","2.7").base).toBe(usd("1.08"));
 expect(guard(".30",".33",{tosPct:900,hourlyFactor:2})).toMatchObject({base:null,reasons:["EMPTY_BID_RANGE"]});
});
it("review 5 calendar cooldown across DST and early run",()=>{
 const at="2027-03-13T06:00:00-08:00";
 const m={...createTargetMemory(usd("1"),at,c),bidCooldownUntil:"2027-03-16"};
 for(const now of ["2027-03-16T06:00:00-07:00","2027-03-16T05:55:00-07:00"])expect(isInCooldown(m,"bid",now)).toBe(false);
 expect(isInCooldown(m,"bid","2027-03-15T06:00:00-07:00")).toBe(true);
});
it("review 6 golden lifecycle days 4 and 8",()=>{
 expect(c.ambiguity.changeDayCountsAsPost).toBe(true);
 for(const [at,early,ready] of [
 ["2026-10-01T06:00:00-07:00","2026-10-04","2026-10-05"],
 ["2026-10-05T06:00:00-07:00","2026-10-08","2026-10-09"],
 ] as const){
 const m={windowStartAt:at};
 expect(resolveWindow({kind:"post",days:3},early,m).eligible).toBe(false);
 expect(resolveWindow({kind:"post",days:3},ready,m).eligible).toBe(true);
 }
});
