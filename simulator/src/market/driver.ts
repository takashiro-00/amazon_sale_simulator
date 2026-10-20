import type { Scenario, ScenarioCampaign, ScenarioTarget } from '../scenario/schema.js';
import { date, instant, toMarketplaceDate, marketplaceHour } from '../time/clock.js';
import { normalizeText } from '../api/tags.js';
import { Rng } from './rng.js';
import { demandHour, allocateCampaign, emptyMetrics } from './model.js';
import { eventContext, productAt } from './events.js';
import { MemoryFactSink, Reporter, observation, type FactSink, type Observation } from './reporting.js';
import { queryFacts, type MetricFact } from '../data/facts.js';
function targetRngKey(campaignId: string, view: Pick<ScenarioTarget, 'kind' | 'text'>): string {
    return `target:${campaignId}:${view.kind}:${normalizeText(view.text)}`;
}
export interface EntityView {
    campaigns: ScenarioCampaign[];
}
export class MarketDriver {
    private readonly rng: Rng;
    private readonly reporter: Reporter;
    private day = '';
    private lastInstant = -Infinity;
    private readonly spent = new Map<string, number>();
    private readonly exhausted = new Set<string>();
    readonly truth: Observation[] = [];
    constructor(readonly scenario: Scenario, sink: FactSink = new MemoryFactSink()) {
        this.rng = new Rng(scenario.seed);
        this.reporter = new Reporter(scenario, sink);
    }
    initialView(): EntityView {
        return { campaigns: structuredClone(this.scenario.campaigns) };
    }
    step(hourInstant: string, entityView: EntityView): {
        facts: MetricFact[];
        spendByCampaign: Record<string, number>;
    } {
        const time = instant(hourInstant);
        if (time.toMillis() <= this.lastInstant || time.minute || time.second || time.millisecond)
            throw new Error('STEP_REQUIRES_INCREASING_HOUR_BUCKET');
        this.lastInstant = time.toMillis();
        const day = toMarketplaceDate(hourInstant, this.scenario.marketplace);
        if (day !== this.day) {
            this.day = day;
            this.spent.clear();
            this.exhausted.clear();
        }
        const hour = marketplaceHour(hourInstant, this.scenario.marketplace);
        const context = eventContext(this.scenario, hourInstant), spendByCampaign: Record<string, number> = {};
        for (const c of [...entityView.campaigns].sort((a, b) => a.id.localeCompare(b.id))) {
            let used = this.spent.get(c.id) ?? 0;
            const before = used, cap = Math.floor(c.budget * (1 + this.scenario.overspendTolerance) * 1e6);
            // SPEC-AMBIGUITY: Seeded campaign-hour impression shuffle shares a binding cap fairly; target forks use campaign + kind + normalized text, independent of target ID.
            const targets = c.targets;
            const demands = targets.map(view => {
                const truth = this.scenario.campaigns.flatMap(c => c.targets).find(t => t.id === view.id);
                if (!truth)
                    throw new Error(`UNKNOWN_TARGET:${view.id}`);
                if (this.exhausted.has(c.id))
                    return { ...emptyMetrics(), budgetCapped: true, slices: [], orderEvents: [], batches: [] };
                return demandHour({ target: truth, bid: view.bid, topOfSearchPct: c.topOfSearchPct, hour, price: productAt(this.scenario, c.asin, hourInstant).priceUsd, remainingBudget: Infinity, seasonality: context.seasonality, status: c.status === 'PAUSED' ? 'PAUSED' : view.status, couponZeroSalesRate: this.scenario.couponZeroSalesRate }, this.rng.fork(targetRngKey(c.id, view)).fork(hourInstant));
            });
            const results = allocateCampaign(demands, this.exhausted.has(c.id) ? 0 : Math.max(0, cap - used), this.rng.fork(`campaign:${c.id}:${hourInstant}`));
            targets.forEach((view, i) => {
                const result = results[i]!;
                used += result.spendMicros;
                if (result.budgetExhausted || used >= cap)
                    this.exhausted.add(c.id);
                const rng = this.rng.fork(targetRngKey(c.id, view)).fork(hourInstant);
                const o = observation(this.scenario, view.id, c.id, hourInstant, result, rng.fork('attribution'), { day, hour, context });
                this.truth.push(o);
                this.reporter.record(o);
            });
            this.spent.set(c.id, used);
            spendByCampaign[c.id] = used - before;
        }
        return { facts: this.reporter.publish(time.plus({ hours: 1 }).toUTC().toISO()!), spendByCampaign };
    }
    flush(asOf: string): MetricFact[] {
        return this.reporter.publish(asOf);
    }
}
export function applyManualEdits(s: Scenario, view: EntityView, previous: string, at: string): void {
    for (const e of s.events) {
        // SPEC-AMBIGUITY: A console edit at an exact boundary takes effect on the following bucket, not the bucket starting at that boundary.
        if (e.type !== 'manualEdit' || Date.parse(e.at) < Date.parse(previous) || Date.parse(e.at) >= Date.parse(at))
            continue;
        const c = view.campaigns.find(c => c.id === e.entityId), t = view.campaigns.flatMap(c => c.targets).find(t => t.id === e.entityId);
        if (c) {
            if (e.field === 'budget')
                c.budget = e.value as number;
            if (e.field === 'status')
                c.status = e.value as ScenarioCampaign['status'];
            if (e.field === 'name')
                c.name = e.value as string;
        }
        if (t) {
            if (e.field === 'bid')
                t.bid = e.value as number;
            if (e.field === 'status')
                t.status = e.value as typeof t.status;
        }
    }
}
export function runScenario(s: Scenario) {
    const sink = new MemoryFactSink(), driver = new MarketDriver(s, sink), view = driver.initialView(), start = date(s.startDate, s.marketplace.zone), end = start.plus({ days: s.days });
    let previous = start.minus({ hours: 1 }).toUTC().toISO()!;
    for (let at = start; at < end; at = at.plus({ hours: 1 })) {
        const iso = at.toUTC().toISO()!;
        applyManualEdits(s, view, previous, iso);
        driver.step(iso, view);
        previous = iso;
    }
    driver.flush(end.plus({ days: 15 }).toUTC().toISO()!);
    return { facts: sink.facts, truth: driver.truth, summary: summarize(s, sink.facts, driver.truth) };
}
export function summarize(s: Scenario, facts: readonly MetricFact[], truth: readonly Observation[]) {
    const end = date(s.startDate, s.marketplace.zone).plus({ days: s.days });
    const totals = (facts: readonly {
        impressions: number;
        clicks: number;
        spendMicros: number;
        orders: number;
        salesMicros: number;
    }[]) => facts.reduce((a, f) => ({ impressions: a.impressions + f.impressions, clicks: a.clicks + f.clicks, spendMicros: a.spendMicros + f.spendMicros, orders: a.orders + f.orders, salesMicros: a.salesMicros + f.salesMicros }), { impressions: 0, clicks: 0, spendMicros: 0, orders: 0, salesMicros: 0 });
    const ids = new Set(s.campaigns.flatMap(c => c.targets.map(t => t.id)));
    const dailyFacts = facts.filter(f => ids.has(f.entityRef) && f.hour === undefined && !f.placement);
    const asOf = Object.fromEntries([1, 2, 3, 7, 14].map(n => {
        const at = end.minus({ days: 1 }).plus({ days: n }).set({ hour: 3 }).toUTC().toISO()!;
        return [`D+${n}`, { asOf: at, ...totals(queryFacts(dailyFacts, { asOf: at })) }];
    }));
    return { seed: s.seed, startDate: s.startDate, days: s.days, trueTotals: totals(truth.map(o => o.result)), netOrders: truth.reduce((n, o) => n + o.orders.filter(x => !x.returnedAt).length, 0), asOf };
}
