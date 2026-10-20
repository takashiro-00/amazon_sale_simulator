import type {
  EngineState,
  RuleId,
  RuleDefinition,
  RuleContext,
  ObjectRef,
  Decision,
} from "./types.js";
import { isInCooldown, isGraceBlocked, applyResetOnEffectiveChange, type CooldownKind } from "./cooldown.js";
import { marketplaceHour, toMarketplaceDate, instant } from "../time/clock.js";
import { clampBid, G6_RULES } from "../guards/bid.js";
import { immutableSnapshot, type AuditOutcome } from "../audit/log.js";
export const CAMPAIGN = [
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
] as const;
export const TARGET = ["R13", "R12", "R11", "R10", "R14"] as const;
export const SEARCHTERM = ["R15", "R16", "R17"] as const;
export const PLACEMENT = ["R19", "R18"] as const;
export const HOURLY = ["R20", "R21"] as const;
/** Structural equality independent of object property insertion order. */
export function stateEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return false;
  const ak = Object.keys(a).sort(),
    bk = Object.keys(b).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) =>
    stateEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}
function changedBaseIds(before: EngineState, after: EngineState): string[] {
  return Object.keys(after.targets).filter(
    (id) =>
      before.targets[id]?.baseBidMicros !== after.targets[id]?.baseBidMicros,
  );
}
export function firstMatchWins(
  objectRef: ObjectRef,
  orderedRules: readonly RuleDefinition[],
  ctx: RuleContext,
): Decision | null {
  if (
    ctx.decisions.some(
      (d) =>
        d.runId === ctx.runId &&
        d.objectRef.id === objectRef.id &&
        d.objectRef.group === objectRef.group,
    )
  )
    return null;
  const at = ctx.clock.now(),
    before = immutableSnapshot(ctx.state);
  const inputsSnapshot = {
    state: before,
    thresholds: ctx.thresholds,
    config: ctx.config,
    now: at,
  };
  const record = (
    ruleId: RuleId,
    outcome: AuditOutcome,
    reasons: readonly string[] = [],
    after: unknown = before,
  ): void =>
    ctx.audit.append({
      runId: ctx.runId,
      at,
      marketplaceDate: toMarketplaceDate(at, ctx.config.marketplace),
      objectRef,
      ruleId,
      outcome,
      reasons,
      inputsSnapshot,
      before,
      after,
      paramsVersion: ctx.paramsVersion,
    });
  const entity = before.targetEntities[objectRef.id];
  const campaignId =
    objectRef.group === "CAMPAIGN" || objectRef.group === "PLACEMENT"
      ? objectRef.id
      : (objectRef.campaignId ?? entity?.campaignId);
  const memory = campaignId ? before.campaignMemory[campaignId] : undefined;
  rules: for (const rule of orderedRules) {
    if (rule.group !== objectRef.group) {
      record(rule.id, "NOT_ELIGIBLE", ["WRONG_RULE_GROUP"]);
      continue;
    }
    if (objectRef.group === "HOURLY" && entity?.status === "PAUSED") {
      record(rule.id, "NOT_ELIGIBLE", ["TARGET_PAUSED"]);
      continue;
    }
    if (memory && rule.blockedByTag.includes(memory.tag)) {
      record(rule.id, "BLOCKED_BY_TAG");
      continue;
    }
    if (memory && isGraceBlocked(rule.id, memory, at)) {
      record(rule.id, "BLOCKED_BY_GRACE");
      continue;
    }
    // SPEC-AMBIGUITY: Scheduled tag rules default to no cooldown gate.
    const gate = ctx.config.ambiguity.tagRulesGatedByCooldown && ["R07", "R08", "R09"].includes(rule.id)
      ? "budget" : rule.cooldownGate;
    if (gate) {
      const m =
        gate === "bid" ? before.targets[objectRef.id] : memory;
      if (m && isInCooldown(m, gate, at, ctx.config)) {
        record(rule.id, "BLOCKED_BY_COOLDOWN");
        continue;
      }
    }
    const proposal = rule.evaluate(objectRef, { ...ctx, state: before });
    if (!proposal) {
      record(rule.id, "NOT_ELIGIBLE");
      continue;
    }
    let after = immutableSnapshot(proposal.proposedState);
    const reasons = [...(proposal.reasons ?? [])];
    const wroteEngineField = Object.entries(before.targets).some(([id, old]) => {
      const next = after.targets[id];
      return next && (!stateEqual(old.bidCooldownUntil, next.bidCooldownUntil) || old.windowStartAt !== next.windowStartAt || old.lastBidChangeAt !== next.lastBidChangeAt);
    }) || Object.entries(before.campaignMemory).some(([id, old]) => {
      const next = after.campaignMemory[id];
      return next && (!stateEqual(old.cooldownUntil, next.cooldownUntil) || old.windowStartAt !== next.windowStartAt || !stateEqual(old.lastChangeAt, next.lastChangeAt));
    });
    if (wroteEngineField) {
      record(rule.id, "ERROR", ["RULE_WROTE_ENGINE_FIELD"], after);
      continue;
    }

    // The engine never accepts a rule writing an outbound entity bid directly.
    if (
      Object.keys(after.targetEntities).some(
        (id) =>
          before.targetEntities[id] &&
          after.targetEntities[id]?.bidMicros !==
            before.targetEntities[id]?.bidMicros,
      )
    ) {
      record(rule.id, "ERROR", ["DIRECT_OUTBOUND_BID_WRITE"], after);
      continue;
    }
    const targets = { ...after.targets };
    const affectedIds = Object.keys(after.targets).filter((id) => {
      const old = before.targets[id],
        next = after.targets[id],
        campaignId = before.targetEntities[id]?.campaignId;
      return (
        !old ||
        !next ||
        old.baseBidMicros !== next.baseBidMicros ||
        !stateEqual(old.hourlyFactor, next.hourlyFactor) ||
        (campaignId !== undefined &&
          before.campaigns[campaignId]?.topOfSearchPct !==
            after.campaigns[campaignId]?.topOfSearchPct)
      );
    });
    for (const id of affectedIds) {
      const old = before.targets[id],
        next = targets[id],
        thresholds = ctx.thresholds[id];
      if (!old || !next) throw new Error("TARGET_CREATION_REQUIRES_LATER_STEP");
      if (!(rule.appliesG6 || G6_RULES.includes(rule.id)))
        throw new Error("BID_WRITE_REQUIRES_G6");
      if (!thresholds) throw new Error("MISSING_TARGET_THRESHOLDS");
      const target = before.targetEntities[id],
        campaign = target ? after.campaigns[target.campaignId] : undefined;
      const guard = clampBid(
        {
          oldBase: old.baseBidMicros,
          proposedBase: next.baseBidMicros,
          anchor: old.anchorBidMicros,
          thresholds,
          tosPct: campaign?.topOfSearchPct ?? 0,
          hourlyFactor:
            next.hourlyFactor[marketplaceHour(at, ctx.config.marketplace)],
          ruleId: rule.id,
        },
        ctx.config,
      );
      reasons.push(...guard.reasons);
      // SPEC-AMBIGUITY: Empty-range fallback is diagnostic only; reject the decision rather than send an invalid bid.
      if (
        guard.base === null
      ) {
        record(rule.id, "ERROR", reasons, after);
        continue rules;
      }
      targets[id] = { ...next, baseBidMicros: guard.base };
    }
    after = { ...after, targets };
    if (stateEqual(before, after)) {
      record(rule.id, "SKIPPED_NOOP", reasons, after);
      continue;
    }
    const baseBidTargetIds = changedBaseIds(before, after);
    // SPEC-AMBIGUITY: Step 1 only detects cross-level conflicts; merge policies are deferred to Step 4.
    const campaignBidRules: readonly RuleId[] = ["R06B", "R07", "R09"];
    const conflict = ctx.decisions.some(
      (d) =>
        d.runId === ctx.runId &&
        d.baseBidTargetIds.some((id) => baseBidTargetIds.includes(id)) &&
        ((objectRef.group === "TARGET" &&
          d.objectRef.group === "CAMPAIGN" &&
          campaignBidRules.includes(d.ruleId)) ||
          (objectRef.group === "CAMPAIGN" &&
            campaignBidRules.includes(rule.id) &&
            d.objectRef.group === "TARGET")),
    );
    if (conflict) {
      record(rule.id, "ERROR", ["CROSS_LEVEL_BID_CONFLICT"], after);
      return null;
    }
    const cooldownDate = (kind: CooldownKind): string => {
      const configured = rule.cooldownSets.find((entry) => entry.kind === kind);
      if (!configured) reasons.push("DEFAULT_COOLDOWN_APPLIED");
      return instant(at).setZone(ctx.config.marketplace.zone)
        .plus({ days: configured?.days ?? ctx.config.cooldown[kind] }).toISODate()!;
    };
    const stampedTargets = { ...after.targets };
    for (const id of baseBidTargetIds) {
      stampedTargets[id] = {
        ...applyResetOnEffectiveChange(stampedTargets[id]!, "bid", at, true, ctx.config),
        bidCooldownUntil: cooldownDate("bid"),
      };
    }
    const campaignMemory = { ...after.campaignMemory };
    for (const [id, campaign] of Object.entries(after.campaigns)) {
      for (const kind of ["budget", "placement"] as const) {
        const changed = kind === "budget"
          ? campaign.dailyBudgetMicros !== before.campaigns[id]?.dailyBudgetMicros || after.campaignMemory[id]?.budgetTierIndex !== before.campaignMemory[id]?.budgetTierIndex
          : campaign.topOfSearchPct !== before.campaigns[id]?.topOfSearchPct;
        if (changed && campaignMemory[id]) {
          const reset = applyResetOnEffectiveChange(campaignMemory[id]!, kind, at, true, ctx.config);
          campaignMemory[id] = { ...reset, cooldownUntil: { ...reset.cooldownUntil, [kind]: cooldownDate(kind) } };
        }
      }
    }
    after = { ...after, targets: stampedTargets, campaignMemory };
    const decision: Decision = immutableSnapshot({
      runId: ctx.runId,
      objectRef,
      ruleId: rule.id,
      before,
      after,
      baseBidTargetIds,
      paramsVersion: ctx.paramsVersion,
    });
    ctx.decisions.push(decision);
    record(rule.id, "MATCHED", reasons, after);
    return decision;
  }
  return null;
}
