import type { RuleDefinition } from '../../engine/types.js';
import { acosGt } from '../../domain/acos.js';
import { window, propose, base } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m || m.tag !== 'NORMAL')
        return null;
    const w = window(id, ctx, 7);
    return w.eligible && w.orders >= 1 && w.clicks >= 10 && acosGt(w.acos, Math.max(1.1 * base(id, ctx), ctx.thresholdsByCampaign[id]!.T_win)) ? propose(id, ctx, { taggedAt: ctx.clock.now(), preTagTierIndex: m.budgetTierIndex, r09ConsecutivePasses: 0 }, Math.min(m.budgetTierIndex, 1), 'MANAGE', .9) : null;
};
