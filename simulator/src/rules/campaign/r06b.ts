import type { RuleDefinition } from '../../engine/types.js';
import { acosGt } from '../../domain/acos.js';
import { window, pause, propose, age } from './shared.js';
import { date } from '../../time/clock.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id, m = ctx.state.campaignMemory[id], t = ctx.thresholdsByCampaign[id];
    if (!m || !t)
        return null;
    // BE is retained separately from capped T_ok/T_bad in campaign thresholds.
    const bad = 1.5 * t.breakEvenAcos;
    if (m.r06bPhase === 'STEP1_WAITING') {
        if (!m.r06bStep1At || age(m.r06bStep1At, ctx) < 7)
            return null;
        const w = window(id, ctx, 7, false, 7, m.r06bStep1At);
        if (!w.eligible)
            return null;
        return acosGt(w.acos, bad) ? pause(id, ctx, 'R06B') : propose(id, ctx, { r06bPhase: 'DONE' });
    }
    if (m.r06bPhase !== 'NONE')
        return null;
    // SPEC-AMBIGUITY: calendar14 is a calendar range; a new campaign may qualify before it has fourteen recorded days.
    const at = ctx.config.ambiguity.r06bWindow === 'calendar14' ? date('1900-01-01', ctx.config.marketplace.zone).toUTC().toISO()! : m.windowStartAt;
    const w = window(id, ctx, 14, false, 14, at);
    if (!w.eligible || w.orders < 1 || w.spendMicros < t.Spend_zero || !acosGt(w.acos, bad))
        return null;
    return propose(id, ctx, { preTagTierIndex: m.preTagTierIndex === null || ctx.config.ambiguity.r06bOverwritesPreTagTier ? m.budgetTierIndex : m.preTagTierIndex, taggedAt: m.tag === 'NORMAL' ? ctx.clock.now() : m.taggedAt, r06bPhase: 'STEP1_WAITING', r06bStep1At: ctx.clock.now() }, 0, m.tag === 'ALERT' ? 'ALERT' : 'MANAGE', .8);
};
