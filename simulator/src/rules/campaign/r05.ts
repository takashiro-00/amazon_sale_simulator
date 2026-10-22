import type { RuleDefinition } from '../../engine/types.js';
import { acosGte } from '../../domain/acos.js';
import { zero, window, propose } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m || m.budgetTierIndex === 0)
        return null;
    const w = window(id, ctx, 3), t = ctx.thresholdsByCampaign[id]!;
    if (!w.eligible)
        return null;
    if (w.orders >= 1 && acosGte(w.acos, t.T_bad * (ctx.config.v32.hysteresis ? ctx.config.v32Hysteresis.budgetDown : 1)))
        return propose(id, ctx, {}, m.budgetTierIndex - 1);
    return w.complete && zero(id, ctx, w.orders, 3) && w.spendMicros >= Math.min(t.CPA_target, .6 * t.Spend_zero) ? propose(id, ctx, {}, 0) : null;
};
