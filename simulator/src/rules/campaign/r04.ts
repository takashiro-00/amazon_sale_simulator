import type { RuleDefinition } from '../../engine/types.js';
import { acosLt } from '../../domain/acos.js';
import { window, propose } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m || m.tag !== 'NORMAL' || m.budgetTierIndex !== 2)
        return null;
    const w = window(id, ctx, 3);
    return w.eligible && w.daily.length === 3 && w.daily.every(d => d.orders >= 1) && acosLt(w.acos, ctx.thresholdsByCampaign[id]!.T_ok * (ctx.config.v32.hysteresis ? ctx.config.v32Hysteresis.budgetUp : 1)) ? propose(id, ctx, { baselineAcos: w.acos }, 3) : null;
};
