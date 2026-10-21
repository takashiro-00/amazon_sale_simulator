import type { RuleContext } from '../engine/types.js';
import { resolveWindow, type WindowSpec } from '../data/windows.js';
import { dMinus } from '../time/clock.js';
/** Spend/clicks stay on the original window. Only zero-order evidence moves. */
export function zeroOrders(id: string, c: RuleContext, originalOrders: number, spec: WindowSpec, start: string, fixedFrom?: string): boolean {
    const k = c.config.v32.zeroOrderLagDays;
    if (k === 2)
        return originalOrders === 0 && c.metrics.zeroOrdersRobust(id, c.today);
    const config = { ...c.config, maturityLagDays: k };
    const resolved = resolveWindow(spec, c.today, { windowStartAt: start }, config);
    const w = fixedFrom ? { ...resolved, from: fixedFrom, eligible: fixedFrom <= resolved.to } : resolved;
    const evidence = c.metrics.campaignWindow(id, w);
    const robust = c.metrics.campaignWindow(id, { from: dMinus(c.today, k + 1), to: dMinus(c.today, k), ripeDays: 2, eligible: true });
    const recent = c.metrics.campaignWindow(id, { from: dMinus(c.today, k - 1), to: dMinus(c.today, 2), ripeDays: k - 2, eligible: true });
    return w.eligible && evidence.complete && evidence.orders === 0 && robust.complete && robust.orders === 0 && recent.complete && recent.orders === 0;
}
