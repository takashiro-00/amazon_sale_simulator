import type { RuleContext, Proposal, NotificationLog } from '../../engine/types.js';
import type { CampaignMemory, CampaignTag } from '../../domain/state.js';
import { resolveWindow } from '../../data/windows.js';
import { applyTag, removeTag } from '../../api/tags.js';
import { scaleMoney } from '../../domain/money.js';
import { calendarDaysBetween, toMarketplaceDate, isScheduled } from '../../time/clock.js';
export function scheduled(id: string, ctx: RuleContext) {
    const m = ctx.state.campaignMemory[id];
    return isScheduled('every3Days', ctx.clock.now(), { ...ctx.config, every3DaysAnchor: ctx.config.every3DaysAnchorMode === 'campaign-created' && m ? toMarketplaceDate(m.createdAt, ctx.config.marketplace) : ctx.config.every3DaysAnchor });
}
export function age(at: string, ctx: RuleContext) { return calendarDaysBetween(toMarketplaceDate(at, ctx.config.marketplace), ctx.today, ctx.config.marketplace.zone); }
export function window(id: string, ctx: RuleContext, days: number, post = false, minRipeDays = days, at?: string) {
    const m = ctx.state.campaignMemory[id]!;
    const w = resolveWindow({ kind: post ? 'post' : 'rolling', days, minRipeDays }, ctx.today, { windowStartAt: at ?? m.windowStartAt }, ctx.config);
    return { ...ctx.metrics.campaignWindow(id, w), eligible: w.eligible, w };
}
export function base(id: string, ctx: RuleContext) { const m = ctx.state.campaignMemory[id]!; return Math.min(m.baselineAcos?.kind === 'value' ? m.baselineAcos.v : ctx.thresholdsByCampaign[id]!.T_ok, ctx.thresholdsByCampaign[id]!.T_ok); }
export function propose(id: string, ctx: RuleContext, patch: Partial<CampaignMemory>, tier?: number, tag?: CampaignTag, bidFactor?: number, notification?: NotificationLog['type']): Proposal {
    const old = ctx.state.campaignMemory[id]!;
    const memory = { ...old, ...patch, ...(tier === undefined ? {} : { budgetTierIndex: tier }), ...(tag ? { tag } : {}) };
    const c = ctx.state.campaigns[id]!;
    const campaign = { ...c, ...(tier === undefined ? {} : { dailyBudgetMicros: ctx.config.budgetLadder[tier]! }), ...(tag ? { name: tag === 'PAUSED_AUTO' ? removeTag(c.name) : applyTag(c.name, tag) } : {}), ...(tag === 'PAUSED_AUTO' ? { status: 'PAUSED' as const } : {}) };
    const targets = { ...ctx.state.targets };
    if (bidFactor !== undefined)
        for (const [tid, t] of Object.entries(targets))
            if (ctx.state.targetEntities[tid]?.campaignId === id && (bidFactor > 1 || ctx.state.targetEntities[tid]?.status === 'ENABLED')) {
                const f = bidFactor > 1 ? Math.min(1, t.tagReductionFactor * bidFactor) : Math.max(ctx.config.bid.tagMinFactor, t.tagReductionFactor * bidFactor);
                targets[tid] = { ...t, tagReductionFactor: f, baseBidMicros: scaleMoney(t.baseBidMicros, f / t.tagReductionFactor) };
            }
    if (bidFactor !== undefined && bidFactor > 1)
        memory.bidRestorePending = Object.entries(targets).some(([tid, t]) => ctx.state.targetEntities[tid]?.campaignId === id && t.tagReductionFactor < 1);
    return { proposedState: { ...ctx.state, campaigns: { ...ctx.state.campaigns, [id]: campaign }, campaignMemory: { ...ctx.state.campaignMemory, [id]: memory }, targets }, ...(notification ? { notifications: [{ at: ctx.clock.now(), campaignId: id, type: notification, details: {} }] } : {}) };
}
// SPEC-AMBIGUITY: Any terminal pause ends an outstanding R06B wait to preserve the tag/phase invariant.
export function pause(id: string, ctx: RuleContext, reason: 'R06' | 'R06B') { return propose(id, ctx, { preTagTierIndex: null, requiresUserConfirmToEnable: true, pausedAutoReason: reason, r06bPhase: 'DONE' }, 0, 'PAUSED_AUTO', undefined, reason === 'R06' ? 'R06_PAUSED' : 'R06B_PAUSED'); }
