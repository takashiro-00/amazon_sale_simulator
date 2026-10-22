import { micros, scaleMoney, roundBidToCent, type Micros } from "./money.js";
import type { Acos } from "./acos.js";
import type { Hour } from "./entities.js";
import { date, instant, type MarketplaceDate, type Instant } from "../time/clock.js";
import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
export type CampaignTag = "NORMAL" | "MANAGE" | "ALERT" | "PAUSED_AUTO";
export interface CampaignMemory {
  readonly budgetByDate: Readonly<Record<MarketplaceDate, Micros>>;
  readonly createdAt: Instant;
  readonly bidRestorePending: boolean;
  readonly lastR09CheckDate: MarketplaceDate | null;
  readonly tag: CampaignTag;
  readonly budgetTierIndex: number;
  readonly preTagTierIndex: number | null;
  readonly baselineAcos: Acos | null;
  readonly cooldownUntil: { readonly budget: MarketplaceDate | null; readonly placement: MarketplaceDate | null };
  readonly lastChangeAt: {
    readonly budget: Instant | null;
    readonly placement: Instant | null;
    readonly status: Instant | null;
  };
  readonly windowStartAt: Instant;
  readonly taggedAt: Instant | null;
  readonly graceUntil: Instant | null;
  readonly r06bPhase: "NONE" | "STEP1_WAITING" | "DONE";
  readonly r06bStep1At: Instant | null;
  readonly r09ConsecutivePasses: number;
  readonly tosBoostPct: number;
  readonly pausedAutoReason: string | null;
  readonly requiresUserConfirmToEnable: boolean;
}
export interface TargetMemory {
  readonly createdAt?: Instant;
  readonly baseBidMicros: Micros;
  readonly anchorBidMicros: Micros;
  readonly tagReductionFactor: number;
  readonly tagRestoreRemaining: Micros;
  readonly hourlyFactor: Readonly<Record<Hour, number>>;
  readonly wasteFlagUntil: Instant | null;
  readonly lowImpressionFlagUntil: Instant | null;
  readonly r12Count: number;
  readonly r12LastAt: Instant | null;
  readonly clicksAtLastR12: number;
  readonly r14Count: number;
  readonly r14LastAt: Instant | null;
  readonly lastBidChangeAt: Instant | null;
  readonly bidCooldownUntil: MarketplaceDate | null;
  readonly windowStartAt: Instant;
}
export function createCampaignMemory(
  at: Instant,
  config: SimConfig = DEFAULT_CONFIG,
): CampaignMemory {
  if (config.budgetLadder.length === 0)
    throw new RangeError("Empty budget ladder");
  return {
    budgetByDate: {},
    createdAt: at,
    bidRestorePending: false,
    lastR09CheckDate: null,
    tag: "NORMAL",
    budgetTierIndex: 0,
    preTagTierIndex: null,
    baselineAcos: null,
    cooldownUntil: { budget: null, placement: null },
    lastChangeAt: { budget: null, placement: null, status: null },
    windowStartAt: at,
    taggedAt: null,
    graceUntil: null,
    r06bPhase: "NONE",
    r06bStep1At: null,
    r09ConsecutivePasses: 0,
    tosBoostPct: 0,
    pausedAutoReason: null,
    requiresUserConfirmToEnable: false,
  };
}
export function createTargetMemory(
  base: Micros,
  at: Instant,
  config: SimConfig,
): TargetMemory {
  return {
    createdAt: at,
    baseBidMicros: base,
    anchorBidMicros: base,
    tagReductionFactor: 1,
    tagRestoreRemaining: micros(0),
    hourlyFactor: Object.fromEntries(
      Array.from({ length: 24 }, (_, h) => [h, 1]),
    ) as Record<Hour, number>,
    wasteFlagUntil: null,
    lowImpressionFlagUntil: null,
    r12Count: 0,
    r12LastAt: null,
    clicksAtLastR12: 0,
    r14Count: 0,
    r14LastAt: null,
    lastBidChangeAt: null,
    bidCooldownUntil: null,
    windowStartAt: at,
  };
}
export function submittedBid(memory: TargetMemory, hour: Hour): Micros {
  return roundBidToCent(
    scaleMoney(memory.baseBidMicros, memory.hourlyFactor[hour]),
  );
}
export function assertStateInvariants(
  state: {
    readonly memory: TargetMemory;
    readonly campaignMemory?: CampaignMemory;
    readonly hourNow: Hour;
    readonly bidMicros: Micros;
  },
  config: SimConfig = DEFAULT_CONFIG,
): void {
  const m = state.memory;
  if (
    m.tagReductionFactor < config.bid.tagMinFactor ||
    m.tagReductionFactor > 1 ||
    m.tagRestoreRemaining < 0 ||
    m.baseBidMicros <= 0 ||
    m.anchorBidMicros <= 0 ||
    !Number.isFinite(m.tagReductionFactor)
  )
    throw new Error("INVALID_TARGET_MEMORY");
  for (let h = 0; h < 24; h++) {
    const f = m.hourlyFactor[h as Hour];
    if (!Number.isFinite(f) || f <= 0) throw new Error("INVALID_HOURLY_FACTOR");
  }
  for (const n of [m.r12Count, m.r14Count, m.clicksAtLastR12])
    if (!Number.isInteger(n) || n < 0) throw new Error("INVALID_COUNTER");
  const cooldownDates = [m.bidCooldownUntil];
  if (state.campaignMemory) {
    const c = state.campaignMemory;
    instant(c.createdAt);
    if (typeof c.bidRestorePending !== "boolean" || !Number.isInteger(c.r09ConsecutivePasses) || c.r09ConsecutivePasses < 0)
      throw new Error("INVALID_CAMPAIGN_MEMORY");
    if (c.lastR09CheckDate !== null) date(c.lastR09CheckDate, config.marketplace.zone);
    if (Object.keys(c.budgetByDate).length > 35) throw new Error("INVALID_BUDGET_HISTORY");
    for (const [day, budget] of Object.entries(c.budgetByDate)) {
      date(day, config.marketplace.zone);
      if (!config.budgetLadder.includes(budget)) throw new Error("INVALID_BUDGET_HISTORY");
    }
  }
  if (state.campaignMemory) cooldownDates.push(state.campaignMemory.cooldownUntil.budget, state.campaignMemory.cooldownUntil.placement);
  for (const until of cooldownDates) if (until !== null) {
    try { date(until, config.marketplace.zone); }
    catch { throw new Error("INVALID_COOLDOWN"); }
  }
  if (submittedBid(m, state.hourNow) !== state.bidMicros)
    throw new Error("OUTBOUND_BID_INVARIANT");
}
