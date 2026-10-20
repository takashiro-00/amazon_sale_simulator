import type { RuleDefinition } from '../../engine/types.js';
import { usd } from '../../domain/money.js';
import { window, pause } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id;
    if (!ctx.state.campaignMemory[id])
        return null;
    // SPEC-AMBIGUITY: R06 may act after one ripe day; G2 still requires both recent zero-order dates.
    const w = window(id, ctx, 14, true, 1), t = ctx.thresholdsByCampaign[id]!;
    return w.eligible && w.complete && w.orders === 0 && ctx.metrics.zeroOrdersRobust(id, ctx.today) && ((w.spendMicros >= t.Spend_zero && w.clicks >= t.N2) || w.spendMicros >= Math.min(2.5 * t.Spend_zero, usd('63'))) ? pause(id, ctx, 'R06') : null;
};
