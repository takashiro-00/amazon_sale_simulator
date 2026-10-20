import { it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { usd } from "../src/domain/money.js";
import {
  createCampaignMemory,
  createTargetMemory,
} from "../src/domain/state.js";
import {
  isInCooldown,
  isInGrace,
  applyResetOnEffectiveChange,
  isGraceBlocked,
  startGrace,
  GRACE_BLOCKED_RULES,
} from "../src/engine/cooldown.js";
import {
  CAMPAIGN,
  TARGET,
  SEARCHTERM,
  PLACEMENT,
  HOURLY,
  firstMatchWins,
} from "../src/engine/priority.js";
import { AuditLog } from "../src/audit/log.js";
import { SimClock } from "../src/time/clock.js";
import { deriveThresholds } from "../src/domain/params.js";
import type {
  EngineState,
  RuleContext,
  RuleDefinition,
} from "../src/engine/types.js";
import { registry } from "../src/rules/registry.js";
// Reset only owns audit/window fields; the matched rule supplies the expiry.
it("G3 reset preserves cooldown and no-op preserves memory identity",()=>{
 const at="2026-10-10T12:00Z", m=createCampaignMemory(at);
 expect(applyResetOnEffectiveChange(m,"budget",at,false)).toBe(m);
 const reset=applyResetOnEffectiveChange(m,"budget",at,true);
 expect(reset.lastChangeAt.budget).toBe(at);
 expect(reset.cooldownUntil).toEqual({budget:null,placement:null});
 expect(isInCooldown({...reset,cooldownUntil:{budget:"2026-10-12",placement:null}},"budget","2026-10-11T12:00Z")).toBe(true);
});
it("G3 grace blocks exactly the specified IDs", () => {
  const m = startGrace(
    createCampaignMemory("2026-10-10T12:00Z"),
    "2026-10-10T12:00Z",
    DEFAULT_CONFIG,
  );
  expect(isInGrace(m, "2026-10-12T12:00Z")).toBe(true);
  expect(isInGrace(m, m.graceUntil!)).toBe(false);
  expect(GRACE_BLOCKED_RULES).toEqual([
    "R02",
    "R03",
    "R04",
    "R04B",
    "R05",
    "R06",
    "R06B",
    "R07",
    "R08",
    "R09",
  ]);
  for (const r of GRACE_BLOCKED_RULES)
    expect(isGraceBlocked(r, m, "2026-10-11T12:00Z")).toBe(true);
  expect(isGraceBlocked("R11", m, "2026-10-11T12:00Z")).toBe(false);
});
it("G5 exact priorities", () => {
  expect(CAMPAIGN).toEqual([
    "R06",
    "R06B",
    "R08",
    "R05",
    "R07",
    "R09",
    "R04B",
    "R04",
    "R03",
    "R02",
  ]);
  expect(TARGET).toEqual(["R13", "R12", "R11", "R10", "R14"]);
  expect(SEARCHTERM).toEqual(["R15", "R16", "R17"]);
  expect(PLACEMENT).toEqual(["R19", "R18"]);
  expect(HOURLY).toEqual(["R20", "R21"]);
});
function context(): RuleContext {
  const at = "2026-10-20T12:00Z";
  const target = createTargetMemory(usd("1"), at, DEFAULT_CONFIG);
  const state: EngineState = {
    campaigns: {
      c: {
        id: "c",
        asin: "A",
        type: "MANUAL",
        targetingKind: "KEYWORD",
        status: "ENABLED",
        dailyBudgetMicros: usd("10"),
        name: "C",
        topOfSearchPct: 0,
      },
    },
    campaignMemory: { c: createCampaignMemory(at) },
    targets: { t: target },
    targetEntities: {
      t: {
        id: "t",
        campaignId: "c",
        adGroupId: "g",
        kind: "KEYWORD",
        text: "k",
        status: "ENABLED",
        bidMicros: usd("1"),
      },
    },
  };
  return {
    runId: "run",
    clock: new SimClock(at),
    config: DEFAULT_CONFIG,
    state,
    thresholds: {
      t: deriveThresholds(
        { asin: "A", priceMicros: usd("30"), breakEvenAcos: 0.4 },
        DEFAULT_CONFIG,
      ).thresholds,
    },
    audit: new AuditLog(),
    decisions: [],
    paramsVersion: "v1",
  };
}
const rule = (
  id: RuleDefinition["id"],
  group: RuleDefinition["group"],
  value: string,
): RuleDefinition => ({
  id,
  group,
  schedule: "daily",
  cooldownGate: null,
  cooldownSets: [],
  windowDays: null,
  blockedByTag: [],
  appliesG6: true,
  evaluate: (_ref, ctx) => ({
    proposedState: {
      ...ctx.state,
      targets: {
        ...ctx.state.targets,
        t: { ...ctx.state.targets.t!, baseBidMicros: usd(value) },
      },
    },
  }),
});
it("G5 skips post-guard cent no-op, records audit, returns one decision per object/run", () => {
  const ctx = context();
  const result = firstMatchWins(
    { group: "TARGET", id: "t" },
    [rule("R12", "TARGET", "1.004"), rule("R11", "TARGET", "1.10")],
    ctx,
  );
  expect(result?.ruleId).toBe("R11");
  expect(ctx.audit.events.map((e) => e.outcome)).toEqual([
    "SKIPPED_NOOP",
    "MATCHED",
  ]);
  expect(
    firstMatchWins(
      { group: "TARGET", id: "t" },
      [rule("R10", "TARGET", "1.20")],
      ctx,
    ),
  ).toBeNull();
  expect(ctx.decisions).toHaveLength(1);
  const json = ctx.audit.serializeJSONL();
  expect(
    json
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s)),
  ).toHaveLength(2);
  expect(Object.isFrozen(ctx.audit.events[0]?.inputsSnapshot)).toBe(true);
});
it("G5 rejects campaign/target cross-level base bid conflict without merging", () => {
  const ctx = context();
  expect(
    firstMatchWins(
      { group: "CAMPAIGN", id: "c" },
      [rule("R07", "CAMPAIGN", "1.10")],
      ctx,
    ),
  ).not.toBeNull();
  expect(
    firstMatchWins(
      { group: "TARGET", id: "t" },
      [rule("R11", "TARGET", "1.05")],
      ctx,
    ),
  ).toBeNull();
  expect(ctx.audit.events.at(-1)?.reasons).toContain(
    "CROSS_LEVEL_BID_CONFLICT",
  );
});
it("G5 audits eligibility, tag, cooldown and grace blockers", () => {
  const ctx = context(),
    ref = { group: "CAMPAIGN", id: "c" } as const;
  const r = rule("R06", "CAMPAIGN", "1.10");
  firstMatchWins(ref, [{ ...r, evaluate: () => null }], ctx);
  expect(ctx.audit.events.at(-1)?.outcome).toBe("NOT_ELIGIBLE");
  const memory = ctx.state.campaignMemory.c!;
  const tagged = {
    ...ctx,
    state: {
      ...ctx.state,
      campaignMemory: { c: { ...memory, tag: "ALERT" as const } },
    },
  };
  firstMatchWins(ref, [{ ...r, blockedByTag: ["ALERT"] }], tagged);
  expect(ctx.audit.events.at(-1)?.outcome).toBe("BLOCKED_BY_TAG");
  const cooling = {
    ...ctx,
    state: {
      ...ctx.state,
      campaignMemory: {
        c: {
          ...memory,
          cooldownUntil: {budget:"2026-10-22",placement:null},
        },
      },
    },
  };
  firstMatchWins(ref, [{ ...r, cooldownGate: "budget" }], cooling);
  expect(ctx.audit.events.at(-1)?.outcome).toBe("BLOCKED_BY_COOLDOWN");
  const grace = {
    ...ctx,
    state: {
      ...ctx.state,
      campaignMemory: {
        c: startGrace(memory, ctx.clock.now(), DEFAULT_CONFIG),
      },
    },
  };
  firstMatchWins(ref, [r], grace);
  expect(ctx.audit.events.at(-1)?.outcome).toBe("BLOCKED_BY_GRACE");
});
it("registry preserves all explicit IDs as inert stubs with metadata", () => {
  expect(registry.map((r) => r.id)).toEqual([
    "R01",
    "R02",
    "R03",
    "R04",
    "R04B",
    "R05",
    "R06",
    "R06B",
    "R07",
    "R08",
    "R09",
    "R10",
    "R11",
    "R12",
    "R13",
    "R14",
    "R15",
    "R16",
    "R17",
    "R18",
    "R19",
    "R20",
    "R21",
    "R21B",
  ]);
  for (const r of registry) {
    expect(r).toHaveProperty("windowDays");
    expect(r).toHaveProperty("cooldownGate");
    expect(r).toHaveProperty("blockedByTag");
    expect(r.evaluate({ group: r.group, id: "t" }, context())).toBeNull();
  }
});
it("G5 applies the effective cap when hourly factor changes without a base proposal", () => {
  const ctx = context();
  const t = ctx.state.targets.t!;
  const hourly: RuleDefinition = {
    ...rule("R20", "HOURLY", "1"),
    evaluate: () => ({
      proposedState: {
        ...ctx.state,
        targets: { t: { ...t, hourlyFactor: { ...t.hourlyFactor, 5: 2 } } },
      },
    }),
  };
  const decision = firstMatchWins({ group: "HOURLY", id: "t" }, [hourly], ctx);
  // At 05:00 PT, 2x hourly would exceed 1.5 * 1.08; guard must lower base.
  expect(decision?.after.targets.t?.baseBidMicros).toBe(usd(".81"));
});
it("G5 ignores hourly changes on paused targets and rejects direct outbound writes", () => {
  const ctx = context(),
    e = ctx.state.targetEntities.t!;
  const paused = {
    ...ctx,
    state: {
      ...ctx.state,
      targetEntities: { t: { ...e, status: "PAUSED" as const } },
    },
  };
  expect(
    firstMatchWins(
      { group: "HOURLY", id: "t" },
      [rule("R20", "HOURLY", "1.10")],
      paused,
    ),
  ).toBeNull();
  expect(ctx.audit.events.at(-1)?.reasons).toContain("TARGET_PAUSED");
  const direct = {
    ...rule("R11", "TARGET", "1"),
    evaluate: () => ({
      proposedState: {
        ...ctx.state,
        targetEntities: { t: { ...e, bidMicros: usd("2") } },
      },
    }),
  };
  expect(
    firstMatchWins({ group: "TARGET", id: "t" }, [direct], ctx),
  ).toBeNull();
  expect(ctx.audit.events.at(-1)?.reasons).toContain(
    "DIRECT_OUTBOUND_BID_WRITE",
  );
});
it("audit stores detached, immutable snapshots", () => {
  const ctx = context();
  firstMatchWins(
    { group: "TARGET", id: "t" },
    [rule("R11", "TARGET", "1.1")],
    ctx,
  );
  expect(() => {
    (ctx.audit.events[0]!.reasons as string[]).push("tamper");
  }).toThrow();
  expect(() => {
    (ctx.audit.events as unknown[]).pop();
  }).toThrow();
  expect(ctx.audit.serializeJSONL()).toContain('"paramsVersion":"v1"');
});
it("G5 audits an empty bid range as an error and produces no unsafe decision", () => {
  const ctx = context();
  const bad = {
    ...ctx,
    state: {
      ...ctx.state,
      targets: ctx.state.targets,
      campaigns: { c: { ...ctx.state.campaigns.c!, topOfSearchPct: 900 } },
    },
  };
  expect(
    firstMatchWins(
      { group: "TARGET", id: "t" },
      [rule("R11", "TARGET", "1.1")],
      bad,
    ),
  ).toBeNull();
  expect(ctx.audit.events.at(-1)?.outcome).toBe("ERROR");
  expect(ctx.audit.events.at(-1)?.reasons).toContain("EMPTY_BID_RANGE");
});
it("G5 detects cross-level conflict in reverse order too", () => {
  const ctx = context();
  firstMatchWins(
    { group: "TARGET", id: "t" },
    [rule("R11", "TARGET", "1.1")],
    ctx,
  );
  expect(
    firstMatchWins(
      { group: "CAMPAIGN", id: "c" },
      [rule("R06B", "CAMPAIGN", "1.05")],
      ctx,
    ),
  ).toBeNull();
  expect(ctx.audit.events.at(-1)?.reasons).toContain(
    "CROSS_LEVEL_BID_CONFLICT",
  );
});

