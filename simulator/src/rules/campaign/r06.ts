import type { RuleDefinition } from '../../engine/types.js';
import { usd } from '../../domain/money.js';
import { resolveWindow } from '../../data/windows.js';
import { zeroOrders } from '../zeroOrders.js';
import { zero, window, pause } from './shared.js';
export const evaluate: RuleDefinition['evaluate'] = (ref, ctx) => {
    const id = ref.id;
    if (!ctx.state.campaignMemory[id])
        return null;
    // SPEC-AMBIGUITY: R06 may act after one ripe day; G2 still requires both recent zero-order dates.
    const w = window(id, ctx, 14, true, 1), t = ctx.thresholdsByCampaign[id]!;
    if(ctx.config.v32.r06CalendarGuard){
        const start='1900-01-01T00:00Z', spec={kind:'rolling' as const,days:14,minRipeDays:14};
        const calendar=ctx.metrics.campaignWindow(id,resolveWindow(spec,ctx.today,{windowStartAt:start},ctx.config));
        if(calendar.complete&&calendar.spendMicros>=2*t.Spend_zero&&zeroOrders(id,ctx,calendar.orders,spec,start))return pause(id,ctx,'R06');
    }
    return w.eligible && w.complete && zero(id, ctx, w.orders, 14, true, 1) && ((w.spendMicros >= t.Spend_zero && w.clicks >= t.N2) || w.spendMicros >= Math.min(2.5 * t.Spend_zero, usd('63'))) ? pause(id, ctx, 'R06') : null;
};
