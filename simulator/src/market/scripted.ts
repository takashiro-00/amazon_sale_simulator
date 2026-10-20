import type { Scenario, ScenarioCampaign } from '../scenario/schema.js';
import type { MarketModel } from './port.js';
import type { EntityView } from './driver.js';
import type { MetricFact } from '../data/facts.js';
import { micros } from '../domain/money.js';
import { calendarDaysBetween, date, instant, toMarketplaceDate } from '../time/clock.js';
export interface ScriptedDay {
    clicks: number;
    spendUsd: number;
    orders: number;
    salesUsd: number;
}
export type DailyScript = (ctx: {
    day: number;
    date: string;
    campaign: ScenarioCampaign;
}) => ScriptedDay;
/** Exact daily totals split over the actual 23/24/25 hourly buckets, published D+1 03 PT. */
export class ScriptedMarket implements MarketModel {
    private readonly totals = new Map<string, MetricFact>();
    private readonly published = new Set<string>();
    private last = -Infinity;
    constructor(readonly scenario: Scenario, readonly script: DailyScript | Readonly<Record<string, Readonly<Record<string, ScriptedDay>>>>) { }
    step(at: string, view: EntityView) {
        const time = instant(at);
        if (time.toMillis() <= this.last || time.minute || time.second || time.millisecond)
            throw new Error('STEP_REQUIRES_INCREASING_HOUR_BUCKET');
        this.last = time.toMillis();
        const day = toMarketplaceDate(at, this.scenario.marketplace), start = date(day, this.scenario.marketplace.zone), next = start.plus({ days: 1 }), hours = next.diff(start, 'hours').hours, hourIndex = time.diff(start, 'hours').hours;
        const spendByCampaign: Record<string, number> = {};
        for (const c of view.campaigns) {
            const plan = typeof this.script === 'function' ? this.script({ day: calendarDaysBetween(this.scenario.startDate, day, this.scenario.marketplace.zone), date: day, campaign: c }) : this.script[c.id]?.[day];
            if (!plan)
                throw new Error(`MISSING_SCRIPT:${c.id}:${day}`);
            const total = { impressions: plan.clicks * 10, clicks: plan.clicks, spendMicros: Math.round(plan.spendUsd * 1e6), orders: plan.orders, salesMicros: Math.round(plan.salesUsd * 1e6) };
            // SPEC-AMBIGUITY: Scripted totals describe observed spend; enabled traffic is not re-capped by budget.
            const slice = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, c.status === 'PAUSED' ? 0 : Math.floor(v * (hourIndex + 1) / hours) - Math.floor(v * hourIndex / hours)])) as typeof total;
            spendByCampaign[c.id] = slice.spendMicros;
            const targets = c.targets.filter(t => t.status === 'ENABLED');
            for (const [i, entityRef] of [c.id, ...c.targets.map(t => t.id)].entries()) {
                const key = `${entityRef}:${day}`, old = this.totals.get(key);
                const values = i === 0 ? slice : Object.fromEntries(Object.entries(slice).map(([k, v]) => [k, targets.some(t => t.id === entityRef) ? Math.floor(v * (targets.findIndex(t => t.id === entityRef) + 1) / targets.length) - Math.floor(v * targets.findIndex(t => t.id === entityRef) / targets.length) : 0])) as typeof slice;
                this.totals.set(key, { entityRef, marketplaceDate: day, knownAt: next.set({ hour: 3 }).toUTC().toISO()!, impressions: (old?.impressions ?? 0) + values.impressions, clicks: (old?.clicks ?? 0) + values.clicks, orders: (old?.orders ?? 0) + values.orders, spendMicros: micros((old?.spendMicros ?? 0) + values.spendMicros), salesMicros: micros((old?.salesMicros ?? 0) + values.salesMicros) });
            }
        }
        const facts: MetricFact[] = [];
        for (const [key, f] of this.totals)
            if (!this.published.has(key) && Date.parse(f.knownAt) <= time.plus({ hours: 1 }).toMillis()) {
                facts.push(f);
                this.published.add(key);
            }
        return { facts, spendByCampaign };
    }
}
