import type { RuleDefinition } from '../../engine/types.js';
import { window, propose } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m || m.tag === 'ALERT' || m.tag === 'PAUSED_AUTO')
        return null;
    const w = window(id, ctx, 3);
    return w.eligible && w.complete && w.orders === 0 && ctx.metrics.zeroOrdersRobust(id, ctx.today) && w.spendMicros >= .6 * ctx.thresholdsByCampaign[id]!.Spend_zero && ctx.metrics.hasOrdersInLookback(id, 30, ctx.today) ? propose(id, ctx, { preTagTierIndex: m.tag === 'NORMAL' ? m.budgetTierIndex : m.preTagTierIndex, taggedAt: m.tag === 'NORMAL' ? ctx.clock.now() : m.taggedAt, r09ConsecutivePasses: 0 }, 0, 'ALERT', undefined, 'R08_ALERT') : null;
};