it("G5 accepts recovery from manual bid drift and skips movement away", () => {
 const ctx = context();
 const recovery = { ...ctx, state: { ...ctx.state,
   targets: { t: { ...ctx.state.targets.t!, baseBidMicros: usd(".30"), anchorBidMicros: usd("1") } }
 }};
 const result = firstMatchWins({group:"TARGET",id:"t"}, [rule("R10","TARGET",".33")], recovery);
 expect(result?.after.targets.t?.baseBidMicros).toBe(usd(".33"));
 expect(ctx.audit.events.at(-1)?.reasons).toContain("OUTSIDE_ANCHOR_BAND_RECOVERING");
 const away = {...recovery, decisions: [], audit: new AuditLog()};
 expect(firstMatchWins({group:"TARGET",id:"t"}, [rule("R12","TARGET",".24")], away)).toBeNull();
 expect(away.audit.events.at(-1)?.outcome).toBe("SKIPPED_NOOP");
});

// Regression: cooldown belongs to the rule that acted, never the next reader.
it.each([["R12",5],["R14",7],["R10",3]] as const)("%s stamps its bid cooldown after G6", (id, days) => {
 const ctx=context();
 const meta=registry.find(r=>r.id===id)!;
 const decision=firstMatchWins({group:"TARGET",id:"t"},[{...meta,evaluate:rule(id,"TARGET",".90").evaluate}],ctx)!;
 expect(decision.after.targets.t).toMatchObject({bidCooldownUntil:`2026-10-${20+days}`,windowStartAt:ctx.clock.now(),lastBidChangeAt:ctx.clock.now()});
 for(let day=1;day<=days;day++) for(const nextId of ["R11","R10","R14"] as const){
  const next={...context(),state:decision.after,clock:new SimClock(`2026-10-${20+day}T12:00Z`)};
  firstMatchWins({group:"TARGET",id:"t"},[registry.find(r=>r.id===nextId)!],next);
  expect(next.audit.events.at(-1)?.outcome).toBe(day<days?"BLOCKED_BY_COOLDOWN":"NOT_ELIGIBLE");
 }
});
it.each([["R04B",3],["R02",2]] as const)("%s stamps campaign budget cooldown",(id,days)=>{
 const ctx=context(); const meta=registry.find(r=>r.id===id)!;
 const result=firstMatchWins({group:"CAMPAIGN",id:"c"},[{...meta,evaluate:()=>({proposedState:{...ctx.state,campaigns:{c:{...ctx.state.campaigns.c!,dailyBudgetMicros:usd("12")}}}})}],ctx)!;
 expect(result.after.campaignMemory.c).toMatchObject({cooldownUntil:{budget:`2026-10-${20+days}`,placement:null},windowStartAt:ctx.clock.now()});
 for(let day=1;day<=days;day++) for(const nextId of ["R02","R03","R04","R05"] as const){
 const next={...context(),state:result.after,clock:new SimClock(`2026-10-${20+day}T12:00Z`)};
 firstMatchWins({group:"CAMPAIGN",id:"c"},[registry.find(r=>r.id===nextId)!],next);
 expect(next.audit.events.at(-1)?.outcome).toBe(day<days?"BLOCKED_BY_COOLDOWN":"NOT_ELIGIBLE");
 }
});
it("rejects rule writes to engine window fields",()=>{
 const ctx=context(); const r={...rule("R12","TARGET",".9"),evaluate:()=>({proposedState:{...ctx.state,targets:{t:{...ctx.state.targets.t!,windowStartAt:"2026-10-21T12:00Z"}}}})};
 expect(firstMatchWins({group:"TARGET",id:"t"},[r],ctx)).toBeNull();
 expect(ctx.audit.events.at(-1)?.reasons).toContain("RULE_WROTE_ENGINE_FIELD");
});

