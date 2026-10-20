import type { CampaignMemory, TargetMemory } from "../domain/state.js";
import {
  instant,
  toMarketplaceDate,

  type Instant,
} from "../time/clock.js";
import { DEFAULT_CONFIG, type SimConfig } from "../../config/defaults.js";
import type { RuleId } from "./types.js";
export type CooldownKind = "bid" | "budget" | "placement";
export const GRACE_BLOCKED_RULES: readonly RuleId[] = [
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
];
export function isInCooldown(
  memory: CampaignMemory | TargetMemory,
  kind: CooldownKind,
  now: Instant,
  config: SimConfig = DEFAULT_CONFIG,
): boolean {
  const until = kind === "bid"
    ? ("bidCooldownUntil" in memory ? memory.bidCooldownUntil : undefined)
    : ("cooldownUntil" in memory ? memory.cooldownUntil[kind] : undefined);
  if (until === undefined) throw new Error("Cooldown memory kind mismatch");
  return until !== null && toMarketplaceDate(now, config.marketplace) < until;
}
export function isInGrace(memory: CampaignMemory, now: Instant): boolean {
  return (
    memory.graceUntil !== null &&
    instant(now).toMillis() < instant(memory.graceUntil).toMillis()
  );
}
export function isGraceBlocked(
  rule: RuleId,
  memory: CampaignMemory,
  now: Instant,
): boolean {
  return GRACE_BLOCKED_RULES.includes(rule) && isInGrace(memory, now);
}
export function startGrace(
  memory: CampaignMemory,
  now: Instant,
  config: SimConfig,
): CampaignMemory {
  return {
    ...memory,
    windowStartAt: now,
    graceUntil: instant(now)
      .setZone(config.marketplace.zone)
      .plus({ days: config.graceDays })
      .toUTC()
      .toISO()!,
  };
}
export function applyResetOnEffectiveChange<
  T extends CampaignMemory | TargetMemory,
>(
  memory: T,
  kind: CooldownKind,
  now: Instant,
  effectiveChange: boolean,
  config: SimConfig = DEFAULT_CONFIG,
): T {
  if (!effectiveChange) return memory;
  // SPEC-AMBIGUITY: Entity-only reset here; campaign-and-children propagation needs an explicit hierarchy in Step 4.
  if (config.ambiguity.windowResetScope !== "entity")
    throw new Error("RESET_SCOPE_REQUIRES_HIERARCHY");
  if (kind === "bid") {
    if (!("lastBidChangeAt" in memory))
      throw new Error("Bid reset requires target memory");
    return { ...memory, lastBidChangeAt: now, windowStartAt: now };
  }
  if (!("lastChangeAt" in memory))
    throw new Error("Campaign reset requires campaign memory");
  return {
    ...memory,
    lastChangeAt: { ...memory.lastChangeAt, [kind]: now },
    windowStartAt: now,
  };
}
