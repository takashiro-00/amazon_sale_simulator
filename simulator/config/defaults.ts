import { usd, type Micros } from "../src/domain/money.js";
export interface SimConfig {
  readonly audit: { readonly level: "matched" | "all" };
  readonly thresholds: { readonly r10r11Clicks: number; readonly hourlyClicks: number };
  readonly hourlyAnalysisWeekday: number;
  readonly product: {
    readonly expCvr: number;
    readonly winCap: number;
    readonly okCap: number;
    readonly badCap: number;
    readonly winFactor: number;
    readonly okFactor: number;
    readonly badFactor: number;
    readonly spendFactor: number;
    readonly spendMin: Micros;
    readonly spendMax: Micros;
    readonly n2Orders: number;
    readonly n3Orders: number;
    readonly n17Factor: number;
  };
  readonly bid: {
    readonly min: Micros;
    readonly max: Micros;
    readonly changeCap: number;
    readonly anchorMin: number;
    readonly anchorMax: number;
    readonly tosCap: number;
    readonly tagMinFactor: number;
  };
  readonly cooldown: {
    readonly bid: number;
    readonly r12: number;
    readonly budget: number;
    readonly placement: number;
  };
  readonly graceDays: number;
  readonly maturityLagDays: number;
  readonly maxPostDays: number;
  readonly budgetLadder: readonly Micros[];
  readonly marketplace: { readonly id: "US"; readonly zone: string };
  readonly every3DaysAnchor: string;
  readonly every3DaysAnchorMode: "campaign-created" | "global";
  readonly ambiguity: {
    readonly placementWindow: "post14-min7";
    readonly hourlyScope: "campaign" | "target";
    readonly r14CountResetAfterFlag: boolean;
    /** Runs occur before traffic; include the change day. */ readonly changeDayCountsAsPost: boolean;
    readonly tagRulesGatedByCooldown: boolean;
    /** Step 1 detects conflicts; policies reserved for Step 4. */ readonly crossLevelBidPolicy:
      | "campaign-first"
      | "error";
    /** Include hourly multipliers in the effective ToS cap. */ readonly tosCapIncludesHourly: boolean;
    /** Reset only the changed entity unless explicitly configured later. */ readonly windowResetScope:
      | "entity"
      | "campaign-and-children";
    readonly r09BudgetRestore: "pre-tag-tier" | "keep-current";
    readonly r06bWindow: "calendar14" | "wpost14";
    readonly anchorResetPolicy: "never" | "on-r15-create" | "on-params-change";
    readonly r06bOverwritesPreTagTier: boolean;
    /** Spec says 22 but explicitly names 24 distinct IDs. Preserve all IDs. */ readonly registryIds: "all-explicit";
    /** Empty intervals cannot satisfy G6, so no executable decision is emitted. */ readonly emptyBidRangePolicy: "reject-decision";
    /** Intraday facts require a UTC bucket to disambiguate repeated local hours. */ readonly repeatedHourPolicy: "require-utc-bucket";
    /** Missing daily coverage cannot prove zero orders. */ readonly missingZeroOrderDays: "ineligible";
  };
}
export const DEFAULT_CONFIG: SimConfig = Object.freeze({
  audit: Object.freeze({ level: "all" as const }),
  thresholds: Object.freeze({ r10r11Clicks: 15, hourlyClicks: 40 }),
  hourlyAnalysisWeekday: 1,
  product: Object.freeze({
    expCvr: 0.1,
    winCap: 0.3,
    okCap: 0.4,
    badCap: 0.5,
    winFactor: 0.7,
    okFactor: 0.9,
    badFactor: 1.1,
    spendFactor: 2.5,
    spendMin: usd("10"),
    spendMax: usd("40"),
    n2Orders: 2,
    n3Orders: 3,
    n17Factor: 0.6,
  }),
  bid: Object.freeze({
    min: usd(".20"),
    max: usd("3"),
    changeCap: 0.2,
    anchorMin: 0.5,
    anchorMax: 2,
    tosCap: 1.5,
    tagMinFactor: 0.7,
  }),
  cooldown: Object.freeze({ bid: 3, r12: 5, budget: 2, placement: 7 }),
  graceDays: 3,
  maturityLagDays: 2,
  maxPostDays: 30,
  budgetLadder: Object.freeze(
    ["5", "8", "10", "12", "14.40", "17.28", "20.74", "24.88", "25"].map(usd),
  ),
  marketplace: Object.freeze({
    id: "US" as const,
    zone: "America/Los_Angeles",
  }),
  every3DaysAnchor: "2026-01-01",
  // SPEC-AMBIGUITY: Campaign creation anchors tag checks unless global is explicitly selected.
  every3DaysAnchorMode: "campaign-created",
  ambiguity: Object.freeze({
    placementWindow: "post14-min7" as const,
    hourlyScope: "campaign" as const,
    r14CountResetAfterFlag: true,
    changeDayCountsAsPost: true,
    tagRulesGatedByCooldown: false,
    crossLevelBidPolicy: "campaign-first" as const,
    tosCapIncludesHourly: true,
    windowResetScope: "entity" as const,
    // SPEC-AMBIGUITY: Restore exactly the saved tier, rather than estimating a new budget.
    r09BudgetRestore: "pre-tag-tier" as const,
    r06bWindow: "calendar14" as const,
    anchorResetPolicy: "never" as const,
    r06bOverwritesPreTagTier: false,
    registryIds: "all-explicit" as const,
    emptyBidRangePolicy: "reject-decision" as const,
    repeatedHourPolicy: "require-utc-bucket" as const,
    missingZeroOrderDays: "ineligible" as const,
  }),
});
