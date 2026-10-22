import { DateTime } from "luxon";
import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
import type { Hour } from "../domain/entities.js";
export type Instant = string;
export type MarketplaceDate = string;
export interface Clock {
  now(): Instant;
}
export interface MarketplaceConfig {
  readonly id: "US";
  readonly zone: string;
}
export function instant(value: Instant): DateTime {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value))
    throw new RangeError("Instant requires UTC offset");
  const d = DateTime.fromISO(value, { setZone: true });
  if (!d.isValid) throw new RangeError("Invalid instant");
  return d;
}
export function date(
  value: MarketplaceDate,
  zone = DEFAULT_CONFIG.marketplace.zone,
): DateTime {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError("Invalid marketplace date");
  const d = DateTime.fromISO(value, { zone });
  if (!d.isValid) throw new RangeError("Invalid marketplace date");
  return d;
}
export function toMarketplaceDate(
  value: Instant,
  market: MarketplaceConfig = DEFAULT_CONFIG.marketplace,
): MarketplaceDate {
  return instant(value).setZone(market.zone).toISODate()!;
}
export function marketplaceHour(
  value: Instant,
  market: MarketplaceConfig = DEFAULT_CONFIG.marketplace,
): Hour {
  return instant(value).setZone(market.zone).hour as Hour;
}
export function dMinus(today: MarketplaceDate, n: number): MarketplaceDate {
  return date(today).minus({ days: n }).toISODate()!;
}
/** UTC bucket preserves both occurrences of 01:00 during fall-back. */
export function hourlyBucket(value: Instant): Instant {
  return instant(value).toUTC().startOf("hour").toISO()!;
}
export function calendarDaysBetween(
  a: MarketplaceDate,
  b: MarketplaceDate,
  zone = DEFAULT_CONFIG.marketplace.zone,
): number {
  return Math.round(date(b, zone).diff(date(a, zone), "days").days);
}
export type Schedule = "daily" | "every3Days" | "weeklySunday" | "weekly" | "hourBoundary";
export function isScheduled(
  schedule: Schedule,
  now: Instant,
  config: SimConfig,
): boolean {
  const local = instant(now).setZone(config.marketplace.zone);
  // Weekly analysis has no specified weekday; caller dispatches its weekly run.
  if (schedule === "weekly") return true;
  if (schedule === "hourBoundary") return local.minute === 0 && local.second === 0 && local.millisecond === 0;
  return (
    schedule === "daily" ||
    (schedule === "weeklySunday"
      ? local.weekday === 7
      : calendarDaysBetween(
          config.every3DaysAnchor,
          local.toISODate()!,
          config.marketplace.zone,
        ) %
          3 ===
        0)
  );
}
/** Explicit mutable test clock; all conversion/scheduling functions remain pure. */
export class SimClock implements Clock {
  private value: Instant;
  constructor(start: Instant) {
    this.value = instant(start).toUTC().toISO()!;
  }
  now(): Instant {
    return this.value;
  }
  advanceHours(hours: number): void {
    if (!Number.isFinite(hours) || hours < 0)
      throw new RangeError("Clock must advance");
    this.value = instant(this.value).plus({ hours }).toUTC().toISO()!;
  }
}

/** Format an explicit simulation timestamp without reading the ambient clock. */
export function isoFromMillis(value: number): string { return new Date(value).toISOString(); }
