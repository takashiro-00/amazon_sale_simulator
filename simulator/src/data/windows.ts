import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
import {
  toMarketplaceDate,
  dMinus,
  calendarDaysBetween,
  type Instant,
  type MarketplaceDate,
} from "../time/clock.js";
export type WindowSpec = {
  readonly kind: "rolling" | "post";
  readonly days: number;
};
export interface ResolvedWindow {
  readonly from: MarketplaceDate;
  readonly to: MarketplaceDate;
  readonly ripeDays: number;
  readonly eligible: boolean;
}
export function resolveWindow(
  spec: WindowSpec,
  today: MarketplaceDate,
  memory: { readonly windowStartAt: Instant },
  config: SimConfig = DEFAULT_CONFIG,
): ResolvedWindow {
  if (
    !Number.isInteger(spec.days) ||
    spec.days <= 0 ||
    spec.days > config.maxPostDays
  )
    throw new RangeError("Invalid window days");
  const to = dMinus(today, config.maturityLagDays),
    changed = toMarketplaceDate(memory.windowStartAt, config.marketplace);
  // SPEC-AMBIGUITY: Change day counts by default: the run occurs before that day’s traffic.
  const postFrom = dMinus(
    changed,
    config.ambiguity.changeDayCountsAsPost ? 0 : -1,
  );
  const naturalFrom = dMinus(
    to,
    (spec.kind === "rolling" ? spec.days : config.maxPostDays) - 1,
  );
  const from = postFrom > naturalFrom ? postFrom : naturalFrom;
  const ripeDays = Math.max(
    0,
    calendarDaysBetween(from, to, config.marketplace.zone) + 1,
  );
  return { from, to, ripeDays, eligible: ripeDays >= spec.days };
}