it("tag gates are optional while emergency and R13 bypass cooldown",()=>{
 for(const enabled of [false,true]) for(const id of ["R06","R06B","R07","R08","R09","R13"] as const){
 const ctx=context(); const meta=registry.find(r=>r.id===id)!;
 const next={...ctx,config:{...DEFAULT_CONFIG,ambiguity:{...DEFAULT_CONFIG.ambiguity,tagRulesGatedByCooldown:enabled}},state:{...ctx.state,campaignMemory:{c:{...ctx.state.campaignMemory.c!,cooldownUntil:{budget:"2026-10-22",placement:null}}}}};
 firstMatchWins({group:meta.group,id:meta.group==="TARGET"?"t":"c"},[meta],next);
 expect(next.audit.events.at(-1)?.outcome).toBe(enabled&&["R07","R08","R09"].includes(id)?"BLOCKED_BY_COOLDOWN":"NOT_ELIGIBLE");
 }
});
it("R07 stamps only the two changed targets and campaign budget",()=>{
 const ctx=context();const t=ctx.state.targets.t!, e=ctx.state.targetEntities.t!;
 const next={...ctx,state:{...ctx.state,targets:{t,u:t,v:t},targetEntities:{t:e,u:{...e,id:"u"},v:{...e,id:"v"}}},thresholds:{t:ctx.thresholds.t!,u:ctx.thresholds.t!,v:ctx.thresholds.t!}};
 const r={...registry.find(r=>r.id==="R07")!,evaluate:()=>({proposedState:{...next.state,targets:{t:{...t,baseBidMicros:usd(".9")},u:{...t,baseBidMicros:usd(".9")},v:t},campaignMemory:{c:{...next.state.campaignMemory.c!,budgetTierIndex:1}}}})};
 const result=firstMatchWins({group:"CAMPAIGN",id:"c"},[r],next)!;
 for(const id of ["t","u"])expect(result.after.targets[id]).toMatchObject({bidCooldownUntil:"2026-10-23",windowStartAt:ctx.clock.now()});
 expect(result.after.targets.v).toEqual(t);
 expect(result.after.campaignMemory.c?.cooldownUntil.budget).toBe("2026-10-23");
});
it("no-op preserves cooldown and audit timestamps without fallback reasons",()=>{
 const ctx=context();
 const r={...registry.find(r=>r.id==="R13")!,evaluate:()=>({proposedState:ctx.state})};
 expect(firstMatchWins({group:"TARGET",id:"t"},[r],ctx)).toBeNull();
 expect(ctx.audit.events.at(-1)).toMatchObject({outcome:"SKIPPED_NOOP",after:ctx.state,reasons:[]});
});
it.each(["targetExpiry","campaignExpiry","campaignWindow"])("rejects engine field write: %s",field=>{
 const ctx=context();let state=ctx.state;
 if(field==="targetExpiry")state={...state,targets:{t:{...state.targets.t!,bidCooldownUntil:"2026-10-25"}}};
 else state={...state,campaignMemory:{c:{...state.campaignMemory.c!,...(field==="campaignExpiry"?{cooldownUntil:{budget:"2026-10-25",placement:null}}:{windowStartAt:"2026-10-21T12:00Z"})}}};
 const r={...registry.find(r=>r.id==="R13")!,evaluate:()=>({proposedState:state})};
 expect(firstMatchWins({group:"TARGET",id:"t"},[r],ctx)).toBeNull();
 expect(ctx.audit.events.at(-1)?.reasons).toEqual(["RULE_WROTE_ENGINE_FIELD"]);
});
it("engine stamps fallback bid cooldown and records why",()=>{
 const ctx=context();const result=firstMatchWins({group:"TARGET",id:"t"},[rule("R11","TARGET",".9")],ctx)!;
 expect(result.after.targets.t?.bidCooldownUntil).toBe("2026-10-23");
 expect(ctx.audit.events.at(-1)?.reasons).toContain("DEFAULT_COOLDOWN_APPLIED");
});
it("placement change stamps seven days and gates both placement rules",()=>{
 const ctx=context(); const r={...registry.find(r=>r.id==="R18")!,evaluate:()=>({proposedState:{...ctx.state,campaigns:{c:{...ctx.state.campaigns.c!,topOfSearchPct:10}}}})};
 const result=firstMatchWins({group:"PLACEMENT",id:"c"},[r],ctx)!;
 expect(result.after.campaignMemory.c).toMatchObject({cooldownUntil:{budget:null,placement:"2026-10-27"},lastChangeAt:{placement:ctx.clock.now()}});
 for(const id of ["R18","R19"] as const)for(const day of [26,27]){
 const next={...context(),state:result.after,clock:new SimClock(`2026-10-${day}T12:00Z`)};
 firstMatchWins({group:"PLACEMENT",id:"c"},[registry.find(r=>r.id===id)!],next);
 expect(next.audit.events.at(-1)?.outcome).toBe(day===26?"BLOCKED_BY_COOLDOWN":"NOT_ELIGIBLE");
 }
});
it("engine derives expiry from PT calendar across DST",()=>{
 const ctx={...context(),clock:new SimClock("2027-03-13T06:00:00-08:00")};
 const result=firstMatchWins({group:"TARGET",id:"t"},[{...registry.find(r=>r.id==="R10")!,evaluate:rule("R10","TARGET",".9").evaluate}],ctx)!;
 expect(result.after.targets.t?.bidCooldownUntil).toBe("2027-03-16");
 expect(isInCooldown(result.after.targets.t!,"bid","2027-03-15T06:00:00-07:00")).toBe(true);
 expect(isInCooldown(result.after.targets.t!,"bid","2027-03-16T06:00:00-07:00")).toBe(false);
});
it("state invariants validate campaign cooldown calendar dates",async()=>{
 const {assertStateInvariants}=await import("../src/domain/state.js");const ctx=context();
 expect(()=>assertStateInvariants({memory:ctx.state.targets.t!,hourNow:5,bidMicros:usd("1"),campaignMemory:{...ctx.state.campaignMemory.c!,cooldownUntil:{budget:"2026-02-30",placement:null}}} as Parameters<typeof assertStateInvariants>[0])).toThrow("INVALID_COOLDOWN");
});
