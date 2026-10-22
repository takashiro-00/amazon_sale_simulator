import type { RuleDefinition } from '../../engine/types.js';
import { acosLte } from '../../domain/acos.js';
import { window, propose, age } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id];
    if (!m)
        return null;
    if (m.tag === 'NORMAL')
        return m.bidRestorePending ? propose(id, ctx, {}, undefined, undefined, 1.1) : null;
    const w = window(id, ctx, 7);
    if (!w.eligible)
        return null;
    const remove = m.tag === 'MANAGE' ? m.r09ConsecutivePasses >= 2 && m.taggedAt !== null && age(m.taggedAt, ctx) >= 6 : m.tag === 'ALERT' && w.orders >= 2 && acosLte(w.acos, ctx.thresholdsByCampaign[id]!.T_ok);
    if (!remove)
        return null;
    const pending = Object.entries(ctx.state.targets).some(([tid, t]) => ctx.state.targetEntities[tid]?.campaignId === id && t.tagReductionFactor < 1);
    // SPEC-AMBIGUITY: "mỗi lần campaign hồi phục về NORMAL thì R06B được kích hoạt lại".
    return propose(id, ctx, { preTagTierIndex: null, taggedAt: null, baselineAcos: w.acos, r09ConsecutivePasses: 0, bidRestorePending: pending, r06bPhase: 'NONE', r06bStep1At: null }, ctx.config.ambiguity.r09BudgetRestore === 'pre-tag-tier' ? m.preTagTierIndex ?? m.budgetTierIndex : m.budgetTierIndex, 'NORMAL');
};
