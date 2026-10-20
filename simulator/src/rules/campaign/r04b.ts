import type { RuleDefinition } from '../../engine/types.js';
import { acosLt } from '../../domain/acos.js';
import { budgetMultiplyStep } from '../../domain/budgetLadder.js';
import { window, propose } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m || m.tag !== 'NORMAL' || m.budgetTierIndex < 3)
        return null;
    const w = window(id, ctx, 7), next = ctx.config.budgetLadder.indexOf(budgetMultiplyStep(ctx.state.campaigns[id]!.dailyBudgetMicros));
    return next > m.budgetTierIndex && w.eligible && w.orders >= 5 && acosLt(w.acos, ctx.thresholdsByCampaign[id]!.T_win) && w.daily.filter(d => m.budgetByDate[d.date] !== undefined && d.spendMicros >= .9 * m.budgetByDate[d.date]!).length >= 5 ? propose(id, ctx, { baselineAcos: w.acos }, next) : null;
};
