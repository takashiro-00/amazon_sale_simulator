import type { RuleContext } from '../../engine/types.js';
import { isInGrace } from '../../engine/cooldown.js';
import { acosLte } from '../../domain/acos.js';
import { scheduled, window, base } from './shared.js';
export function trackR09(id: string, ctx: RuleContext) {
    const m = ctx.state.campaignMemory[id];
    if (!m || m.tag !== 'MANAGE' || isInGrace(m, ctx.clock.now()) || !scheduled(id, ctx) || m.lastR09CheckDate === ctx.today)
        return ctx.state;
    const w = window(id, ctx, 7), pass = w.eligible && w.orders >= 1 && acosLte(w.acos, Math.max(base(id, ctx), .9 * ctx.thresholdsByCampaign[id]!.T_win));
    return { ...ctx.state, campaignMemory: { ...ctx.state.campaignMemory, [id]: { ...m, lastR09CheckDate: ctx.today, r09ConsecutivePasses: pass ? m.r09ConsecutivePasses + 1 : 0 } } };
}
