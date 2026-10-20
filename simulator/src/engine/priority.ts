import { roundBidToCent } from "../domain/money.js";
import { scheduled } from "../rules/campaign/shared.js";
import { startGrace } from "./cooldown.js";
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
import { immutableSnapshot, stateDiff, configHash as hashConfig, type AuditOutcome } from "../audit/log.js";
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
  const configHash = hashConfig(ctx.config);
  const record = (ruleId: RuleId, outcome: AuditOutcome, reasons: readonly string[] = [], after: unknown = before): void => {
    if (ctx.config.audit.level === 'matched' && outcome !== 'MATCHED' && outcome !== 'ERROR') return;
    const diff = outcome === 'MATCHED' || outcome === 'ERROR' ? stateDiff(before, after) : {before:{},after:{}};
    ctx.audit.append({runId:ctx.runId, at, marketplaceDate:toMarketplaceDate(at,ctx.config.marketplace),objectRef,ruleId,outcome,reasons,
      inputsSnapshot:{reads:ctx.metrics.recordedReads,paramsVersion:ctx.paramsVersion,configHash,now:at},...diff,paramsVersion:ctx.paramsVersion});
  };
  ctx.metrics.resetReads();
  const entity = before.targetEntities[objectRef.id];
  const campaignId =
    objectRef.group === "CAMPAIGN" || objectRef.group === "PLACEMENT"
      ? objectRef.id
      : (objectRef.campaignId ?? entity?.campaignId);
  const memory = campaignId ? before.campaignMemory[campaignId] : undefined;
  // SPEC-AMBIGUITY: campaign-first suppresses the whole target group, even status-only actions.
  if (objectRef.group === "TARGET" && ctx.config.ambiguity.crossLevelBidPolicy === "campaign-first" &&
      ctx.decisions.some(d => d.runId === ctx.runId && d.objectRef.group === "CAMPAIGN" &&
        ["R06B", "R07", "R09"].includes(d.ruleId) && d.baseBidTargetIds.includes(objectRef.id))) {
    for (const rule of orderedRules) record(rule.id, "SKIPPED_CROSS_LEVEL", ["CROSS_LEVEL_BID_CONFLICT"]);
    return null;
  }
  rules: for (const rule of orderedRules) {
    ctx.metrics.resetReads();
    if (rule.group !== objectRef.group) {
      record(rule.id, "NOT_ELIGIBLE", ["WRONG_RULE_GROUP"]);
      continue;
    }
    if ((objectRef.group === "HOURLY" || objectRef.group === "TARGET") && entity?.status === "PAUSED") {
      record(rule.id, "NOT_ELIGIBLE", ["TARGET_PAUSED"]);
      continue;
    }
    if (rule.schedule === "every3Days" && !scheduled(campaignId ?? objectRef.id, ctx)) {
      record(rule.id, "NOT_SCHEDULED"); continue;
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
    if (campaignId && before.campaigns[campaignId]?.status === "PAUSED") {
      record(rule.id, "NOT_ELIGIBLE", ["CAMPAIGN_PAUSED"]); continue;
    }
    const proposal = rule.evaluate(objectRef, { ...ctx, state: before });
    if (!proposal) {
      record(rule.id, "NOT_ELIGIBLE", rule.diagnose?.(objectRef, { ...ctx, state: before }) ?? []);
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
        old.tagReductionFactor !== next.tagReductionFactor ||
        false
      );
    });
    for (const id of affectedIds) {
      const next = targets[id]!;
      const old = before.targets[id] ?? next;
      const thresholds = ctx.thresholds[id] ?? ctx.thresholdsByCampaign[after.targetEntities[id]!.campaignId];
      if (!(rule.appliesG6 || G6_RULES.includes(rule.id)))
        throw new Error("BID_WRITE_REQUIRES_G6");
      if (!thresholds) throw new Error("MISSING_TARGET_THRESHOLDS");
      const target = after.targetEntities[id],
        campaign = target ? after.campaigns[target.campaignId] : undefined;
      const guard = clampBid(
        {
          oldBase: old.baseBidMicros,
          proposedBase: next.baseBidMicros,
          anchor: old.anchorBidMicros,
          thresholds,
          tosPct: campaign?.topOfSearchPct ?? 0,
          hourlyFactor:
            Math.max(...Object.values(next.hourlyFactor)),
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
      let tagReductionFactor = next.tagReductionFactor;
      if (old.tagReductionFactor !== next.tagReductionFactor &&
          (guard.base !== roundBidToCent(next.baseBidMicros) || (next.tagReductionFactor < old.tagReductionFactor && guard.base === old.baseBidMicros))) {
        // SPEC-AMBIGUITY: Track only the tag change accepted by G6; ordinary cent rounding retains the nominal factor.
        const actual = old.tagReductionFactor * guard.base / old.baseBidMicros;
        tagReductionFactor = Math.max(Math.min(old.tagReductionFactor, next.tagReductionFactor),
          Math.min(Math.max(old.tagReductionFactor, next.tagReductionFactor), actual));
      }
      targets[id] = { ...next, baseBidMicros: guard.base, tagReductionFactor };
    }
    after = { ...after, targets };
    if (rule.id === "R09" && campaignId && after.campaignMemory[campaignId]?.tag === "NORMAL") {
      const pending = Object.entries(targets).some(([id, t]) => after.targetEntities[id]?.campaignId === campaignId && t.tagReductionFactor < 1);
      after = { ...after, campaignMemory: { ...after.campaignMemory, [campaignId]: { ...after.campaignMemory[campaignId]!, bidRestorePending: pending } } };
    }
    if (objectRef.group === "TARGET" && ["R10","R11","R12","R14"].includes(rule.id) && changedBaseIds(before, after).length === 0) {
      record(rule.id, "SKIPPED_NOOP", reasons, before); continue;
    }
    if (stateEqual(before, after) && !proposal.outboundTargets?.length) {
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
    if (rule.id === "R01" && campaignId && campaignMemory[campaignId]) campaignMemory[campaignId] = startGrace(campaignMemory[campaignId]!, at, ctx.config);
    after = { ...after, targets: stampedTargets, campaignMemory };
    const decision: Decision = immutableSnapshot({
      runId: ctx.runId,
      objectRef,
      ruleId: rule.id,
      before,
      after,
      baseBidTargetIds,
      ...(reasons.length ? { reasons } : {}),
      paramsVersion: ctx.paramsVersion,
      ...(proposal.outboundTargets ? { outboundTargets: proposal.outboundTargets } : {}),
    });
    ctx.decisions.push(decision);
    for (const event of proposal.notifications ?? []) ctx.notify(event);
    record(rule.id, "MATCHED", reasons, after);
    return decision;
  }
  return null;
}
