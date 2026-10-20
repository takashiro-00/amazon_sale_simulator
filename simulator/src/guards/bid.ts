import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
import {
  micros,
  scaleMoney,
  roundBidToCent,
  MICROS_PER_CENT,
  type Micros,
} from "../domain/money.js";
import type { DerivedThresholds } from "../domain/params.js";
import type { RuleId } from "../engine/types.js";
export const G6_RULES: readonly RuleId[] = [
  "R06B",
  "R07",
  "R09",
  "R10",
  "R11",
  "R12",
  "R14",
  "R15",
  "R18",
  "R20",
  "R21",
  "R21B",
];
export interface ClampBidInput {
  readonly oldBase: Micros;
  readonly proposedBase: Micros;
  readonly anchor: Micros;
  readonly thresholds: DerivedThresholds;
  readonly tosPct: number;
  readonly hourlyFactor: number;
  readonly ruleId: RuleId;
}
export function clampBid(
  input: ClampBidInput,
  config: SimConfig = DEFAULT_CONFIG,
): { base: Micros | null; reasons: string[]; warnings: string[] } {
  const {
      oldBase,
      proposedBase,
      anchor,
      thresholds,
      tosPct,
      hourlyFactor,
      ruleId,
    } = input,
    c = config.bid;
  if (
    oldBase <= 0 ||
    anchor <= 0 ||
    !Number.isInteger(tosPct) ||
    tosPct < 0 ||
    tosPct > 900 ||
    !Number.isFinite(hourlyFactor) ||
    hourlyFactor <= 0
  )
    throw new RangeError("Invalid bid guard input");

  // Hard product/ToS bounds always win over soft anchor and step bounds.
  const effectiveMultiplier =
    (1 + tosPct / 100) *
    (config.ambiguity.tosCapIncludesHourly ? hourlyFactor : 1);
  const tosUpper = scaleMoney(thresholds.Bid_max, c.tosCap / effectiveMultiplier, "floor");
  const hardLow = Math.ceil(thresholds.Bid_min / MICROS_PER_CENT) * MICROS_PER_CENT;
  const hardHigh = Math.floor(Math.min(thresholds.Bid_max, tosUpper) / MICROS_PER_CENT) * MICROS_PER_CENT;
  if (hardLow > hardHigh)
    return { base: null, reasons: ["EMPTY_BID_RANGE"], warnings: ["EMPTY_BID_RANGE"] };
  const anchorLow = scaleMoney(anchor, c.anchorMin, "ceil");
  const anchorHigh = scaleMoney(anchor, c.anchorMax, "floor");
  const reasons: string[] = [];
  let lower: number = oldBase < anchorLow ? oldBase : anchorLow;
  let upper: number = oldBase > anchorHigh ? oldBase : anchorHigh;
  if (oldBase < anchorLow || oldBase > anchorHigh)
    reasons.push("OUTSIDE_ANCHOR_BAND_RECOVERING");
  if (!["R20", "R21", "R21B"].includes(ruleId)) {
    const stepLow = scaleMoney(oldBase, 1 - c.changeCap, "ceil");
    const stepHigh = scaleMoney(oldBase, 1 + c.changeCap, "floor");
    if (proposedBase < stepLow || proposedBase > stepHigh) reasons.push("PER_CHANGE_CAP");
    lower = Math.max(lower, stepLow);
    upper = Math.min(upper, stepHigh);
  }
  // Project the soft interval into the hard interval. A hard correction may exceed 20%.
  lower = Math.max(hardLow, Math.min(hardHigh, lower));
  upper = Math.max(hardLow, Math.min(hardHigh, upper));
  const centLow = Math.ceil(lower / MICROS_PER_CENT) * MICROS_PER_CENT;
  const centHigh = Math.floor(upper / MICROS_PER_CENT) * MICROS_PER_CENT;
  // A sub-cent soft interval must never be reported as an empty hard range.
  if (centLow > centHigh) {
    const base = micros(Math.max(hardLow, Math.min(hardHigh, roundBidToCent(oldBase))));
    return { base, reasons, warnings: [] };
  }
  if (
    proposedBase < scaleMoney(anchor, c.anchorMin) ||
    proposedBase > scaleMoney(anchor, c.anchorMax)
  )
    reasons.push("ANCHOR_CAP");
  if (proposedBase < thresholds.Bid_min || proposedBase > thresholds.Bid_max)
    reasons.push("PRODUCT_BID_CAP");
  if (proposedBase > tosUpper) reasons.push("TOS_CAP");
  const base = micros(
    Math.max(
      centLow,
      Math.min(
        centHigh,
        roundBidToCent(micros(Math.max(lower, Math.min(upper, proposedBase)))),
      ),
    ),
  );
  return { base, reasons, warnings: [] };
}
